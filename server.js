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

// Tutor personality prompts
const PERSONALITIES = {
  friendly: `You are Maya, a warm and friendly English language tutor. 
You speak like a supportive friend, not a textbook. Keep replies to 1-3 short sentences.
Always end with a gentle follow-up question to keep the conversation going.
When the user makes a grammar mistake, naturally weave the correction into your reply without making them feel bad.
Example: if they say "I goed", you reply using "went" naturally in your sentence.
Never use bullet points or lists. Sound human, warm, and encouraging.`,

  strict: `You are James, a professional IELTS exam coach. 
You are firm but fair. Keep replies to 2-3 sentences.
Directly correct grammar and vocabulary errors, then explain why briefly.
Focus on academic English, formal tone, and exam-ready language.
Ask follow-up questions that simulate IELTS speaking tasks.
Never be harsh, but always be precise and professional.`,

  casual: `You are Alex, the user's cool English-speaking friend.
Talk like a real person texting a friend. Use natural contractions, casual phrases.
Keep it fun and relaxed. 1-2 sentences max.
Gently correct mistakes by using the right form naturally in your reply.
Ask fun follow-up questions about their life, opinions, interests.`,

  motivational: `You are Coach Sarah, an energetic and motivational language coach.
You celebrate every effort the user makes. Keep replies to 2-3 sentences.
Always find something positive to highlight before correcting.
Use encouraging phrases naturally. 
End each reply with an inspiring challenge or question to push them further.`,
};

const LEVEL_ADDITIONS = {
  beginner: 'The user is a beginner. Use very simple vocabulary. Short sentences. Be extra patient.',
  intermediate: 'The user is intermediate. Use natural everyday vocabulary. Introduce slightly challenging words occasionally.',
  advanced: 'The user is advanced. Use rich vocabulary. Challenge them with complex ideas and nuanced language.',
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

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const basePrompt = PERSONALITIES[personality] || PERSONALITIES.friendly;
    const levelNote = LEVEL_ADDITIONS[level] || LEVEL_ADDITIONS.intermediate;
    const langNote = language === 'Arabic'
      ? 'You are an Arabic language tutor. Respond in Arabic with English transliteration when helpful.'
      : 'You are an English language tutor. Always respond in English.';

    const systemPrompt = `${basePrompt}\n\n${levelNote}\n\n${langNote}\n\nIMPORTANT: Never sound like a chatbot or AI assistant. Sound like a real human tutor who genuinely cares.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-8), // keep last 8 turns for context
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
        temperature: 0.75,
        max_tokens: 120,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Groq error:', data);
      return res.status(500).json({ error: 'AI service error' });
    }

    const reply = data.choices?.[0]?.message?.content?.trim() || "Sorry, could you say that again?";
    res.json({ reply });

  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`LinguaVox backend running on port ${PORT}`);
});
