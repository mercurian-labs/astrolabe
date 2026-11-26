// Astrolabe's own agent instructions, kept out of T3's sections so upstream syncs leave them alone.
// Codex truncates entries over 4,000 bytes; keep each section below that limit.
export const ASTROLABE_CODE_INDEX_INSTRUCTIONS = `## Astrolabe code index

The \`astrolabe_code_*\` tools are for ordinary coding work. They answer structural questions across files faster than search.
- \`astrolabe_code_find\`: where a name is defined and who uses it. \`astrolabe_code_outline\`: a file's or folder's definitions. \`astrolabe_code_map\`: how a folder's files import each other. \`astrolabe_code_changes\`: what your last turn or this branch changed. Then read only the lines they point to.
- A question about one file you already know: read it. A tool says the index is off or still building: use search.
- \`astrolabe_code_graph_show\` draws a picture or story in the user's Graph tab: only when they ask how the code fits together, or a skill says to.
- \`astrolabe_canvas_show\`: show a flow, an architecture or dependencies as boxes and arrows, even unasked, in place of ASCII art or \`html_render\`. Name a group per region or stage, then put the result's \`![[Name.canvas#Group]]\` in your prose where that part is explained, or \`![[Name.canvas]]\` for a small board. Not for an ordinary answer that needs no picture. It stays in the thread, where the user can keep it: put a diagram in the project's docs only when asked, with \`astrolabe_project_transform\` (kind \`canvas\`), which also changes the project's canvases.`;

export const ASTROLABE_PROJECT_DOCS_INSTRUCTIONS = `## Astrolabe project docs

A project's notes, bases and canvases are files in its folders. Read, search and edit them with your own file tools, as you do code.
- A note is its path from its folder, linked as [[Name]], or [[folder:Name]] for one in another of the project's folders; an @word in a link's text is its type, as in [[Auth|login @depends_on]]. A list that must stay current is a base: a .base file or a \`\`\`base block, YAML you edit like any file.
- \`astrolabe_project_query\`: run a base after changing one, to check what it lists and fix any warnings.
- \`astrolabe_project_transform\`: every move or rename of a note, canvas or folder, since it rewrites links across the project's folders (never \`mv\`); also skill-map edges and canvases.
- \`astrolabe_project_links\`: what links to and from a note, across the project's folders.
- \`astrolabe_project_orient\`: start from a skill map in an unfamiliar area.
- If the message says your file tools can't reach a folder, \`delegate_task\` the job with \`wiki\` set to its name: the child works there.`;
