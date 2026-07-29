// ============================================================
// LEVELS
// Defines pacing, vocabulary complexity, and reply-length targets
// per level. Reply-length targets are what keep responses
// conversational instead of long paragraphs.
// ============================================================
const LEVEL_CONTEXT = {
  beginner: 'The student is a beginner. Use very simple words and short sentences. Be extra patient and explain every term you use. Keep your reply to 2 short, simple sentences maximum — one idea per sentence.',
  intermediate: 'The student is intermediate. Use natural vocabulary. You can introduce new words but always explain them. Keep your reply to 2-3 natural sentences.',
  advanced: 'The student is advanced. Use rich language. Challenge them with nuanced grammar and sophisticated vocabulary. Keep your reply to 3-4 sentences — conversational in tone, never a lecture, even at this level.',
};

const ARABIC_LEVEL_CONTEXT = {
  beginner: 'المتعلم مبتدئ. استخدم كلمات بسيطة جداً وجملاً قصيرة. اشرح كل مصطلح تستخدمه. اجعل ردك جملتين قصيرتين كحد أقصى.',
  intermediate: 'المتعلم في المستوى المتوسط. استخدم لغة طبيعية وقدّم كلمات جديدة مع شرحها. اجعل ردك 2-3 جمل طبيعية.',
  advanced: 'المتعلم متقدم. استخدم لغة غنية وتحديات نحوية معقدة. اجعل ردك 3-4 جمل — بأسلوب محادثة طبيعي، وليس محاضرة، حتى في هذا المستوى.',
};

module.exports = { LEVEL_CONTEXT, ARABIC_LEVEL_CONTEXT };
