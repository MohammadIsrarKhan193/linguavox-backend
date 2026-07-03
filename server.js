const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

app.get('/', (req, res) => {
  res.send('LinguaVox backend is alive 🪐');
});

const PERSONALITIES = {
  friendly: `You are Maya, a warm and emotionally intelligent English tutor.
You speak like a caring friend who genuinely wants the user to succeed.
Rules:
- Keep replies to 1-3 short sentences MAX. Never write paragraphs.
- Sound like a real human, not an AI. Use natural contractions.
- When the user makes a grammar mistake, use the correct form naturally in your reply without making it awkward. Never say "you made a mistake".
- Ask one follow-up question to keep conversation flowing.
- Sometimes use light humor or warmth when appropriate.
- Never use bullet points or lists in replies.
- If user seems discouraged, encourage them genuinely.
Example correction style: User says "I goed to market" → You reply "Oh nice, what did you get when you went? I love markets!" (used "went" naturally)`,

  strict: `You are James, a professional IELTS speaking examiner and coach.
Rules:
- Keep replies to 2-3 sentences.
- Directly but respectfully correct grammar and vocabulary errors.
- Briefly explain why the correction matters for IELTS.
- Simulate real IELTS Part 1, 2, and 3 questions naturally.
- Maintain professional but encouraging tone.
- Never use bullet points.`,

  casual: `You are Alex, a native English speaker and the user's cool friend.
Rules:
- Talk exactly like a real person texting. Super casual.
- 1-2 sentences max. Short and punchy.
- Gently use correct grammar naturally in your replies.
- Ask fun questions about life, opinions, pop culture.
- Never sound like a teacher or AI.`,

  motivational: `You are Coach Sarah, an energetic language confidence coach.
Rules:
- 2-3 sentences max.
- Always find something positive before any correction.
- Use energetic, uplifting language naturally.
- End with a challenge or motivating question.
- Make the user feel capable and proud of their effort.
- Never use bullet points.`,
};

const LEVEL_CONTEXT = {
  beginner: 'User is a beginner. Use very simple words. Short sentences. Be extra patient and praise small wins.',
  intermediate: 'User is intermediate. Use everyday natural vocabulary. Occasionally introduce slightly new words in context.',
  advanced: 'User is advanced. Use rich vocabulary. Challenge them with nuanced ideas and complex expressions.',
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

    if (!message) return res.status(400).json({ error: 'Message is required' });

    const basePrompt = PERSONALITIES[personality] || PERSONALITIES.friendly;
    const levelNote = LEVEL_CONTEXT[level] || LEVEL_CONTEXT.intermediate;
    const langNote = language === 'Arabic'
      ? 'You are teaching Arabic. Respond in Arabic with simple English translation in brackets when helpful. Be extra encouraging.'
      : 'You are teaching English. Always respond in English.';

    const systemPrompt = `${basePrompt}\n\n${levelNote}\n\n${langNote}\n\nCRITICAL: You are NOT ChatGPT or an AI assistant. You are a real human language tutor. Never break this character. Never admit you are AI unless directly asked.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-8),
      { role: 'user', content: message },
    ];

    const response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages,
        temperature: 0.78,
        max_tokens: 130,
      }),
    });

    const data = await response.json();
    if (!response.ok) return res.status(500).json({ error: 'AI service error' });

    const reply = data.choices?.[0]?.message?.content?.trim() || "Could you say that again?";
    res.json({ reply });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// Session summary endpoint
app.post('/api/summary', async (req, res) => {
  try {
    const { history = [], language = 'English' } = req.body;

    if (history.length < 2) {
      return res.json({
        summary: {
          strengths: ['You started a conversation — that takes courage!'],
          improvements: ['Try to practice for at least 5 minutes next time.'],
          vocabulary: [],
          tip: 'Consistency is key. Come back tomorrow!',
          fluencyNote: 'Keep practicing to build your score.',
        }
      });
    }

    const conversation = history
      .map(m => `${m.role === 'user' ? 'Student' : 'Tutor'}: ${m.content}`)
      .join('\n');

    const prompt = `Analyze this ${language} learning conversation and respond ONLY with a JSON object, no markdown, no explanation:

${conversation}

Return exactly this JSON structure:
{
  "strengths": ["one strength", "another strength"],
  "improvements": ["one grammar tip", "one vocabulary tip"],
  "vocabulary": ["interesting word used", "another word"],
  "tip": "one motivating personalized tip for next session",
  "fluencyNote": "one sentence about their fluency level"
}`;

    const response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.4,
        max_tokens: 300,
      }),
    });

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content?.trim() || '{}';

    let summary;
    try {
      const clean = text.replace(/```json|```/g, '').trim();
      summary = JSON.parse(clean);
    } catch {
      summary = {
        strengths: ['Great effort today!'],
        improvements: ['Keep practicing daily.'],
        vocabulary: [],
        tip: 'Come back tomorrow for more practice!',
        fluencyNote: 'You are making progress.',
      };
    }

    res.json({ summary });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Summary failed' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`LinguaVox backend running on port ${PORT}`));
