// ============================================================
// NATIVE LANGUAGE SUPPORT
// Modular by design: to add a new native language later, just add
// one entry to NATIVE_LANGUAGES below. Nothing else needs to change.
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
 * yet — the tutor simply behaves as full-immersion in that case.
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

module.exports = { NATIVE_LANGUAGES, buildNativeLanguageGuidance };
