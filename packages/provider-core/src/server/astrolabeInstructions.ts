// Astrolabe's own agent instructions, kept out of T3's sections so upstream syncs leave them alone.
// Codex truncates entries over 4,000 bytes; keep each section below that limit.
export const ASTROLABE_CODE_INDEX_INSTRUCTIONS = `## Astrolabe code index

The \`astrolabe_code_*\` tools are for ordinary coding work. They answer structural questions across files faster than search.
- \`astrolabe_code_find\`: where a name is defined and who uses it. \`astrolabe_code_outline\`: a file's or folder's definitions. \`astrolabe_code_map\`: how a folder's files import each other. \`astrolabe_code_changes\`: what your last turn or this branch changed. Then read only the lines they point to.
- A question about one file you already know: read it. A tool says the index is off or still building: use search.`;
