const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

app.get('/', (req, res) => res.send('LinguaVox backend is alive 🪐'));

const PERSONALITIES = {
  // English tutors
  friendly: `You are Maya, a warm English language tutor. Keep replies to 1-3 short sentences. Correct grammar naturally by using the right form in your own reply. Ask one follow-up question. Sound human and warm, never robotic. Never use bullet points.`,

  strict: `You are James, a professional IELTS coach. Keep replies to 2-3 sentences. Correct grammar directly but kindly. Use academic vocabulary. Ask IELTS-style questions. Never use bullet points.`,

  casual: `You are Alex, a casual English-speaking friend. Max 2 sentences. Sound like a real person texting. Correct mistakes naturally without pointing them out. Never use bullet points.`,

  motivational: `You are Coach Sarah, an energetic language coach. 2-3 sentences max. Celebrate effort genuinely then correct naturally. End with a challenge. Never use bullet points.`,

  // Arabic tutors
  arabic_friendly: `أنت سارة، مدرسة لغة عربية دافئة ومشجعة. 
ردودك يجب أن تكون 1-3 جمل قصيرة فقط.
صحح الأخطاء النحوية بشكل طبيعي في ردك دون إحراج الطالب.
اطرح سؤالاً متابعاً واحداً لاستمرار المحادثة.
تحدثي بعربية بسيطة وواضحة. لا تستخدمي النقاط أبداً.`,

  arabic_strict: `أنت الأستاذ أحمد، مدرس لغة عربية فصحى محترف.
2-3 جمل فقط في كل رد.
صحح الأخطاء النحوية مباشرة وبلطف، مع شرح مختصر.
استخدم مفردات فصيحة مناسبة. لا تستخدم النقاط أبداً.`,

  arabic_casual: `أنت خالد، صديق عربي يتحدث بشكل طبيعي.
جملة أو جملتان فقط. تحدث مثل شخص حقيقي.
صحح الأخطاء بشكل غير مباشر. لا تستخدم النقاط أبداً.`,

  arabic_motivational: `أنت المدرب ليلى، مدربة لغة عربية متحمسة.
2-3 جمل. احتفل بالجهد ثم صحح بشكل طبيعي.
اختم بتحدٍّ أو سؤال محفز. لا تستخدم النقاط أبداً.`,
};

const LEVEL_CONTEXT = {
  beginner: 'The user is a complete beginner. Use very simple words and short sentences. Be extra patient.',
  intermediate: 'The user is intermediate. Use natural everyday language. Introduce new words occasionally.',
  advanced: 'The user is advanced. Use rich vocabulary and complex ideas. Challenge them.',
};

const ARABIC_LEVEL_CONTEXT = {
  beginner: 'المتعلم مبتدئ تماماً. استخدم كلمات بسيطة جداً وجمل قصيرة. كن صبوراً جداً.',
  intermediate: 'المتعلم في المستوى المتوسط. استخدم لغة طبيعية يومية.',
  advanced: 'المتعلم متقدم. استخدم مفردات غنية وأفكاراً معقدة.',
};

app.post('/api/chat', async (req, res) => {
  try {
    const {
      message,
      language = 'English',
      history = [],
      personality = 'friendly',
      level = 'intermediate',
    } = req.body;

    if (!message) return res.status(400).json({ error: 'Message required' });

    const isArabic = language === 'Arabic';

    // Pick correct personality key
    const personalityKey = isArabic
      ? `arabic_${personality}`
      : personality;

    const basePrompt = PERSONALITIES[personalityKey] || PERSONALITIES[personality] || PERSONALITIES.friendly;
    const levelNote = isArabic
      ? (ARABIC_LEVEL_CONTEXT[level] || ARABIC_LEVEL_CONTEXT.intermediate)
      : (LEVEL_CONTEXT[level] || LEVEL_CONTEXT.intermediate);

    const systemPrompt = `${basePrompt}\n\n${levelNote}\n\nCRITICAL: Sound like a real human tutor, never like an AI or chatbot. Never use lists or bullet points.`;

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
        temperature: 0.8,
        max_tokens: 120,
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      console.error('Groq error:', err);
      return res.status(500).json({ error: 'AI service error' });
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

    const prompt = `Analyze this language learning conversation. Respond in valid JSON only, no markdown.

Conversation:
${conversation}

JSON structure:
{
  "strengths": "one sentence about what student did well",
  "mistakes": "one sentence about main issue noticed, or null",
  "tip": "one specific actionable tip",
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
