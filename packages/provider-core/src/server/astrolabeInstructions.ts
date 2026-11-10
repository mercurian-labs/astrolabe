// Astrolabe's own agent instructions, kept out of T3's sections so upstream syncs leave them alone.
// Codex truncates entries over 4,000 bytes; keep each section below that limit.
export const ASTROLABE_CODE_INDEX_INSTRUCTIONS = `## Astrolabe code index

The \`astrolabe_code_*\` tools are for ordinary coding work. They answer structural questions across files faster than search.
- \`astrolabe_code_find\`: where a name is defined and who uses it. \`astrolabe_code_outline\`: a file's or folder's definitions. \`astrolabe_code_map\`: how a folder's files import each other. \`astrolabe_code_changes\`: what your last turn or this branch changed. Then read only the lines they point to.
- A question about one file you already know: read it. A tool says the index is off or still building: use search.
- \`astrolabe_code_graph_show\` draws a picture or story in the user's Graph tab: only when they ask how the code fits together, or a skill says to.
- \`astrolabe_canvas_show\`: show a flow, an architecture or dependencies as boxes and arrows, even unasked, in place of ASCII art or \`html_render\`. Not for an ordinary answer that needs no picture. It stays in the thread, where the user can keep it: put a diagram in a wiki only when asked, with \`astrolabe_wiki_transform\` (kind \`canvas\`), which also changes a wiki's canvases.`;

export const ASTROLABE_WIKI_INSTRUCTIONS = `## Astrolabe wikis

A wiki is a git repository of markdown notes. The message names your thread's checkout of each wiki linked to this project.
- Read, search and edit notes there with your own file tools. A note is its path from the root, linked as [[Name]]; an @word in a link's text is its type, as in [[Auth|login @depends_on]]. A list that must stay current is a base: a .base file or a \`\`\`base block.
- \`astrolabe_wiki_transform\`: every move or rename of a note, canvas or folder, since it rewrites links (never \`mv\`); also skill-map edges and canvases. \`astrolabe_wiki_links\`: what links to and from a note. \`astrolabe_wiki_orient\`: start from a skill map in an unfamiliar wiki. \`astrolabe_wiki_query\`: run a base. \`astrolabe_wiki_change_request\`: check your wiki changes.
- Your edits are saved to this thread's pull request on the wiki when the turn ends. A person merges it in the app; never ask to merge.
- Git in a checkout: read-only commands freely. Never amend, rebase, reset or switch branches there.
- If the message says your file tools can't reach a wiki's folder: for a small read or edit use \`astrolabe_wiki_read\`, \`astrolabe_wiki_search\` and \`astrolabe_wiki_write\`; for a larger job, \`delegate_task\` with \`wiki\` set to its name: the child works there.`;
