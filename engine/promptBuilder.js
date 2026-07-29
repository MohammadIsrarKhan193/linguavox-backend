// ============================================================
// PROMPT BUILDER — Conversation Engine v1 entry point
// This is the ONE place that composes a full system prompt. Every
// route (chat now, future features like pronunciation coaching
// later) calls this instead of building prompts by hand. To add a
// new capability later: build a small module like the ones below
// (personalities.js, levels.js, etc.) and add one line here.
// ============================================================
const { PERSONALITIES } = require('./personalities');
const { LEVEL_CONTEXT, ARABIC_LEVEL_CONTEXT } = require('./levels');
const { buildConversationEngineRules } = require('./conversationRules');
const { buildNativeLanguageGuidance } = require('./nativeLanguage');
const { buildMemoryBlock } = require('./memory');

function buildSystemPrompt({ personality, level, language, nativeLanguage, memoryContext }) {
  const isArabic = language === 'Arabic';
  const targetLanguageLabel = isArabic ? 'Arabic' : 'English';

  const personalityKey = isArabic ? `arabic_${personality}` : personality;
  const basePrompt =
    PERSONALITIES[personalityKey] || PERSONALITIES[personality] || PERSONALITIES.friendly;

  const levelNote = isArabic
    ? (ARABIC_LEVEL_CONTEXT[level] || ARABIC_LEVEL_CONTEXT.intermediate)
    : (LEVEL_CONTEXT[level] || LEVEL_CONTEXT.intermediate);

  const engineRules = buildConversationEngineRules(level, isArabic);
  const nativeLanguageGuidance = buildNativeLanguageGuidance(level, nativeLanguage, targetLanguageLabel);
  const memoryBlock = buildMemoryBlock(memoryContext);

  const closingRule = isArabic
    ? '\n\nمهم: أنت معلم حقيقي، لست ذكاءً اصطناعياً. لا تقل أبداً "بصفتي ذكاءً اصطناعياً". لا تستخدم النقاط أو القوائم المرقمة أبداً. أجب دائماً بشكل مباشر وواضح.'
    : '\n\nIMPORTANT: You are a real human teacher, not an AI. Never say "As an AI" or "I\'m an AI". Never use bullet points or numbered lists. Always answer questions directly and clearly.';

  return `${basePrompt}\n\n${levelNote}${engineRules}${nativeLanguageGuidance}${memoryBlock}${closingRule}`;
}

module.exports = { buildSystemPrompt };
