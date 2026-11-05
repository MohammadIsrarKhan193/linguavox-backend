const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const admin = require('firebase-admin');
require('dotenv').config();
const { buildSystemPrompt } = require('./engine/promptBuilder');

const app = express();

// Render sits behind a proxy; this makes req.ip the real caller's IP.
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '100kb' }));

// ------------------------------------------------------------
// CONFIG (all changeable in Render → Environment, no code change)
//   GROQ_API_KEY              required
//   GROQ_MODEL                optional, default openai/gpt-oss-120b
//   GROQ_FALLBACK_MODEL       optional, tried if the main model fails
//   FIREBASE_SERVICE_ACCOUNT  required: the service-account JSON, as one line
//   FREE_DAILY_CHATS          optional, default 20 AI replies per day (free)
//   PRO_DAILY_CAP             optional, default 500 per day (Pro "unlimited"
//                             fair-use guard so one account can't run up the bill)
//   ADMIN_KEY                 optional: enables the /admin/set-pro tool
// ------------------------------------------------------------
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const PRIMARY_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const FALLBACK_MODEL = process.env.GROQ_FALLBACK_MODEL || null;
const GROQ_TIMEOUT_MS = 25000;
const FREE_DAILY_CHATS = parseInt(process.env.FREE_DAILY_CHATS || '20', 10);
const PRO_DAILY_CAP = parseInt(process.env.PRO_DAILY_CAP || '500', 10);
const ADMIN_KEY = process.env.ADMIN_KEY || null;

if (!GROQ_API_KEY) {
  console.error('[startup] GROQ_API_KEY is missing — every AI request will fail.');
}

// ------------------------------------------------------------
// FIREBASE ADMIN — verifies who is calling, reads their plan, and
// keeps the daily usage counter. If it is not configured, the server
// refuses AI requests (fails CLOSED) rather than letting anyone in
// for free. /health shows whether it is working.
// ------------------------------------------------------------
let db = null;
let authReady = false;
let authReason = 'not_started'; // shown on /health so you can see WHY without digging in logs

/// Reads the Firebase key from Render. Two ways, either works:
///  - FIREBASE_SERVICE_ACCOUNT         the JSON pasted as text
///  - FIREBASE_SERVICE_ACCOUNT_BASE64  the same JSON encoded as base64
///    (the safest: web forms can't mangle it)
function loadServiceAccount() {
  let raw = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64
    ? Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64.trim(), 'base64').toString('utf8')
    : process.env.FIREBASE_SERVICE_ACCOUNT;

  if (!raw || !raw.trim()) return { error: 'missing' };
  raw = raw.trim();
  // Forgiving: remove quotes if the value was pasted with them.
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    raw = raw.slice(1, -1);
  }
  try {
    const account = JSON.parse(raw);
    // Some hosts turn the key's \n into real line breaks or double slashes.
    if (account.private_key) account.private_key = account.private_key.replace(/\\n/g, '\n');
    return { account };
  } catch (_) {
    return { error: 'invalid_json' };
  }
}

const loaded = loadServiceAccount();
if (loaded.account) {
  try {
    admin.initializeApp({ credential: admin.credential.cert(loaded.account) });
    db = admin.firestore();
    authReady = true;
    authReason = 'ok';
  } catch (err) {
    authReason = 'init_failed';
    console.error('[startup] Firebase Admin failed to start:', err && err.message);
  }
} else {
  authReason = loaded.error;
  console.error(
    `[startup] Firebase key problem: ${loaded.error}. AI requests will be refused until it is fixed.`
  );
}

// ------------------------------------------------------------
// SAFETY HELPERS
// ------------------------------------------------------------
const MAX_TEXT = 2000;
const MAX_CONTEXT = 4000;

/// Simple flood guard per IP (generous: many people share one mobile IP).
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (now - entry.start > windowMs) hits.delete(key);
    }
  }, windowMs).unref();

  return (req, res, next) => {
    const now = Date.now();
    let entry = hits.get(req.ip);
    if (!entry || now - entry.start > windowMs) {
      entry = { start: now, count: 0 };
      hits.set(req.ip, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.start + windowMs - now) / 1000)));
      return res.status(429).json({ error: 'rate_limited' });
    }
    next();
  };
}

/// Only 'user' / 'assistant' roles — a caller can never inject 'system'.
function cleanHistory(history, maxItems) {
  if (!Array.isArray(history)) return [];
  return history
    .slice(-maxItems)
    .filter((m) => m && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content.slice(0, MAX_TEXT),
    }));
}

function optionalText(value, maxLength) {
  if (value === null || value === undefined) return null;
  return String(value).slice(0, maxLength);
}

// ------------------------------------------------------------
// WHO IS CALLING + WHAT PLAN THEY HAVE
// ------------------------------------------------------------
async function requireUser(req, res, next) {
  if (!authReady) return res.status(503).json({ error: 'auth_unavailable' });
  const match = (req.get('Authorization') || '').match(/^Bearer (.+)$/);
  if (!match) return res.status(401).json({ error: 'unauthorized' });
  try {
    const decoded = await admin.auth().verifyIdToken(match[1]);
    req.uid = decoded.uid;
    next();
  } catch (_) {
    return res.status(401).json({ error: 'unauthorized' });
  }
}

/// Pro = users/{uid}.plan == 'pro', and not past an optional proUntil date.
/// Clients can NOT write these fields (Firestore rules), only this server
/// and you (Firebase Console) can.
function isProData(data) {
  if (!data || data.plan !== 'pro') return false;
  if (data.proUntil) {
    const until = data.proUntil.toDate ? data.proUntil.toDate() : new Date(data.proUntil);
    if (!isNaN(until) && until < new Date()) return false;
  }
  return true;
}

async function getIsPro(uid) {
  const snap = await db.collection('users').doc(uid).get();
  return isProData(snap.exists ? snap.data() : null);
}

// ------------------------------------------------------------
// DAILY USAGE (counted per user per UTC day, server-side only)
// ------------------------------------------------------------
function dayKey() {
  return new Date().toISOString().slice(0, 10);
}

function usageRef(uid) {
  return db.collection('users').doc(uid).collection('usage').doc(dayKey());
}

/// Atomically take one chat from today's allowance.
async function reserveChat(uid, limit) {
  const ref = usageRef(uid);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const used = snap.exists ? snap.data().chats || 0 : 0;
    if (used >= limit) return { allowed: false, used };
    tx.set(
      ref,
      { chats: used + 1, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
    return { allowed: true, used: used + 1 };
  });
}

/// Give the chat back if the AI failed — users never lose a message to OUR error.
async function refundChat(uid) {
  try {
    const ref = usageRef(uid);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const used = snap.exists ? snap.data().chats || 0 : 0;
      if (used > 0) tx.set(ref, { chats: used - 1 }, { merge: true });
    });
  } catch (err) {
    console.error('[usage] refund failed:', err && err.message);
  }
}

/// One place that talks to Groq: timeout, optional fallback model.
async function callGroq({ messages, temperature, max_tokens }) {
  const models = [PRIMARY_MODEL];
  if (FALLBACK_MODEL && FALLBACK_MODEL !== PRIMARY_MODEL) models.push(FALLBACK_MODEL);

  let lastFailure = { kind: 'network' };

  for (const model of models) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GROQ_TIMEOUT_MS);
    try {
      const payload = { model, messages, temperature, max_tokens };
      if (model.startsWith('openai/gpt-oss')) payload.reasoning_effort = 'low';

      const response = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (response.ok) {
        return { ok: true, data: await response.json(), model };
      }

      let errBody = null;
      try { errBody = await response.json(); } catch (_) {}
      console.error(`[groq] ${model} returned`, response.status, JSON.stringify(errBody));
      lastFailure = { kind: 'http', status: response.status };
    } catch (err) {
      console.error(`[groq] ${model} failed:`, err && err.name === 'AbortError' ? 'timeout' : err);
      lastFailure = { kind: 'network' };
    } finally {
      clearTimeout(timer);
    }
  }

  return { ok: false, failure: lastFailure };
}

// ------------------------------------------------------------
// BASIC ROUTES
// ------------------------------------------------------------
app.get('/', (req, res) => res.send('LinguaVox backend is alive 🪐'));

// Point a free uptime monitor here. `auth: true` means Pro/limits are working.
app.get('/health', (req, res) =>
  res.json({ ok: true, auth: authReady, authReason: authReady ? undefined : authReason }));

app.get('/privacy', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'privacy.html')));
app.get('/delete-account', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'delete-account.html')));

// ------------------------------------------------------------
// CHAT  (login required · free daily limit · Pro unlimited)
// ------------------------------------------------------------
app.post(
  '/api/chat',
  rateLimit({ windowMs: 60 * 1000, max: 120 }),
  requireUser,
  async (req, res) => {
    let reserved = false;
    try {
      const body = req.body || {};
      const {
        message,
        language = 'English',
        personality = 'friendly',
        level = 'intermediate',
      } = body;

      if (!message || typeof message !== 'string' || !message.trim()) {
        return res.status(400).json({ error: 'empty_message' });
      }

      // 1) Which plan? 2) Take one chat from today's allowance.
      const isPro = await getIsPro(req.uid);
      const limit = isPro ? PRO_DAILY_CAP : FREE_DAILY_CHATS;
      const slot = await reserveChat(req.uid, limit);
      if (!slot.allowed) {
        return res.status(429).json({
          error: 'daily_limit',
          isPro,
          used: slot.used,
          limit: isPro ? null : limit,
        });
      }
      reserved = true;

      let systemPrompt;
      try {
        systemPrompt = buildSystemPrompt({
          personality: String(personality).slice(0, 40),
          level: String(level).slice(0, 40),
          language: String(language).slice(0, 40),
          nativeLanguage: optionalText(body.nativeLanguage, 40),
          memoryContext: optionalText(body.memoryContext, MAX_CONTEXT),
          courseFocus: optionalText(body.courseFocus, MAX_CONTEXT),
        });
      } catch (buildErr) {
        console.error('[chat] promptBuilder error:', buildErr);
        await refundChat(req.uid);
        return res.status(500).json({ error: 'prompt_build_failed' });
      }

      const messages = [
        { role: 'system', content: systemPrompt },
        ...cleanHistory(body.history, 8),
        { role: 'user', content: message.slice(0, MAX_TEXT) },
      ];

      const result = await callGroq({ messages, temperature: 0.7, max_tokens: 400 });

      if (!result.ok) {
        await refundChat(req.uid);
        if (result.failure.kind === 'http') {
          return res.status(502).json({ error: 'groq_error', status: result.failure.status });
        }
        return res.status(502).json({ error: 'groq_unreachable' });
      }

      const reply = result.data.choices?.[0]?.message?.content?.trim();
      if (!reply) {
        console.error('[chat] AI returned 200 but no reply content:', JSON.stringify(result.data));
        await refundChat(req.uid);
        return res.status(502).json({ error: 'empty_ai_response' });
      }

      // Privacy: log sizes only — never the learner's private words.
      console.log(
        `[chat] ok model=${result.model} pro=${isPro} personality=${personality} ` +
        `level=${level} inChars=${message.length} outChars=${reply.length}`
      );

      res.json({
        reply,
        usage: { used: slot.used, limit: isPro ? null : limit, isPro },
      });
    } catch (err) {
      console.error('[chat] Unexpected server error:', err);
      if (reserved) await refundChat(req.uid);
      res.status(500).json({ error: 'server_error' });
    }
  }
);

// ------------------------------------------------------------
// SESSION SUMMARY (login required; does not use up a chat)
// ------------------------------------------------------------
app.post(
  '/api/summary',
  rateLimit({ windowMs: 60 * 1000, max: 40 }),
  requireUser,
  async (req, res) => {
    try {
      const body = req.body || {};
      const lessonTitle = optionalText(body.lessonTitle, 200);
      const completionCriteria = optionalText(body.completionCriteria, MAX_CONTEXT);
      const history = cleanHistory(body.history, 40);

      if (history.length < 2) return res.json({ summary: null });

      const conversation = history
        .map((m) => `${m.role === 'user' ? 'Student' : 'Tutor'}: ${m.content}`)
        .join('\n');

      const completionBlock = completionCriteria
        ? `

This conversation was a lesson on "${lessonTitle || 'the current topic'}". Its real completion criteria is:
${completionCriteria}
Judge honestly whether THIS conversation actually demonstrates that — not whether the student was pleasant or tried hard, specifically whether the stated criteria was met.`
        : '';

      const prompt = `Analyze this language learning conversation. Respond in valid JSON only, no markdown, no explanation.

Conversation:
${conversation}

Every value below must be your own genuine assessment of THIS specific conversation — never copy a placeholder or default to a safe middle value. If the student did well, score it high; if they struggled, score it low. Two different conversations should very rarely get the same fluency score unless performance was genuinely similar.${completionBlock}

JSON:
{
  "strengths": "one specific sentence about what the student did well",
  "mistakes": "one sentence about the main grammar or vocabulary issue, or null if none",
  "tip": "one concrete actionable improvement tip",
  "fluency": "integer from 1 to 10 — your honest, specific rating of THIS conversation's fluency, not a default",
  "encouragement": "one warm encouraging sentence",
  "vocabulary": ["word or phrase actually used or taught in this conversation"],
  "grammarPoint": "the main grammar point practiced this session, or null if none clearly stood out",
  "nextLessonSuggestion": "one short, natural suggestion for what to focus on next lesson"${completionCriteria ? `,
  "completionCriteriaMet": "true or false — your honest judgment, not optimistic by default",
  "gapNote": "if not met: one short, specific sentence on what still needs work. If met: null"` : ''}
}`;

      const result = await callGroq({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 520,
      });

      if (!result.ok) return res.json({ summary: null });

      const raw = result.data.choices?.[0]?.message?.content?.trim();
      if (!raw) return res.json({ summary: null });

      try {
        const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
        res.json({ summary: parsed });
      } catch {
        res.json({ summary: null });
      }
    } catch (err) {
      console.error('[summary] Unexpected server error:', err);
      res.status(500).json({ error: 'Summary error' });
    }
  }
);

// ------------------------------------------------------------
// ADMIN: give (or remove) Pro for a person, by email.
// Only works if you set ADMIN_KEY in Render. Use it for yourself,
// friends and relatives. See the PowerShell example in the guide.
//   POST /admin/set-pro   header: x-admin-key: <ADMIN_KEY>
//   body: { "email": "friend@gmail.com", "pro": true, "days": 365 }
//   "days" is optional — leave it out for Pro that never expires.
// ------------------------------------------------------------
function keysMatch(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

app.post(
  '/admin/set-pro',
  rateLimit({ windowMs: 60 * 1000, max: 20 }),
  async (req, res) => {
    if (!ADMIN_KEY || !authReady) return res.status(404).json({ error: 'not_found' });
    if (!keysMatch(req.get('x-admin-key'), ADMIN_KEY)) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    try {
      const { email, pro = true, days = null } = req.body || {};
      if (!email || typeof email !== 'string') {
        return res.status(400).json({ error: 'email_required' });
      }

      let userRecord;
      try {
        userRecord = await admin.auth().getUserByEmail(email.trim());
      } catch (_) {
        return res.status(404).json({ error: 'no_account_with_that_email' });
      }

      const ref = db.collection('users').doc(userRecord.uid);
      const snap = await ref.get();
      if (!snap.exists) {
        // Never create a half-empty profile: the person must open the
        // app once so the app creates their real profile first.
        return res.status(409).json({ error: 'user_must_open_the_app_once_first' });
      }

      if (pro) {
        const update = { plan: 'pro', proSource: 'gift' };
        if (days && Number(days) > 0) {
          update.proUntil = admin.firestore.Timestamp.fromDate(
            new Date(Date.now() + Number(days) * 86400000)
          );
        } else {
          update.proUntil = admin.firestore.FieldValue.delete();
        }
        await ref.update(update);
      } else {
        await ref.update({
          plan: 'free',
          proSource: admin.firestore.FieldValue.delete(),
          proUntil: admin.firestore.FieldValue.delete(),
        });
      }

      console.log(`[admin] set-pro uid=${userRecord.uid} pro=${!!pro} days=${days || 'never'}`);
      res.json({ ok: true, pro: !!pro });
    } catch (err) {
      console.error('[admin] set-pro error:', err);
      res.status(500).json({ error: 'server_error' });
    }
  }
);

// ------------------------------------------------------------
// LAST-RESORT ERROR HANDLER — always JSON, never an HTML error page.
// ------------------------------------------------------------
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'bad_json' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'too_large' });
  }
  console.error('[server] Unexpected error:', err);
  res.status(500).json({ error: 'server_error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`LinguaVox backend running on port ${PORT}`));
