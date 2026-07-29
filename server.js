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

    if (!message) return res.status(400).json({ error: 'Message required' });

    const isArabic = language === 'Arabic';

    const systemPrompt = buildSystemPrompt({
      personality,
      level,
      language,
      nativeLanguage,
      memoryContext,
    });

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-8),
      { role: 'user', content: message },
    ];

    const response = await fetch(GROQ_URL, {
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

    if (!response.ok) {
      const err = await response.json();
      console.error('Groq error:', err);
      return res.status(500).json({ error: 'AI error' });
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content?.trim()
      || (isArabic ? 'عذراً، هل يمكنك إعادة ذلك؟' : "Sorry, could you say that again?");

    res.json({ reply });

  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Server error' });
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
