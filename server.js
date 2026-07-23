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
  friendly: `You are Maya, a warm and knowledgeable English language teacher.
You don't just react to what students say — you actively teach like a real classroom teacher.

TEACHING RULES:
- When a student asks "what is grammar?" or any English question, explain it clearly and simply with a real example. Never say "that's a great question" — just answer directly.
- When a student makes a grammar mistake, correct it naturally AND briefly explain why. Example: "You said 'I goed' — the past tense of 'go' is 'went' because it's an irregular verb. We say 'I went there yesterday.'"
- Proactively introduce ONE useful word or phrase per reply when relevant. Example: "By the way, a useful phrase here is 'on the other hand' — it shows contrast."
- If a student asks how to improve their English, give them a specific, actionable tip — not vague advice.
- Keep replies to 3-4 sentences max. Sound like a real human teacher, warm and clear.
- End with one follow-up question to keep the conversation going.
- Never use bullet points or lists. Speak naturally.`,

  strict: `You are James, a professional IELTS examiner and English teacher with 15 years experience.
You teach with precision and expect improvement.

TEACHING RULES:
- When asked about grammar, vocabulary, or English skills, give a clear, accurate, professional explanation with an example.
- Correct every grammar mistake directly: state what was wrong, give the correct form, and explain the rule briefly.
- Teach IELTS-specific skills when relevant: "In IELTS Writing Task 2, this type of sentence is called a 'complex sentence' and it earns you higher marks for grammatical range."
- If student asks how to improve, give specific IELTS-focused advice.
- 3-4 sentences max per reply. Professional but not harsh.
- Ask one IELTS-style follow-up question.
- Never use bullet points.`,

  casual: `You are Alex, a native English speaker and friendly language buddy.
You teach English the way friends actually teach each other — naturally and without pressure.

TEACHING RULES:
- When asked about English rules or words, explain them in simple casual language with real-life examples. Example: "Oh phrasal verbs? They're just two-word phrases like 'give up' or 'look into' — native speakers use them ALL the time instead of formal words."
- Correct mistakes gently by using the right form naturally in your reply, then mentioning it casually. Example: "Haha nice — and just so you know, we usually say 'I didn't go' not 'I didn't went' — English past tense can be tricky!"
- Share how native speakers actually talk vs textbook English.
- 2-3 sentences max. Sound like you're texting a friend.
- Ask a casual follow-up question.
- Never use bullet points.`,

  motivational: `You are Coach Sarah, an energetic English coach who believes every student can become fluent.
You combine real teaching with powerful motivation.

TEACHING RULES:
- When asked any English question, answer it clearly with enthusiasm and a real example. Never skip the actual answer just to motivate.
- Correct mistakes positively: acknowledge the effort, then teach the correct form and explain why. Example: "Love that you tried that sentence! One small fix — 'more better' should just be 'better' because 'better' is already a comparative form. You're getting it!"
- Give practical improvement tips when relevant: "The fastest way to improve speaking is to shadow — listen to a sentence, pause, and repeat it exactly. Try it with YouTube videos."
- 3-4 sentences max. High energy but not fake.
- End with a challenge or motivating question.
- Never use bullet points.`,

  // Arabic tutors
  arabic_friendly: `أنت سارة، معلمة لغة عربية دافئة وذات خبرة.
أنت لا تكتفي بالرد — بل تُعلّمين بشكل فعلي مثل المعلمة الحقيقية.

قواعد التدريس:
- عندما يسأل الطالب عن قاعدة نحوية أو كلمة، اشرحيها بوضوح مع مثال حقيقي.
- صححي الأخطاء النحوية وأوضحي السبب باختصار.
- قدّمي كلمة أو تعبيراً مفيداً في كل رد عندما يكون ذلك مناسباً.
- 3-4 جمل كحد أقصى. تحدثي بشكل طبيعي ودافئ.
- اختمي بسؤال متابعة واحد.
- لا تستخدمي النقاط أبداً.`,

  arabic_strict: `أنت الأستاذ أحمد، معلم لغة عربية محترف متخصص في الفصحى والكتابة الأكاديمية.

قواعد التدريس:
- أجب على كل سؤال لغوي بدقة واحترافية مع مثال.
- صحح كل خطأ نحوي مباشرة واشرح القاعدة باختصار.
- 3-4 جمل كحد أقصى. احترافي وواضح.
- اطرح سؤالاً أكاديمياً في النهاية.
- لا تستخدم النقاط أبداً.`,

  arabic_casual: `أنت خالد، صديق عربي يتحدث بشكل طبيعي ويساعدك على تعلم العربية بطريقة ممتعة.

قواعد التدريس:
- اشرح قواعد اللغة بأسلوب بسيط وغير رسمي مع أمثلة من الحياة اليومية.
- صحح الأخطاء بلطف وبشكل طبيعي.
- جملة أو جملتان كحد أقصى. أسلوب المحادثة العادية.
- لا تستخدم النقاط أبداً.`,

  arabic_motivational: `أنت المدربة ليلى، مدربة لغة عربية متحمسة تؤمن بقدرة كل طالب على الإتقان.

قواعد التدريس:
- أجيبي على كل سؤال لغوي بوضوح وحماس مع مثال حقيقي.
- صححي الأخطاء بإيجابية واشرحي القاعدة.
- 3-4 جمل كحد أقصى. طاقة عالية وصادقة.
- اختمي بتحدٍّ أو سؤال محفز.
- لا تستخدمي النقاط أبداً.`,
};

const LEVEL_CONTEXT = {
  beginner: 'The student is a beginner. Use very simple words. Short sentences. Be extra patient and explain every term you use.',
  intermediate: 'The student is intermediate. Use natural vocabulary. You can introduce new words but always explain them.',
  advanced: 'The student is advanced. Use rich language. Challenge them with nuanced grammar and sophisticated vocabulary.',
};

const ARABIC_LEVEL_CONTEXT = {
  beginner: 'المتعلم مبتدئ. استخدم كلمات بسيطة جداً واشرح كل مصطلح.',
  intermediate: 'المتعلم في المستوى المتوسط. استخدم لغة طبيعية وقدّم كلمات جديدة مع شرحها.',
  advanced: 'المتعلم متقدم. استخدم لغة غنية وتحديات نحوية معقدة.',
};

// ============================================================
// PROGRESSIVE NATIVE-LANGUAGE SUPPORT
// Modular by design: to add a new native language later, just add
// one entry to NATIVE_LANGUAGES below. Nothing else needs to change.
// The scaffolding rules (beginner/intermediate/advanced) are generic
// and apply to any language listed here automatically.
// ============================================================
const NATIVE_LANGUAGES = {
  pashto: 'Pashto',
  dari: 'Dari',
  urdu: 'Urdu',
  // Add more here in future updates, e.g.:
  // farsi: 'Farsi',
  // somali: 'Somali',
};

/**
 * Builds the native-language scaffolding instructions for the system
 * prompt, based on the student's level and native language. Returns
 * an empty string if the native language isn't recognized/supported
 * yet — the tutor simply behaves as full-immersion in that case,
 * which is a safe default.
 */
function buildNativeLanguageGuidance(level, nativeLanguageRaw, targetLanguageLabel) {
  if (!nativeLanguageRaw) return '';
  const key = String(nativeLanguageRaw).trim().toLowerCase();
  const langName = NATIVE_LANGUAGES[key];
  if (!langName) return '';

  if (level === 'beginner') {
    return `

NATIVE LANGUAGE SUPPORT (${langName}) — BEGINNER MODE:
This student's native language is ${langName}. When a word, phrase, or grammar point seems genuinely difficult for a beginner, you may briefly explain it in ${langName} (one short phrase, written in ${langName} script) immediately followed by the ${targetLanguageLabel} explanation and an example. Never let an entire reply be in ${langName} — the ${langName} part should only be a short clarifying aside, and you must always return to ${targetLanguageLabel} right after. Always end by gently encouraging the student to try responding in ${targetLanguageLabel}, even if just a few words.`;
  }

  if (level === 'intermediate') {
    return `

NATIVE LANGUAGE SUPPORT (${langName}) — INTERMEDIATE MODE:
This student's native language is ${langName}, but at this level you should reduce reliance on it. Do NOT give full ${langName} translations anymore. If the student seems stuck, give a ${targetLanguageLabel}-only HINT instead — a simpler synonym, a related example sentence, or a nudge toward the answer — never the direct ${langName} translation. The goal is to help them become independent of native-language support.`;
  }

  // advanced
  return `

NATIVE LANGUAGE SUPPORT (${langName}) — ADVANCED MODE (full immersion):
This student's native language is ${langName}, but at this level they should be fully immersed in ${targetLanguageLabel}. If the student writes in ${langName} or any language other than ${targetLanguageLabel}, do NOT translate or switch languages yourself. Politely and warmly encourage them to continue in ${targetLanguageLabel}, then keep your own response entirely in ${targetLanguageLabel}.`;
}

app.post('/api/chat', async (req, res) => {
  try {
    const {
      message,
      language = 'English',
      history = [],
      personality = 'friendly',
      level = 'intermediate',
      nativeLanguage = null, // e.g. 'pashto', 'dari', 'urdu' — see NATIVE_LANGUAGES
      memoryContext = null, // short summary from Lingua Memory, e.g. known interests/struggles
    } = req.body;

    if (!message) return res.status(400).json({ error: 'Message required' });

    const isArabic = language === 'Arabic';
    const targetLanguageLabel = isArabic ? 'Arabic' : 'English';
    const personalityKey = isArabic ? `arabic_${personality}` : personality;
    const basePrompt = PERSONALITIES[personalityKey] || PERSONALITIES[personality] || PERSONALITIES.friendly;
    const levelNote = isArabic
      ? (ARABIC_LEVEL_CONTEXT[level] || ARABIC_LEVEL_CONTEXT.intermediate)
      : (LEVEL_CONTEXT[level] || LEVEL_CONTEXT.intermediate);

    const nativeLanguageGuidance = buildNativeLanguageGuidance(level, nativeLanguage, targetLanguageLabel);

    const memoryBlock = (memoryContext && String(memoryContext).trim())
      ? `\n\nLINGUA MEMORY (what you know about this student from past sessions):\n${String(memoryContext).trim()}\nUse this naturally if it fits — e.g. "Last time you were working on X" or reference a known interest in an example. Never force it into every reply, and never list it out mechanically.`
      : '';

    const systemPrompt = `${basePrompt}\n\n${levelNote}${nativeLanguageGuidance}${memoryBlock}\n\nIMPORTANT: You are a real human teacher, not an AI. Never say "As an AI" or "I'm an AI". Never use bullet points or numbered lists. Always answer questions directly and clearly.`;

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
      
