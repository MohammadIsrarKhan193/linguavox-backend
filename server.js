const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { buildSystemPrompt } = require('./engine/promptBuilder');

const app = express();
app.use(cors());
app.use(express.json());

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

app.get('/', (req, res) => res.send('LinguaVox backend is alive 🪐'));

app.post('/api/chat', async (req, res) => {
  try {
    const {
      message,
      language = 'English',
      history = [],
      personality = 'friendly',
      level = 'intermediate',
      nativeLanguage = null, // e.g. 'pashto', 'dari', 'urdu'
      memoryContext = null, // short summary from Lingua Memory
    } = req.body;

    // FIX: only treat this as "no input" when the message is actually
    // empty/unreadable — never for valid short messages like "hey".
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'empty_message' });
    }

    const isArabic = language === 'Arabic';

    let systemPrompt;
    try {
      systemPrompt = buildSystemPrompt({
        personality,
        level,
        language,
        nativeLanguage,
        memoryContext,
      });
    } catch (buildErr) {
      // FIX: if the prompt-building engine itself throws (bad personality
      // key, bad level, etc.), this used to bubble into the generic catch
      // below and look identical to a Groq failure. Logging it separately
      // here makes the real cause visible instead of guessing.
      console.error('[chat] promptBuilder error:', buildErr);
      return res.status(500).json({ error: 'prompt_build_failed' });
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-8),
      { role: 'user', content: message },
    ];

    let response;
    try {
      response = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages,
          temperature: 0.75,
          max_tokens: 150,
        }),
      });
    } catch (networkErr) {
      // FIX: a network-level failure reaching Groq at all (DNS, timeout,
      // Groq down) is now logged and returned as a distinct error, not
      // silently turned into "sorry, could you say that again?"
      console.error('[chat] Groq network error:', networkErr);
      return res.status(502).json({ error: 'groq_unreachable' });
    }

    if (!response.ok) {
      let errBody = null;
      try { errBody = await response.json(); } catch (_) {}
      // This log is the important one, jani — check Render's logs after
      // this deploys and this line will show you EXACTLY why Groq is
      // rejecting requests (bad/missing API key, deprecated model name,
      // rate limit, etc.) instead of guessing.
      console.error('[chat] Groq returned', response.status, JSON.stringify(errBody));
      return res.status(502).json({ error: 'groq_error', status: response.status });
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content?.trim();

    if (!reply) {
      console.error('[chat] Groq returned 200 but no reply content:', JSON.stringify(data));
      return res.status(502).json({ error: 'empty_ai_response' });
    }

    // Debug logging, as requested — shows the real user input next to
    // the real AI output for every successful exchange.
    console.log(`[chat] user="${message}" -> reply="${reply}"`);

    res.json({ reply });

  } catch (err) {
    console.error('[chat] Unexpected server error:', err);
    res.status(500).json({ error: 'server_error' });
  }
});

// Session summary
app.post('/api/summary', async (req, res) => {
  try {
    const { history = [], language = 'English' } = req.body;
    if (history.length < 2) return res.json({ summary: null });

    const conversation = history
      .map(m => `${m.role === 'user' ? 'Student' : 'Tutor'}: ${m.content}`)
      .join('\n');

    const prompt = `Analyze this language learning conversation. Respond in valid JSON only, no markdown, no explanation.

Conversation:
${conversation}

JSON:
{
  "strengths": "one specific sentence about what the student did well",
  "mistakes": "one sentence about the main grammar or vocabulary issue, or null if none",
  "tip": "one concrete actionable improvement tip",
  "fluency": 6,
  "encouragement": "one warm encouraging sentence"
}`;

    const response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 200,
      }),
    });

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content?.trim() || '{}';
    try {
      const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
      res.json({ summary: parsed });
    } catch {
      res.json({ summary: null });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Summary error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`LinguaVox backend running on port ${PORT}`));
