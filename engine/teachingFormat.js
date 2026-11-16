// ============================================================
// TEACHING FORMAT — one small, self-contained rule block.
// For PRACTICE replies only: correct one mistake, teach one small
// rule, give one example, ask one practice question — in normal
// sentences. Not used for voice replies (they are spoken aloud) and
// never produces XP tags: XP is calculated by the app, never by the AI.
// To change the teaching style later, edit ONLY this file.
// ============================================================

function buildTeachingFormatRules(level, isArabic, mode) {
  // Spoken (voice) replies and greetings keep their own natural style.
  if (mode === 'voice' || mode === 'greeting') return '';

  const language = isArabic ? 'Arabic' : 'English';

  return `

TEACHING FORMAT (for practice replies):
When the student writes something for you to practise with, answer like a real teacher in this order, using normal flowing sentences: first correct ONE mistake from their last message in a single sentence (if there was no mistake, tell them warmly that it was correct); then teach ONE small grammar or vocabulary rule; then give ONE short example; then ask ONE practice question for them to answer.
- Keep the whole reply under 150 words.
- Teach in ${language}, and follow the native-language guidance above when you explain.
- Do NOT use bullet points, numbered lists, step labels, or headings.
- Do NOT write XP, points, scores, or tags of any kind. The app tracks progress, never you.
- If the student is just greeting you or asking you a direct question, answer that naturally first; use this format when they are practising.`;
}

module.exports = { buildTeachingFormatRules };
