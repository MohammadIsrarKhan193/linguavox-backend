const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const { buildSystemPrompt } = require('./engine/promptBuilder');

const app = express();

// Render sits behind a proxy; this makes req.ip the real caller's IP
// (needed for the flood guard below).
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '100kb' }));

// ------------------------------------------------------------
// CONFIG
// The AI model name lives in Render's Environment settings, so if
// Groq ever retires a model again you change ONE setting in the
// Render dashboard — no code change, no redeploy of code.
//   GROQ_MODEL           (optional) default: openai/gpt-oss-120b
//   GROQ_FALLBACK_MODEL  (optional) tried automatically if the main
//                        model fails, e.g. openai/gpt-oss-20b
// ------------------------------------------------------------
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const PRIMARY_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const FALLBACK_MODEL = process.env.GROQ_FALLBACK_MODEL || null;
const GROQ_TIMEOUT_MS = 25000;

if (!GROQ_API_KEY) {
  console.error('[startup] GROQ_API_KEY is missing — every AI request will fail. Set it in Render → Environment.');
}

// ------------------------------------------------------------
// SAFETY HELPERS
// ------------------------------------------------------------
const MAX_TEXT = 2000; // max characters for one chat message
const MAX_CONTEXT = 4000; // max characters for lesson focus / memory text

/// Simple flood guard per IP (no extra package needed). Generous on
/// purpose: many people on mobile networks share one IP.
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

/// Only ever 'user' or 'assistant' roles from the app — a caller can
/// never inject a 'system' message to take over the tutor's rules.
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

/// One place that talks to Groq: timeout, optional fallback model,
/// and clear failure information.
async function callGroq({ messages, temperature, max_tokens }) {
  const models = [PRIMARY_MODEL];
  if (FALLBACK_MODEL && FALLBACK_MODEL !== PRIMARY_MODEL) models.push(FALLBACK_MODEL);

  let lastFailure = { kind: 'network' };

  for (const model of models) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GROQ_TIMEOUT_MS);
    try {
      const payload = { model, messages, temperature, max_tokens };
      // gpt-oss models spend tokens "thinking" before they answer;
      // keep that short so the reply itself always fits.
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
      // Important log: shows exactly why Groq rejected the request
      // (bad key, retired model, rate limit...).
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

// Tiny and fast — point a free uptime monitor at this so Render's
// free plan never goes to sleep.
app.get('/health', (req, res) => res.json({ ok: true }));

// Pages required by Google Play (public web links).
app.get('/privacy', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'privacy.html')));
app.get('/delete-account', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'delete-account.html')));

// ------------------------------------------------------------
// CHAT
// ------------------------------------------------------------
app.post(
  '/api/chat',
  rateLimit({ windowMs: 60 * 1000, max: 120 }),
  async (req, res) => {
    try {
      const body = req.body || {};
      const {
        message,
        language = 'English',
        personality = 'friendly',
        level = 'intermediate',
      } = body;

      // Only "no input" when the message is truly empty — never for
      // valid short messages like "hey".
      if (!message || typeof message !== 'string' || !message.trim()) {
        return res.status(400).json({ error: 'empty_message' });
      }

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
        // Prompt-building problems (bad personality key etc.) are
        // logged separately so they're never mistaken for an AI outage.
        console.error('[chat] promptBuilder error:', buildErr);
        return res.status(500).json({ error: 'prompt_build_failed' });
      }

      const messages = [
        { role: 'system', content: systemPrompt },
        ...cleanHistory(body.history, 8),
        { role: 'user', content: message.slice(0, MAX_TEXT) },
      ];

      const result = await callGroq({ messages, temperature: 0.7, max_tokens: 400 });

      if (!result.ok) {
        if (result.failure.kind === 'http') {
          return res.status(502).json({ error: 'groq_error', status: result.failure.status });
        }
        return res.status(502).json({ error: 'groq_unreachable' });
      }

      const reply = result.data.choices?.[0]?.message?.content?.trim();
      if (!reply) {
        console.error('[chat] AI returned 200 but no reply content:', JSON.stringify(result.data));
        return res.status(502).json({ error: 'empty_ai_response' });
      }

      // Privacy: log sizes only — never the learner's private words.
      console.log(
        `[chat] ok model=${result.model} personality=${personality} level=${level} ` +
        `inChars=${message.length} outChars=${reply.length}`
      );

      res.json({ reply });
    } catch (err) {
      console.error('[chat] Unexpected server error:', err);
      res.status(500).json({ error: 'server_error' });
    }
  }
);

// ------------------------------------------------------------
// SESSION SUMMARY
// ------------------------------------------------------------
app.post(
  '/api/summary',
  rateLimit({ windowMs: 60 * 1000, max: 40 }),
  async (req, res) => {
    try {
      const body = req.body || {};
      // Optional: when a conversation is tied to a real Academy lesson,
      // the caller passes its title + real completionCriteria so this
      // endpoint can genuinely assess whether THIS conversation met it.
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

      // The schema deliberately has NO example numbers: models anchor on
      // a literal example, which used to make fluency come back as 6/10
      // on nearly every conversation.
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

      // If the AI is unavailable, the app simply skips the summary
      // (it already handles `summary: null`) instead of crashing.
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
// LAST-RESORT ERROR HANDLER (bad JSON, oversized body, anything else)
// Always answers with JSON — never an HTML error page.
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
