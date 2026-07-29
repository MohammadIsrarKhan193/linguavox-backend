// ============================================================
// MEMORY BLOCK
// Turns the short memory-context string (built client-side from
// Lingua Memory) into a prompt instruction. Deliberately generic —
// it doesn't know or care what's inside memoryContext, just how to
// present it. Future memory features plug in here without changes.
// ============================================================
function buildMemoryBlock(memoryContext) {
  if (!memoryContext || !String(memoryContext).trim()) return '';

  return `

LINGUA MEMORY (what you know about this student from past sessions):
${String(memoryContext).trim()}
Use this naturally if it fits — e.g. "Last time you were working on X" or reference a known interest in an example. Never force it into every reply, and never list it out mechanically.`;
}

module.exports = { buildMemoryBlock };
