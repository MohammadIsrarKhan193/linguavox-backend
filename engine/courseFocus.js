// ============================================================
// COURSE FOCUS
// When a conversation is tied to a Lesson Journey curriculum lesson,
// this steers the AI toward that lesson's topic — naturally, like a
// teacher following a lesson plan, not by forcing it awkwardly.
// ============================================================
function buildCourseFocusGuidance(courseFocus) {
  if (!courseFocus || !String(courseFocus).trim()) return '';

  return `

CURRENT LESSON FOCUS:
${String(courseFocus).trim()}
Gently steer the conversation toward this topic. Ask questions and give examples related to it. If the student goes off-topic, follow them briefly and naturally bring the conversation back — don't force it rigidly, a real teacher stays flexible.`;
}

module.exports = { buildCourseFocusGuidance };
