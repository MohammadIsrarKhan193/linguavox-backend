const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Health check (also used to "wake" the free Render server)
app.get('/', (req, res) => {
  res.send('LinguaVox backend is alive 🪐');
});

// Main conversation endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { message, language, history } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const systemPrompt = language === 'Arabic'
      ? 'You are a friendly, encouraging Arabic language tutor. Keep replies short (1-3 sentences), natural, and conversational. Gently correct mistakes without being harsh. Speak like a real human tutor, not a robot.'
      : 'You are a friendly, encouraging English language tutor. Keep replies short (1-3 sentences), natural, and conversational. Gently correct mistakes without being harsh. Speak like a real human tutor, not a robot.';

    const messages = [
      { role: 'system', content: systemPrompt },
      ...(history || []),
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
        temperature: 0.7,
        max_tokens: 200,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Groq error:', data);
      return res.status(500).json({ error: 'AI service error' });
    }

    const reply = data.choices?.[0]?.message?.content || '...';
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
