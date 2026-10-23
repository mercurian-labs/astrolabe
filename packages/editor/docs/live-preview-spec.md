# Atlas editor: live-preview specification

Status: draft 8, 2026-10-01. Draft 8 adds Vim mode (section 5.1, A116 to A121). Draft 7 was 2026-09-27. Draft 7 specifies the table's surfaces from a second Obsidian research pass (hover add bars, row and column handles, rectangle selection, the target-specific menus, and the full command set: move, duplicate, align, sort, clear and delete cells, insert table; section 4.11). Draft 6 rendered HTML as code-styled source (section 4.12). Draft 5 added table structure commands (rows and columns) and the cell menu (section 4.11). Draft 4 added in-place cell editing to the table widget. Draft 3 added rendered math and the table widget (sections 4.11 and 4.12). Draft 2 was amended after the Obsidian research pass: 51 construct cases observed in Obsidian 1.13.7 through its accessibility tree, with per-keystroke caret traces and screenshots; the record lives at `~/dev/mercurian/research/obsidian-live-preview-2026-09-26/`. Each rule carries one of three tags. **OBSERVED** means seen in Obsidian by the research pass. **DOCUMENTED** means stated by Obsidian's help or by the Silkdown UX guide's collected user expectations. **DECIDED** means our own ruling where Obsidian is silent, wrong, or where we choose to do better. A rule marked **VERIFY** is believed true of Obsidian but not yet observed; the research pass confirms or corrects it, and until then the implementer builds it as written.

Sources: the clean-room behavioural description of Silkdown (read by a separate agent; no Silkdown code was consulted for this document or for the implementation), the product owner's observations of 2026-09-25, Obsidian's Live Preview help pages, the Silkdown UX guide's list of category-wide user complaints, and the Obsidian research pass when it lands.

This document is the contract for `@mercurian/editor`'s markdown layer. The Yjs binding, agent highlights, and file bridge are specified elsewhere and unchanged.

## 1. Model

1. **The document is the Markdown string.** Nothing is converted to a document model. Presentation is a layer of decorations over source ranges: styling marks, line styles, hidden ranges, and replacement widgets. Every edit is an edit to the string. Round-trip is exact: the editor never rewrites, renumbers, reindents, or normalises text the user did not type. DOCUMENTED.
2. **The syntax tree is Lezer Markdown** as configured by CodeMirror's markdown language package, GFM dialect, plus our own parser extensions for Obsidian syntax (wikilinks, embeds, highlights, comments, tags, callout headers, footnote references, inline and block math, frontmatter). Decorators consume node names; they never re-parse text with regular expressions except inside a node's own range. DECIDED.
3. **Two reveal scopes.** Every construct is either _block_ or _inline_. Block syntax (heading marks, list markers, quote marks, fence lines, rule lines, table delimiter rows, frontmatter fences, callout headers, footnote definition labels) reveals when the selection is on its **line**. Inline syntax (emphasis, strong, strikethrough, highlight, inline code, links of every kind, images, footnote references, inline math, comments, escapes) reveals only when the selection **touches the element's range**. OBSERVED by the product owner for headings versus inline marks; the per-construct table in section 4 says which scope each construct has.
4. **Only syntax is ever hidden or atomic. Text is never atomic.** A click on rendered bold text lands on the clicked character. Arrow keys inside rendered bold text step one character at a time. Hidden marker ranges are atomic; nothing else is. DECIDED (fixes the click-snapping and word-jump defects of the reference implementation).
5. **Presentation never moves the caret or the scroll position.** No decoration rebuild, widget click, image load, focus change, parse completion, or remote (Yjs) change dispatches a selection change. The exceptions are explicit user actions whose contract says where the caret goes (toggles, list continuation, checkbox clicks say "unchanged"). DOCUMENTED.
6. **Viewport-only work.** Decorations are computed for visible ranges only. Reference-link definitions are collected once per syntax-tree version, not once per selection change, and are cached on the tree. No extension walks the whole tree on a keystroke. DOCUMENTED.

## 2. The reveal model

### 2.1 Touching

For an inline element with range `[from, to)` and a selection range `[a, b]` (a caret has `a == b`):

- The element is **touched** when `a <= to && b >= from`. Boundaries count: a caret sitting immediately before the opening marker or immediately after the closing marker reveals the element, and one character beyond either boundary hides it. OBSERVED (`L **bold** R`: revealed at keypresses 2 through 10, hidden at 1 and 11).
- A non-empty selection touches every element it overlaps or abuts. A selection reveals everything it covers so that selection is character-accurate. DOCUMENTED.
- Touching an outer emphasis span reveals its nested emphasis markers as well: in `**a *b* c**`, a caret in `a` reveals both `**` and the inner `*`. Touching only the inner span reveals the outer too, since the outer range contains it. OBSERVED.
- Multi-cursor: each range is evaluated independently; the element is revealed if any range touches it. DECIDED.

For a block element, "touched" means some selection range has a line span that intersects the element's line span, where a range ending at column 0 of a line does **not** count as being on that line (so triple-click selecting line 3 does not reveal line 4), and an element whose end is at column 0 of the next line does not extend to that line. DECIDED (removes the asymmetry the reference implementation had).

Multi-line block constructs (fenced code, blockquotes, callouts, frontmatter, tables) reveal **per line**, not per block: a caret on line 2 of a quote reveals that line's `>` and no other. The exceptions are the fence lines of a code block and the fences of frontmatter, which reveal when the caret is anywhere in the block, because they are its only syntax and a block you are editing should show its edges. OBSERVED: fenced code, block math, callouts, and block HTML act as blocks in Obsidian.

Two block markers do not follow the line rule. **List and task markers** show their literal source only while the caret is within the marker prefix: from the line start through the position just after the marker (for tasks, just after the `]`), not at or beyond the text start. With the caret anywhere in the item text, the bullet glyph or checkbox shows. OBSERVED (`- Bullet one`: literal at keypresses 0 and 1, bullet from 2; `- [ ] Open task`: literal at 0 through 5, checkbox from 6). **Quote markers never show as literals**: the rail is drawn in the marker's place in every state, and the character stays in the document at its own width. OBSERVED.

### 2.2 Focus

- A document that has never received focus reveals nothing, regardless of where CodeMirror's initial selection sits. The first heading's `#` is hidden on load. DECIDED (the reference implementation and, per the community plugin that exists to paper over it, Obsidian itself get this wrong).
- Once the editor has been focused once, reveal follows the selection and keeps following it when the editor blurs, so that clicking a toolbar button does not reflow the line the user is editing. DECIDED.
- Implementation constraint: this is a state field flipped by the first focus event, not a read of live focus during decoration builds.

### 2.3 What revealed syntax looks like

- Revealed syntax is shown **dimmed**: reduced opacity, normal weight and style (a `**` inside bold is not itself bold; a `#` inside a heading is not heading-weight or heading-size where that would change line height, see 2.4). Revealed link URLs, titles, and fence info strings are dimmed as well; there is no undimmed source except inside code. DECIDED (the reference left some revealed syntax undimmed, inconsistently).
- Revealed strikethrough markers are **not** struck through; revealed code markers keep the code background so the span reads as one unit. DECIDED.

### 2.4 Layout stability

- **Inline markers** are hidden at zero width and take their natural width when revealed, so text after them shifts when the caret arrives. This is what Obsidian does and reserving marker width produces visible gaps in prose. OBSERVED by owner; accepted.
- **Block markers are replaced in place, not removed**, so the text of the line does not move on reveal: a list marker is drawn as a bullet occupying the marker's width; a quote marker becomes a left border with the marker's indent reserved; a heading's `# ` is hidden but the heading line's left edge does not change because nothing precedes the text. VERIFY that Obsidian keeps list text in place when the bullet reveals; DECIDED regardless.
- Hidden fence and rule lines keep their line height. An image widget does not collapse to source when the caret enters its line; the source is shown **beside** the still-rendered image (see 4.9). DECIDED.
- No animation on reveal or hide. Nothing repaints continuously. DOCUMENTED and repository rule.

### 2.5 Cursor traversal

- Hidden syntax is atomic: arrow motion, word motion, and drag selection treat a hidden marker range as one unit. Because inline reveal is adjacency-based, a caret arriving next to an inline element reveals it before the next keystroke, so the caret then steps through the revealed markers one character at a time. OBSERVED (eight ArrowRight presses cross `**bold**`).
- Vertical motion that lands strictly inside a hidden block marker (for example the `# ` of a heading) snaps to the marker's end, so the caret lands on the first text character and the line reveals. DECIDED.
- Mouse click on rendered text lands on the clicked character. Mouse click on a widget (bullet, checkbox, image, callout icon) places the caret at the widget's source start unless the widget consumes the click (checkbox toggles; image and link open only with a modifier). DECIDED.
- Backspace or Delete adjacent to a **hidden** marker range removes the whole range, which can only happen for block markers because inline markers are revealed by adjacency. Backspace at the start of an empty list item's text removes the marker and leaves an empty line (Obsidian-style list exit). VERIFY.

## 3. Focus and load sequence

1. Editor mounts with the document. No line is revealed (2.2).
2. User clicks or tabs in. The caret's line and touched inline elements reveal. Nothing else changes.
3. User types. Rendering of a newly typed construct appears as soon as the parser recognises it, on the same keystroke; markers on the active element stay revealed because the caret touches them.
4. User moves off the element or line. Syntax hides. The caret's document offset is unchanged.
5. Editor blurs. Reveal state is retained (2.2).

## 4. Constructs

Column key for the summary table at the end of this section: scope (block / inline / none), hidden syntax, rendered as.

### 4.1 Headings

- ATX `#` through `######`: heading line styling always (size per level, shared weight and line-height). Off-line the marker run plus one separator character is hidden; the optional closing hash run is hidden too. On-line both are dimmed. VERIFY closing hashes.
- Inline syntax inside a heading (bold, code, links, wikilinks, highlight) is decorated normally, by descending into the heading's children. DECIDED (fixes the reference's raw nested syntax).
- Setext headings (`===` / `---` underline) get the same level 1 and 2 styling on the text line; the underline line is hidden off-line and dimmed on-line. VERIFY.
- Scope: block.

### 4.2 Emphasis, strong, strikethrough, highlight

- `*x*`, `_x_`: italic. `**x**`, `__x__`: bold. `~~x~~`: line-through. `==x==`: highlight background (Obsidian syntax, parser extension). Nested combinations decorate per level.
- Off-range: marker runs hidden. On-range: markers dimmed, span not atomic.
- Escapes `\*` render the escaped character with the backslash hidden while the caret is off the line and dimmed while it is on the line: escapes are **line-scoped**, unlike other inline syntax. OBSERVED. Intraword underscores are not emphasis (parser).
- Single-tilde subscript and caret superscript are not decorated. DECIDED.
- Scope: inline.

### 4.3 Inline code

- Monospace, slightly smaller, tinted background, small padding. Backtick runs of any length hidden off-range, dimmed on-range with the background retained.
- Scope: inline.

### 4.4 Links

- Inline `[text](url "title")`: off-range `[`, `](url "title")` hidden; text link-styled with the resolved target when the URL policy accepts it. Unsafe target: syntax still hidden, text plain, no target, and a discreet unsafe indicator class so the theme can show it. On-range: brackets, parens, URL, and title dimmed.
- Full reference `[text][label]`, collapsed `[text][]`, shortcut `[label]`: resolved against definitions with CommonMark normalisation (trim, collapse whitespace, case-fold). Collapsed references resolve by their text. The **first** definition wins. DECIDED (fixes three reference defects).
- **Bracketed text with no matching definition is not a link and is left literal**, brackets visible in every state. `[word]`, `[1]`, and `[missing]` render as typed. OBSERVED. Obsidian goes further and never resolves reference-style links in Live Preview: `[shortcut ref]` keeps its brackets even when defined. We resolve them per CommonMark. DECIDED, a deliberate departure.
- External targets (inline links, autolinks, and bare URLs whose target is `http:` or `https:`) carry a small external-link glyph after the text at rest, hidden while the element is revealed. OBSERVED in Obsidian; DECIDED.
- Reference definitions `[label]: url "title"` hide their whole line off-line and dim on-line, single line only; a definition spanning lines is left as source. DECIDED.
- Angle autolinks `<https://x>`: brackets hidden off-range, dimmed on-range, URL link-styled. Bare URLs and `www.` and email autolinks are link-styled with the correct scheme applied for the target (`https://` for `www.`, `mailto:` for emails) and nothing hidden. DECIDED (fixes the relative-URL leak).
- Angle-bracketed destinations `[a](<url>)` are unwrapped before policy and target. DECIDED.
- Nested inline syntax inside link text is decorated; a linked image renders the image, link-styled. DECIDED.
- Opening: plain click places the caret. Mod-click (Cmd on macOS, Ctrl elsewhere) opens the target in a new browsing context with no opener and no referrer, and does **not** add a cursor. DECIDED.
- Scope: inline.

### 4.5 Wikilinks and embeds (Obsidian syntax, parser extension)

- `[[Target]]`, `[[Target|alias]]`, `[[Target#Heading]]`, `[[Target#^block]]`: off-range the brackets, target, pipe, and fragment are hidden and the display text (alias if present, else target, with `#Heading` shown as `Target > Heading`) is wikilink-styled. On-range everything is shown with syntax dimmed. The link carries the raw target as a data attribute; the host resolves it. Obsidian's accessible text shows `Wikilink#Heading` for a heading target and its painted form was not confirmed; we keep `Target > Heading`. DECIDED.
- Wikilinks are recognised before reference links, so `[[x]]` never degrades to `[x]`.
- `![[Target]]` embeds: v1 renders a placeholder chip with the target name and an embed icon, not the transcluded content; on-range shows source. `![[image.png|200]]` where the target has an image extension renders as an image the host resolves via the same data attribute. DECIDED for v1.
- Scope: inline.

### 4.6 Images

- `![alt](src)` and reference images: off-range the whole source is replaced by an inline image widget with the resolved source and alt, lazy-loaded, capped at container width, atomic. Unsafe source: the source is hidden the same way as an unsafe link and a broken-image placeholder with the alt text is shown. DECIDED (consistent with links).
- On-range: the image stays rendered and the source is shown dimmed **before** it on the same line, so there is no flash of source and no height collapse. VERIFY what Obsidian does; DECIDED as written.
- Widget identity is stable while source and alt are unchanged, so unrelated edits do not reload the image.
- Scope: inline.

### 4.7 Blockquotes and callouts

- Every quote line gets quote styling: left border, reserved indent equal to the marker width, muted colour. Nesting shows one border per level. The `>` and its following space are always drawn as the rail; there is no literal state, and the characters stay in the document at their own width so the caret can still delete them. OBSERVED. Scope: block, per line, with nothing to reveal.
- Callouts `> [!type] Title` (Obsidian syntax): the first line renders as a callout header with an icon slot keyed by type and the title text; the body lines are quote lines with the callout's colour. `> [!type]- Title` is collapsible: off-line the body is folded to the header with a chevron; a caret in the body or a click on the chevron unfolds. Unknown types render with a default icon. OBSERVED: a collapsed callout exposes only its title at rest.

### 4.8 Lists and tasks

- Bullet items `-`, `*`, `+`: the marker is replaced in place by a bullet glyph of the same width, except while the caret is within the marker prefix (line start through the position just after the marker), where the literal marker shows dimmed. With the caret in the item text the bullet stays. Nested items indent by their source indentation and show a faint vertical guide per level. OBSERVED (guide included).
- Ordered items `1.` / `1)`: the number is always shown as typed, styled; never hidden, never renumbered.
- Tasks `- [ ]`, `- [x]`, `- [X]`, `- [-]`: the checkbox sits in the list marker's slot and the `[ ]` collapses to zero width, except while the caret is within the prefix (line start through the position just after `]`), where the literal `- [ ]` shows dimmed. With the caret in the item text the checkbox stays and the text does not move. Clicking toggles between `[ ]` and `[x]` (any other character becomes `[ ]`), as its own undo step, without moving the caret or focus. Checked and cancelled items' text is struck and muted; `[-]` renders as a checked, cancelled checkbox. The marker is atomic; Backspace after it removes it whole. OBSERVED (prefix reveal, `[-]` appearance, click toggles state).
- Scope: block.

### 4.9 Fenced code

- Every line of the block gets code-block styling (monospace, background, padding; rounded first and last lines). The body is editable source with language highlighting when the info string resolves; the language catalogue loads lazily.
- Off-block: the opening fence line shows a small language label at the right and the fence characters are hidden; the closing fence line is hidden. Both lines keep their height. A copy button appears on hover of the block (no continuous animation).
- On-block (caret anywhere in the block): both fence lines are shown dimmed. VERIFY.
- Container prefixes on the fence lines (`> ` or list indentation) are not hidden with the fence.
- Indented (four-space) code blocks get code-block styling without a language. DECIDED.
- Scope: block (fences reveal for the whole block).

### 4.10 Horizontal rules

- `---`, `***`, `___`, `* * *`: off-line the text is hidden and the line shows a rule drawn as a border; on-line the source is dimmed. A `---` directly under a paragraph is a setext heading (4.1), and a leading `---` at document start is frontmatter (4.14), never a rule.
- Scope: block.

### 4.11 Tables

- A GFM table renders as a **table widget** at rest: a real `<table>` with header row, body rows, and column alignment from the delimiter row, replacing every line of the table. Cell text is rendered with inline formatting (bold, italic, strikethrough, highlight, inline code, links, wikilinks) by parsing each cell's source with the same Markdown parser; nothing in a cell is editable in place in this slice. OBSERVED that Obsidian always shows a table widget; DECIDED for the rendering.
- The widget is atomic and block-level, provided by a state field (a view plugin may not replace line breaks). It stays rendered while the table is edited: cells are edited **in place**, as Obsidian does. OBSERVED that Obsidian's table is always a widget whose cells are embedded editors, that arrow navigation enters a cell, that inline `**` reveals within the active cell, that Cmd-A selects the cell, and that Escape leaves it. The pipe source is shown only when a selection made in the outer editor overlaps the table without being a cell caret (for example select-all), which keeps whole-document operations honest. DECIDED.
- **The active cell.** At most one cell is active at a time, held in a state field as the table's start and the cell's row and column, mapped through changes and cleared when its table is deleted or reparsed away. The active cell hosts a **child editor**: a nested CodeMirror view whose document is that cell's source text, with the live preview's inline extensions (so `**bold**` in the cell reveals on adjacency exactly as in the outer editor), the same theme, and no line wrapping across cells. Every change in the child is applied to the outer document as a replacement of the cell's source range in one transaction tagged with an annotation, so Yjs, undo, and the agent highlights see ordinary edits; every outer change inside that range (a remote peer, an undo) is applied to the child without moving its caret when the change is outside it. Only the active cell has a child editor; deactivating destroys it and the cell renders statically again. The outer selection rests collapsed at the active cell's source start while the child has focus, so outer keymaps stay quiet. DECIDED.
- **Entering a cell.** A click on a rendered cell activates it with the child caret at the clicked character (end of the cell when the click is past the text). ArrowDown from the line above the table enters the first cell of the first row; ArrowUp from the line below enters the last cell of the last row; ArrowRight from the end of the line above and ArrowLeft from the start of the line below enter the first and last cell respectively. DECIDED.
- **Moving between cells.** Inside a cell: Tab and Shift-Tab move to the next and previous cell across rows; Enter moves to the cell below in the same column, and in the last row appends a new empty row (`|   |   |` with the table's column count) and enters its first cell; ArrowRight at the cell's end and ArrowLeft at its start move to the adjacent cell; ArrowUp on the cell's only line moves to the cell above and ArrowDown to the cell below. At the table's edges: Tab on the last cell and Shift-Tab on the first stay put; ArrowDown from the last row and ArrowUp from the first row leave to the line below or above; ArrowLeft from the first cell's start and ArrowRight from the last cell's end leave to the end of the line above or the start of the line below. Escape leaves the cell with the outer caret placed after the table, the outer editor focused, and the table still rendered. DECIDED.
- **Cell content rules.** A cell cannot hold a line break; Enter never inserts one. Typing `|` inside a cell inserts `\|` in the source and renders as a pipe. Backspace at the start of an empty cell does nothing to the table structure. Mod-A inside a cell selects that cell's text only. Mod-click on a link inside a cell opens it. DECIDED.
- Widths follow the content; a cell with no text keeps a minimum width so it can be clicked. DECIDED.
- **The table as a grid.** For every structure command the table is a grid whose row 0 is the header and whose delimiter row is not a row. Commands that would break the grid are **omitted** from menus, never shown disabled: the header has no _Move row up_, the last body row no _Move row down_, the first column no _Move column left_, the last column no _Move column right_, a one-column table no _Delete column_. OBSERVED. Deleting the header promotes the first body row to header; moving the first body row up swaps it with the header; _Add row above_ on the header inserts a new empty header row and demotes the old header to the first body row (VERIFY the last; the first two OBSERVED). DECIDED that our commands follow the grid model rather than refusing on the header.
- **Structure commands.** All of these are exported CodeMirror commands on the outer editor acting on the **current cell** (the active cell, else the cell whose slot holds the outer caret while the source rows show, else the anchor of a rectangle selection), each one transaction and one undo step; the editor installs no default shortcuts (Obsidian has none; its command palette lists them as `Table: …`). Byte rule, DECIDED and deliberately unlike Obsidian: a command never reformats the rows it does not touch and never re-pads a row it does touch beyond the cell it adds or removes; Obsidian normalises the whole table's padding on every command, which is fine for a human file and hostile to agents diffing files. Rows: **add row above / below** (`|` + `   |` per column on its own line), **move row up / down** (swap the two lines, byte for byte), **duplicate row** (copy the line below itself), **delete row** (remove the line and its line break). Columns: **add column left / right** (`   |` per header and body row, ` --- |` in the delimiter, no alignment; a short row is padded to the header first; a row without outer pipes gains the boundary the new cell needs), **move column left / right** (swap the two columns' slots in every row, delimiter included, so alignment travels with the column; a row lacking either column is left alone; a row without outer pipes gains a leading or trailing pipe when a blank slot would otherwise land at its open edge, since a blank first or last slot needs the pipe to remain a cell), **duplicate column** (copy the slot and its delimiter cell to its right), **delete column** (remove the slot and its pipe from every row that has it; every row keeps at least one pipe; the delimiter regains its closing pipe if needed), **align left / center / right** (rewrite only the target column's delimiter cell as `:---`, `:--:`, `---:` keeping the cell's width, so `---` becomes `:-:`; only a cell too narrow for its colons grows to the minimum valid form; choosing the current alignment changes nothing and returns false). Sort: **sort by column A to Z / Z to A** (reorder the body rows by the target column's cell text, case-insensitive natural order, stable; rows move as whole lines). Cells: **clear cells** (empty every cell of the rectangle, keeping the rows; a row without outer pipes gains the pipe a blank edge cell needs, as every command that can leave a blank slot at an open edge does), **delete cells** (offered only when the rectangle spans every column, deleting those rows, or every row including the header, deleting those columns; a rectangle that spans the whole table deletes the table, leaving the caret where the table began). Table: **insert table** (after the caret's top-level block, as its own paragraph, and false when the caret is inside a table, a code block, an HTML block, a math block, or frontmatter: `|     |     |`, `| --- | --- |`, `|     |     |`, first header cell active). OBSERVED for the command set and the source shapes of add, move, duplicate, delete, align, sort, clear, delete cells, and insert table; the byte rule is DECIDED.
- **Where the focus goes.** After add row: the new row's cell in the current column. After add column: the new cell in the current row. After delete row: the same column in the row below, else above, else the header. After delete column: the same index, else the previous. After move: the moved cell, still active with its caret where it was. After duplicate: the original stays active, caret kept. After align and sort: the current cell stays active, caret kept. Commands that activate a different or new cell put the caret at its start. After insert table: the first header cell. After clear cells: the rectangle's anchor cell. After delete cells: the cell that now occupies the anchor's place, else the header's cell in that column. Undo and redo keep a cell active with focus: the active cell is found again by its grid place when its line was replaced, and it follows the undo manager's restored caret (a selection-only transaction with no user event) onto the cell that was active before the command; a caret the browser's selection observer parks on the widget's edge (a `select` user event) never moves it; the active cell clears only when its own table is gone. OBSERVED where Obsidian exposed the focus; DECIDED for the rest.
- **Cell menu.** A right-click on a rendered cell, inside the active cell's child editor included, opens a menu with two submenus and two entries: **Row** (Add row above, Add row below, Move row up, Move row down, Duplicate row, Delete row), **Column** (Add column to the left, Add column to the right, Move column left, Move column right, Align left, Align center, Align right, Duplicate column, Delete column), then **Sort by column (A to Z)** and **Sort by column (Z to A)**. Inapplicable entries are omitted per the grid rule. A populated cell and an empty cell get the same menu. A right-click on a link inside a cell, or on selected text inside the child editor, gets the same table menu; link and text commands belong to the host, which may prepend its own entries. OBSERVED for the structure and the omissions; DECIDED that the editor draws no text or link entries. The menu is drawn by the editor in plain CSS from the theme's properties, opens at the pointer inside the editor's DOM, stays within the viewport, and closes on Escape, an outside mousedown, a scroll, or any document change. Submenus open on hover or click of their parent and on ArrowRight; ArrowUp and ArrowDown move within a level, ArrowLeft closes a submenu, Enter chooses. DECIDED.
- **Hover add bars.** The widget reserves a thin strip along the table's bottom edge (full width, about a line's height) and one along its right edge (full height, the same thickness). A `+` bar appears in a strip only while the pointer rests **in that strip**, never from hovering the table itself, and only one bar shows at a time (the corner where the strips meet belongs to the bottom strip). The bottom bar's tooltip is **Add row below**, the right bar's **Add column to the right**. A bar appears after a short delay (about 300 ms) and leaves with the pointer, with no continuous animation. Owner's ruling of 2026-09-27; Obsidian shows a bar when the pointer nears that edge. A click on the bottom bar runs _add row below_ on the last row and activates the new row's first cell; a click on the right bar runs _add column to the right_ on the last column and activates the new header cell. A right-click on a bar is not a table target: it does nothing in the editor (Obsidian shows its ordinary text menu there). There are no top or left add bars. The space the bars occupy is reserved whenever they can appear, so their appearance shifts nothing; a read-only editor draws neither bars nor that space. On a table wider than the editor, the bars sit at the widget's visible bottom and right edges and do not scroll with the content. OBSERVED for the bars, their names, and their effects; DECIDED for the in-strip rule, one at a time, the delay, the reserved space, and the scrolling rule.
- **Row and column handles.** The widget reserves a gutter along the table's left edge and one along its top edge (the same thickness as the add bars' strips), in editable editors only. A grip (six dots, two columns of three) appears in the left gutter beside a row only while the pointer rests in the gutter beside that row, and in the top gutter above a column only while the pointer rests in the gutter above that column; one grip shows at a time, and hovering the table itself shows none. The header row has a grip too. A click on a row handle selects the whole row; a click on a column handle selects the whole column, header included. The selection draws as a rounded outline with a translucent fill in the accent colour, and the row's or column's first cell becomes the active cell with the caret at the end of its text. A command chosen from a handle's menu keeps a selection: afterwards the row (from a row handle) or column (from a column handle) holding the newly active cell is selected. A right-click on a row handle opens a flat menu of the six row commands; on a column handle a flat menu of Sort A to Z, Sort Z to A, Add column to the left, Add column to the right, Move column left, Move column right, Align left, Align center, Align right, Duplicate column, Delete column, in that order, with the same omissions. Dragging a body row's handle moves the row: while dragging, a horizontal indicator line shows the drop position between body rows (never above the header; the header row's handle does not drag), the row lands there on release as one transaction that cuts its line and inserts it at the drop position, byte for byte, and Escape cancels. Dragging a column handle moves the column, header and delimiter included, the same way with a vertical indicator, cutting each row's slot and inserting it at the drop column. OBSERVED for the handles' hotspots, the selection they make, and their menus; DOCUMENTED (the owner's screenshots) for the grip glyph and for dragging as the way to reposition; DECIDED for the gutters, the in-gutter rule, the indicator, cancel, and the non-dragging header row handle. Handles also appear on a table written without outer pipes.
- **Rectangle selection.** Dragging from inside one rendered cell to inside another selects the rectangle of cells between them, drawn with the same outline and fill; the header can be part of it. The anchor cell (where the drag started) is the active cell. Backspace and Delete on a rectangle that spans every column delete those rows; on any other rectangle they clear the cells. Typing replaces nothing: it goes to the active cell and collapses the rectangle to it. Escape collapses it too, as does any document change that is not the rectangle's own command (an undo included); the active cell stays. The right-click menu on a rectangle is: Cut, Copy, Paste, Align left, Align center, Align right (applied to every column in the rectangle), Clear cells, Delete cells (when applicable). Cut and Copy put the cells on the clipboard as tab-separated rows and as a Markdown table fragment; Paste over a rectangle fills it row by row from tab-separated or pipe-separated clipboard text, writing a padded cell the row lacked when a value lands in it. Cmd-A inside a cell selects that cell's text and never grows to the rectangle or the note. OBSERVED for the rectangle, its menu, Backspace and Delete on a full-width rectangle, Clear cells, Delete cells, and Cmd-A; DECIDED for partial rectangles, typing, Escape, and the clipboard formats.
- Creating a table from the command palette or a host menu uses _insert table_; sorting, moving, and alignment are in scope from draft 7. The source stays reachable through an outer selection that overlaps the table. DECIDED.
- A table with a malformed delimiter row is not a table to the parser and stays plain text.
- Scope: block (whole table).

### 4.12 Math, footnotes, tags, comments, HTML

- Inline `$x$` renders as the formula at rest, replacing the whole `$x$` with an atomic inline widget; when touched (adjacency, like other inline syntax) the formula is removed and the dimmed source shows in its place, with per-character traversal. OBSERVED. Block `$$…$$` renders at rest as a display formula replacing every line of the block (state field); when the caret is inside the block or a selection overlaps it, the source lines show with the `$$` fences dimmed **and the rendered formula stays as a preview block directly below the closing fence**. OBSERVED. Rendering uses KaTeX with `throwOnError: false`, `trust: false`, and `strict: "ignore"`; a TeX error renders KaTeX's error markup in the unsafe colour with the message as a title. The KaTeX runtime is loaded lazily on the first math node in a document; until it arrives, and in a document without math, nothing is loaded and the source shows styled as before. Hosts import KaTeX's stylesheet; the package re-exports it as `./markdown/katex.css`. Scope: inline for `$`, block for `$$`. DECIDED.
- Footnote references `[^1]` keep all their characters visible, styled as a footnote link in a superscript badge; nothing is hidden. Definitions `[^1]: text` keep the label visible, styled, on a block-scoped line. OBSERVED.
- Tags `#tag` and `#nested/tag`: styled as a chip, nothing hidden, no reveal. Must not fire inside code, links, or headings' marker position (`# ` followed by space is a heading). OBSERVED that characters are retained; the numeric rule (`#1` is not a tag) is DECIDED.
- Comments `%%text%%`: off-range the whole comment is shown dimmed and de-emphasised (it is editor-only content, so hiding it entirely would lose text); on-range it is plain. OBSERVED that Obsidian keeps the characters in Live Preview.
- **HTML is shown as code, never rendered.** An HTML block (CommonMark HTML block, including `<!-- -->` comment blocks) gets the code-block styling of 4.9 on every line (monospace, background, padding, rounded first and last lines) with a small `html` label at the right of its first line; its body stays editable source with the package's HTML highlighting; nothing is hidden, nothing is atomic, the caret traverses per character, and there is nothing to reveal, so the caret's position changes nothing. Inline HTML inside a paragraph is raw tags, as in CommonMark: each tag (`<span>`, `</span>`, `<br>`, a comment, a processing instruction) is styled on its own as an inline code span with every character kept, and the text between tags stays ordinary Markdown (`<span>**b**</span>` shows two tag spans with bold `b` between them). Tags are never paired, so a closing tag far from its opener, a malformed pair, or an attribute holding `>` costs nothing and hides nothing. There is no copy button and no language switching on an HTML block: it is a placeholder, not a fenced code block. DECIDED. **Why:** rendering raw HTML in the same-origin shell is a cross-site scripting surface, so it is off until a sanitised renderer exists; showing HTML as code sets the user's expectation now that it is literal, so if rendering arrives later the user who wants it literal already knows the escape hatches, which are unchanged by this rule: put it in a ` ```html ` fence (4.9), or escape the opening bracket (`\<div>`), which makes it plain text. Rendering HTML as plain paragraph text would instead teach users that pasted HTML is inert, an assumption a future renderer would break.

### 4.13 Hard line breaks

- Two trailing spaces or a trailing backslash: off-range a faint return glyph is drawn at the line end so the break is visible; on-range the characters are shown. Obsidian keeps the spaces with no glyph; the glyph is our addition. DECIDED.

### 4.14 Frontmatter

- A `---` fence at document start through the next `---` line is frontmatter (parser extension). v1 renders it as a folded properties block: off-block a single collapsed line reading "Properties" with a count; a caret in the block or a click unfolds it to source styled as code with the fences dimmed. Never rendered as a rule. DECIDED for v1; Obsidian's properties editor is out of scope.
- Scope: block.

### 4.15 Summary table

| Construct                          | Scope                  | Hidden off                                  | Rendered as                                        |
| ---------------------------------- | ---------------------- | ------------------------------------------- | -------------------------------------------------- |
| ATX / setext heading               | block                  | `# ` run, closing hashes, setext underline  | sized heading line                                 |
| Bold / italic / strike / highlight | inline                 | marker runs                                 | styled span                                        |
| Inline code                        | inline                 | backticks                                   | code span                                          |
| Inline / reference link            | inline                 | `[`, `](…)`, `][label]`                     | link text, external-link glyph for http(s) targets |
| Unresolved `[text]`                | none                   | nothing                                     | literal                                            |
| Definition line                    | block                  | whole line                                  | empty line                                         |
| Angle autolink                     | inline                 | `<`, `>`                                    | link                                               |
| Bare URL / www / email             | none                   | nothing                                     | link                                               |
| Wikilink                           | inline                 | `[[`, `]]`, target when aliased, `\|`, `#…` | wikilink text                                      |
| Embed                              | inline                 | whole source                                | placeholder chip / image                           |
| Image                              | inline                 | whole source                                | image widget; source shown beside on-range         |
| Blockquote line                    | none (always the rail) | nothing; `> ` drawn as the rail             | bordered line                                      |
| Callout header                     | block                  | `> [!type]`                                 | header with icon and title                         |
| Bullet item                        | block, prefix range    | marker (replaced in place)                  | bullet glyph                                       |
| Ordered item                       | block                  | nothing                                     | styled number                                      |
| Task                               | block, prefix range    | `- [ ]` outside the prefix                  | checkbox widget in the marker slot                 |
| Fenced code                        | block (whole)          | fence lines                                 | code block with label                              |
| Horizontal rule                    | block                  | rule text                                   | rule line                                          |
| Table                              | block (whole table)    | every table line                            | table widget, cells edited in place, cell menu     |
| Inline math                        | inline                 | whole `$x$`                                 | rendered formula; source when touched              |
| Footnote ref                       | none                   | nothing                                     | superscript badge around `[^1]`                    |
| Tag                                | none                   | nothing                                     | chip                                               |
| Comment                            | inline                 | nothing                                     | dimmed span                                        |
| HTML                               | none                   | nothing                                     | code-styled source with an `html` label            |
| Hard break                         | inline                 | trailing spaces                             | return glyph                                       |
| Frontmatter                        | block                  | fences                                      | folded properties block                            |

### 4.16 Host-drawn ranges

- A host may draw its own widgets over source text (the T3 composer draws file, skill, citation, and context chips over Markdown links). It lists those ranges through the `previewExclusions` facet, and the preview leaves them alone: no hiding, replacing, widget, or fold overlaps one, and syntax wholly inside one is not decorated. Syntax around a range still renders, and a table or folded block that holds one stays source. DECIDED.

## 5. Keyboard and input rules

All bindings are registered above the host's default keymap. Mod is Cmd on macOS and Ctrl elsewhere. Each selection range is handled independently.

- **Mod-b bold `**`, Mod-i italic `*`, Mod-e inline code, Mod-Shift-x strikethrough `~~`, Mod-Shift-h highlight `==`.** Rules per range: if the range is inside or exactly spans a matching span (boundaries count), unwrap it and keep the same text selected; else if the range is non-empty, wrap it exactly and keep the text selected; else if the caret touches a word, wrap the word and place the caret at the end of the wrapped word; else insert an empty pair with the caret between. Each toggle is one undo step. Wrapping never happens inside a fenced code block or inline code; the key falls through. Mod-i inside bold produces bold-italic; Mod-i inside bold-italic removes the italic layer. DECIDED (owner-visible improvement over the reference's edge behaviour).
- **Mod-Shift-k link.** With a selection, wrap as `[selection](|)` with the caret in the parens; with a URL selected, wrap as `[|](url)` with the caret in the brackets; with a caret on a word, wrap the word. Pasting a URL over a selected word makes a link. DOCUMENTED.
- **Enter in a list item** continues the list with the same marker, the same indentation, and for ordered lists the **next number in the item's own style** (`1. 1.` lists continue as `1.`; sequential lists continue with n+1) and never renumbers other items. Enter on an empty item removes the marker and exits to the previous indent level in one step, with no blank line inserted. Enter in the middle of an item splits it. Enter on a task item continues with `- [ ]`. DECIDED (fixes four contradictions with the UX guide).
- **Enter in a blockquote** continues with `> `; Enter on an empty `> ` line exits the quote in one step.
- **Enter inside a fenced code block** inserts a newline and copies the current line's indentation.
- **Tab / Shift-Tab in a list item** indent and outdent the item (and its nested children) by the parent's indentation unit, regardless of caret position in the line. Elsewhere Tab inserts an indent. DOCUMENTED. A host whose editor sits in a form may turn prose indentation off (`tabIndentsProse: false`): Tab then acts only in tables, list items, and code, and elsewhere falls through to the page's focus order. DECIDED.
- **Reserved keys.** A host may list bindings it owns (`reservedKeys`, such as `Mod-Shift-x` for a picker); the preview leaves them unbound. DECIDED.
- **Backspace** at the start of a list item's text removes the marker; at the start of an empty quote line removes `> `; elsewhere deletes one character or one hidden atomic range (2.5).
- **Typing the closing marker** at the end of an emphasis span (`**bold` then `**`) closes it and continues plain, which is simply the parser recognising the span. No auto-pairing of markers. DECIDED.
- **Typing `- `, `* `, `1. `, `> `, `# `** at line start is not transformed; it simply becomes the construct as the parser recognises it. No input rules rewrite text. DECIDED.
- **Undo** belongs to the host (Yjs undo manager); the markdown layer installs no history.

### 5.1 Vim mode

An optional modal editing layer (`@replit/codemirror-vim`), off by default, switched on by the host through an `AtlasEditor` prop and persisted by the host. DECIDED:

- **Normal mode treats hidden syntax exactly as the arrow keys do** (2.5): motions (`h`, `l`, `w`, `b`, `e`, `0`, `$`, `f`) never rest inside a hidden atomic range, and the block cursor sits on a visible character; a motion that touches a construct reveals it as the caret would.
- **Insert mode keeps every binding of section 5** (Mod-b and friends, Enter continuation, Tab indentation, Backspace rules). Vim's own keys take precedence only in normal, visual, and operator-pending modes.
- **Undo and redo are Yjs's.** `u`, `Ctrl-r`, and `U` run the Yjs undo manager, so they revert only the user's own edits and never an agent's, and each Vim change (`dd`, `cw`, a paste) is one undo step.
- **Inside an active table cell**, Escape in insert mode returns to normal mode within the cell; Escape in normal mode leaves the cell (4.11's Escape rule). Cell editors run the same Vim layer as the outer editor, so modes are consistent; `j`/`k` at a cell's edge move between rows as the arrow keys do.
- **Visual mode** selects as the mouse does, revealing what it covers (2.1); a visual selection inside a cell stays inside the cell.
- **Ex line.** `:` opens the ex line; `:w` is a no-op that reports nothing (the document is always saved through Yjs); `:q` is ignored. Hosts may define their own ex commands.
- **A mode indicator** is drawn as a panel at the bottom of the editor when Vim mode is on (the package's status panel), so the mode is never ambiguous. A host may show the mode itself instead (Astrolabe sets the text in the monospace font outside insert mode) and turn the panel off.
- **The selection is drawn** by CodeMirror's selection layer while Vim is on, since Vim hides the native one; the host colours it.
- **Yank and paste** use Vim's registers; the system clipboard is reachable through the `+` and `*` registers. Rectangle selection in tables is unaffected.

## 6. URL policy

Every link target, image source, autolink, and embed target passes a policy function returning a string to use or "blocked". Default policy: trim whitespace; decode CommonMark escapes and entities; unwrap angle brackets; accept `http:`, `https:`, `mailto:` (links only, not images), `data:image/*` (images only), and scheme-less relative paths and fragments; block `javascript:`, `vbscript:`, `file:`, `data:` with any other type, protocol-relative `//`, and any string containing control characters before the scheme. Hosts may supply their own policy. Wikilink and embed targets are not URLs and bypass the policy; the host resolves them.

## 7. Collaboration constraints

- Decorations are pure functions of editor state (document, selection, focus flag, syntax tree). Remote Yjs changes arrive as ordinary transactions and never move the local caret or scroll. The agent-change highlight layer composes with this layer and neither needs to know about the other.
- No extension replaces the whole document. Reference-definition caches and widget caches key on tree identity and source ranges so remote edits invalidate only what they touch.

## 8. Performance

- Decorations are built for the viewport only, on document, viewport, selection, focus, or tree change, skipped while an IME composition is active, and the previous set is **mapped through the change** during composition so hidden ranges never sit at stale offsets. DECIDED (fixes the composition risk noted in the reference).
- Reference definitions, footnote definitions, and frontmatter bounds are computed once per tree and cached.
- All hidden ranges share one decoration value so unchanged ranges compare equal across rebuilds.
- No timers, no animation frames, no continuously repainting styles.

## 9. Theming

Two layers. A base theme owns structure (weights, italics, monospace stack, sizes, paddings) and never colours. A stylesheet of CSS custom properties owns colour, opacity, and family, with light and dark defaults keyed on `prefers-color-scheme` and overridable by the host; properties that affect layout (heading sizes, line heights, paddings) are separate from properties that affect only appearance (colours, opacity, weights), and the host may override either set. Every declared property is used by at least one rule. Widgets (bullets, checkboxes, callout icons, language labels, return glyphs) are CSS-drawn or inline SVG, never image files.

## 10. Accessibility

Checkboxes are real checkboxes with an accessible name that states the action. Links expose their target. Headings carry an ARIA level. Widgets are keyboard-reachable through the caret positions on either side; none traps focus. Focus rings are visible on interactive widgets.

## 11. Acceptance catalogue

Every item is a test the implementer writes. "Caret at N" is a collapsed selection at offset N; `/` in a document quote is a newline. Tests run against a real `EditorView` in happy-dom unless marked (browser). The reference implementation's 161 pinned behaviours were reviewed; the ones below either supersede them with the rules above or carry them forward.

**Reveal model**

- A1. `**bold** text`, unfocused editor, selection at 0: no markers visible.
- A2. Same doc after a focus event, caret at 0: `**` visible (adjacent), caret at 2: visible, caret at 8: visible (adjacent after), caret at 9: hidden.
- A3. `# Title/body`, focused, caret on `body`: `#` hidden; caret at end of line 1: `# ` visible.
- A4. `plain **bold** plain`, caret at 0 (far away on the same line): `**` hidden. Owner case (d).
- A5. `**a *b* c**`, caret in `a`: outer `**` and inner `*` both visible; caret two characters past the closing `**`: all hidden.
- A6. Selection spanning `**bold**` partially reveals it; a selection covering lines 1 to 3 that ends at column 0 of line 4 does not reveal line 4's heading marker.
- A7. Two carets on two bold spans reveal both; one caret elsewhere hides both.
- A8. Editor blurs after focus: reveal state unchanged.
- A9. `# First/second`, fresh editor, no focus, render: `#` not visible. Owner case (a).

**Text never atomic**

- A10. `abc **bold** def`, caret on the next line: ArrowUp landing inside `bold` puts the caret on that character, not at a span edge.
- A11. Clicking (browser) the letter `o` in rendered `bold` puts the caret after `b`.
- A12. `abc**bold**def`, caret at 6: ArrowRight goes to 7, ArrowLeft returns to 6.

**Block markers**

- A13. `- item` renders a bullet widget in place of `-`; with the caret at the line start or just after the `-` the literal `-` shows dimmed; with the caret in `item` the bullet shows; the text does not move in any state. Owner case (b).
- A14. `* item` and `+ item` render the same bullet. `1. item` and `1) item` keep their numbers.
- A15. `- [ ] a/- [x] b/- [-] c`: three checkboxes; unchecked, checked, cancelled; `b` and `c` text struck and muted. With the caret just after the `]` of line 1 the literal `- [ ]` shows dimmed; with the caret in `a` the checkbox shows.
- A16. Clicking the first checkbox yields `- [x] a`; caret and scroll unchanged; one undo restores it.
- A17. `> q`: `>` hidden, line bordered, text x-position unchanged between hidden and revealed states (browser).
- A18. `> a/> b`, caret on line 1 at any position: both lines show the rail and neither shows a literal `>`; the `>` characters remain in the document.
- A19. `> [!note] Title/> body`: header rendered with title `Title`, body bordered; `> [!warning]- T/> hidden` folds the body off-line and unfolds with a caret in the body.
- A20. `text//---//text`: rule rendered; caret on the rule line shows dimmed `---`.
- A21. ` ```js/const x = 1;/``` `: off-block the fence text is hidden, a `js` label is present, both lines keep height; caret on the body line shows both fences dimmed.
- A22. Unclosed fence: only the opening line is treated as a fence; styling runs to the document end.
- A23. `---/title: x/---/body` at document start: folded properties block, no rule.

**Links**

- A24. `[word]` with no definition: brackets visible off-range and on-range, no link styling. Owner case (c).
- A25. `[shortcut ref]//[shortcut ref]: https://x`: link-styled with target `https://x`, brackets hidden off-range; definition line hidden off-line.
- A26. `[text][]//[text]: https://x`: resolves.
- A27. Two definitions of the same label: the first wins.
- A28. `[a](<https://x>)`: target `https://x`.
- A29. `<https://x>`: brackets hidden, target `https://x`. `<foo@bar.com>`: target `mailto:foo@bar.com`. `www.x.com`: target `https://www.x.com`.
- A30. `[bad](javascript:alert(1))`: syntax hidden, no target, unsafe class present.
- A31. `# A **b** [c](https://x)`: bold and link decorated inside the heading.
- A32. `[![alt](https://i)](https://x)`: image rendered, link-styled, target `https://x`.
- A33. Mod-click (browser) on a link opens it once with `noopener,noreferrer` and adds no cursor; plain click opens nothing.
- A34. `[[Note]]`, `[[Note|Alias]]`, `[[Note#Head]]`: display text `Note`, `Alias`, `Note > Head`; data target as typed; syntax hidden off-range.
- A35. `![[Embed]]`: placeholder chip with text `Embed`. `![[pic.png|200]]`: image widget with host-resolved source.

**Images**

- A36. `![alt](https://x/a.png)`: image widget off-range; on-range the widget remains and dimmed source precedes it on the same line.
- A37. `![bad](javascript:1)`: broken-image placeholder with alt, source hidden.

**Inline extras**

- A38. `==mark==`: highlight span, markers hidden off-range.
- A39. `\*literal\*`: asterisks visible; backslashes hidden with the caret on another line and dimmed with the caret anywhere on the line, including far from the escape.
- A40. `[^1]` reference: superscript badge with `[^1]` fully visible in every state; `[^1]: text` definition line keeps its label.
- A41. `#tag` and `#a/b` chips; `# heading` is not a tag; `#1` is not a tag (VERIFY Obsidian's rule and pin the observed one).
- A42. `%%hidden%%`: dimmed span off-range, plain on-range.
- A43. `$E=mc^2$`: math span, dollars hidden off-range.
- A44. `line  /next` (two trailing spaces): return glyph off-range.

**Keyboard**

- A45. `hello`, select all, Mod-b: `**hello**`, selection on `hello`. Mod-b again: `hello`.
- A46. `**hello**`, caret at 0 or at 9: Mod-b unwraps.
- A47. `hello world`, caret at 7, Mod-b: `hello **world**`, caret at end of `world`.
- A48. `hello  world`, caret at 6, Mod-b: `hello **** world`, caret at 8.
- A49. Mod-i inside `**x**`: `***x***`; Mod-i inside `***x***`: `**x**`.
- A50. Mod-e wraps in backticks; Mod-Shift-x in `~~`; Mod-Shift-h in `==`.
- A51. Mod-Shift-k on selected `docs`: `[docs](|)`. Pasting `https://x` over selected `docs`: `[docs](https://x)`.
- A52. `- one|`, Enter, type `two`: `- one/- two`. `1. a/2. b|`, Enter: `1. a/2. b/3. |`. `1. a/1. b|`, Enter: `1. a/1. b/1. |`. `1. a|/2. b`, Enter: `1. a/2. |/2. b` (no renumbering of `2. b`).
- A53. `- a/- |`, Enter: `- a/|` with no blank line. `- a/  - |`, Enter: `- a/- |`.
- A54. `- [ ] a|`, Enter: `- [ ] a/- [ ] |`.
- A55. `> q|`, Enter: `> q/> |`. `> q/> |`, Enter: `> q/|`.
- A56. `- a|`, Tab: `    - a|` (or the list's indent unit); Shift-Tab reverses. Nested children move with the item.
- A57. `- |text`, Backspace: `|text`.
- A58. Inside a fence, Mod-b does nothing to the text.
- A59. Read-only editor: no toggle changes the document.

**Stability and performance**

- A60. No decoration rebuild dispatches a selection; a remote Yjs insertion before the caret leaves the caret on the same character.
- A61. Reference definitions are computed once per tree version: a selection-only transaction performs no tree walk (assert via a counter in a test-only hook or by spying the cache).
- A62. Off-screen constructs have no decorations until scrolled into view (browser).
- A63. During a simulated composition, the previous decoration set is mapped through the inserted text so no hidden range covers new characters.

**Theming**

- A64. Every CSS custom property declared in the stylesheet is referenced by at least one rule (static test over the stylesheet text).
- A65. Dark defaults switch under `prefers-color-scheme: dark` (browser).
- A66. `[a](https://x)`, `<https://x>`, and `https://x` each carry one external-link glyph after the text off-range; none while revealed; `[a](notes/a.md)` carries none.

**Math**

- A67. `L $E=mc^2$ R` at rest: the `$E=mc^2$` source is absent from the line's text and a math widget with rendered KaTeX markup (a `.katex` element) stands in its place; `L` and `R` remain.
- A68. Same doc, caret at 1 (adjacent) and at 4 (inside): the widget is gone and `$E=mc^2$` shows with dimmed `$`; caret at 12 (two past): the widget is back.
- A69. `$$/\int_0^1 x\,dx/$$` at rest: one block widget with rendered KaTeX display markup replaces all three lines; no `$$` is visible.
- A70. Same doc, caret inside the block: the three source lines show with dimmed `$$`, and a rendered preview block is present after the closing fence; caret moved below the block: source gone, widget back.
- A71. `$\frac{$` (invalid TeX) at rest: no exception; the widget carries KaTeX's error markup, the unsafe class, and a title with the error message.
- A72. Before the KaTeX runtime has loaded, a math node renders as the styled source; after the load resolves (awaited in the test through the exported loader), a rebuild shows the widget.
- A73. `$5 and $10` renders no math; `$$x$$` on one line renders inline-style block math.

**Tables**

- A74. A two-column GFM table at rest: one table widget replaces all its lines; it has a `<thead>` with the header cells, one `<tbody>` row per body row, `**bold**` in a cell renders as a bold span, a link in a cell carries its target, and the alignment row's `:` markers set `text-align` on the columns.
- A75. Caret placed inside the table's source: the widget is gone, the source rows show with `|` and the delimiter row dimmed, cell text decorated inline; caret moved below: widget back.
- A76. Clicking a body cell of the widget (browser-independent: dispatch the widget's click handler) puts the caret at that cell's source text start and reveals the source.
- A77. With the caret in the first cell's source, Tab moves to the second cell's text start; Tab at the last cell of a row moves to the next row's first cell; Shift-Tab reverses; Tab in the last cell of the table leaves the document unchanged and the caret in place.
- A78. A "table" whose delimiter row is malformed (`| a |/| b |`) renders no widget and no dimmed delimiters.

**In-place cell editing**

- A79. Clicking the body cell `cell` of a two-column table keeps the table rendered, activates that cell with a child editor holding `cell`, and leaves the outer selection collapsed at the cell's source start. Typing `s` in the child changes the outer document's cell text to `cells` and the table stays rendered with the new text.
- A80. In the active cell `**bold** cell`, a child caret inside `bold` reveals `**`; the neighbouring cell is unchanged and static.
- A81. Tab from the first header cell activates the second; Tab from the last cell of the header row activates the first body cell; Shift-Tab reverses; Enter from a body cell activates the cell below; Enter in the last row appends `|   |   |` (column count preserved) and activates its first cell.
- A82. Escape from an active cell destroys the child editor, focuses the outer editor with its caret just after the table, and the table stays rendered.
- A83. ArrowDown from the line above the table activates the first cell; ArrowUp from the line below activates the last cell; ArrowUp from a first-row cell leaves to the line above; ArrowDown from a last-row cell leaves to the line below; ArrowRight at a cell's end activates the next cell and ArrowLeft at its start the previous.
- A84. Typing `|` in a cell inserts `\|` in the source and the rendered cell shows `|`.
- A85. With cell `c` active, a remote Yjs update inserting `x` at the cell's source start updates the child's document to `xc` and keeps the child focused with its caret on the same character; a remote update elsewhere in the note leaves the child untouched.
- A86. Mod-A in a cell selects the child's whole text and nothing outside; a second Mod-A does not extend to the note.
- A87. An outer selection covering the table (select-all with the caret elsewhere) still reveals the source rows; collapsing it restores the widget with no active cell.
- A88. Only the active cell contains a nested `.cm-editor`; activating another cell moves it; deactivating removes it.
- A89. After typing in a cell, the outer editor's undo (Yjs undo manager) reverts the cell text, the table stays rendered, and the child editor shows the reverted text.
- A90. (browser) The caret is visible inside the active cell and a click on a character positions it there.
- A91. With the first body cell of a two-column table active, insert row below inserts `|   |   |` on its own line after that row and activates the new row's first cell with the caret at its start; insert row above inserts before it; from a header cell, insert row above returns false and changes nothing, and insert row below inserts the first body row after the delimiter.
- A92. Delete row on a body row removes that line and its line break and activates the same column in the row below, or the row above when it was the last body row; on the only body row it leaves the header and delimiter and the table stays rendered; on the header it returns false and changes nothing.
- A93. Insert column right from column 0 of `| a | b |\n| :-- | --: |\n| c | d |` gives header `| a |   | b |`, delimiter `| :-- | --- | --: |`, body `| c |   | d |`, so the other columns keep their alignments and padding; the new cell in the current row is active; insert column left mirrors it before column 0. A body row shorter than the header is padded to the header's count first.
- A94. Delete column on column 1 of a three-column table removes its slot and closing pipe from header, delimiter, and every body row, keeps the other columns' alignment markers byte for byte, and activates the cell at index 1 of the current row, or index 0 when column 1 was the last; on a one-column table it returns false and changes nothing.
- A95. With no active cell and the outer caret inside a table's source rows (an overlapping selection collapsed onto a cell), each command acts on the caret's cell; with the caret outside every table each returns false.
- A96. Each command is one undo step: after insert column right, one undo restores the previous source byte for byte and the table stays rendered.
- A97. A contextmenu event on a rendered cell opens the cell menu inside the editor's DOM listing the six commands in order, with insert row above and delete row disabled when the cell is in the header and delete column disabled on a one-column table; choosing insert row below runs it and the new row's cell is active with focus; Escape or a mousedown outside the menu closes it with no document change.
- A98. (browser) The menu appears at the pointer, stays within the viewport near the window's edges, and is readable in both colour schemes.
- A99. An HTML block `<div>\n  <p>x</p>\n</div>` renders at rest with every line carrying the code-block line classes and an `html` label on its first line only; every character remains in the DOM text, nothing is atomic (ArrowRight steps one character at a time across `<div>`), and placing the caret inside the block changes nothing.
- A100. `before <span>x</span> after` renders `<span>` and `</span>` as two inline code spans with `x` and the surrounding words as plain paragraph text and no reveal on adjacency; `<span>**b**</span>` renders the two tag spans with bold `b` between them; `<span title="a>b">x</span>` still yields exactly two tag spans; a paragraph of hundreds of `<br>` tags decorates in linear time.
- A101. The same block inside a ` ```html ` fence renders as fenced code per 4.9 with the fences hidden at rest and a copy button, not as an HTML placeholder; `\<div>` on its own line renders as plain text with the escape hidden per the escapes rule and no code styling.
- A102. The cell menu on a body cell in the middle column of a three-row table lists Row (six entries), Column (nine entries), Sort A to Z, Sort Z to A, in the spec's order; on the header it omits Move row up; on the last body row Move row down; on the first column Move column left; on the last column Move column right; on a one-column table Delete column; an empty cell and a populated cell list the same entries.
- A103. Delete row on the header of `| a | b |\n| - | - |\n| c | d |\n| e | f |` gives `| c | d |\n| - | - |\n| e | f |` with `c` active; Move row up on the first body row gives the header and that row swapped with the delimiter kept in place; Move row down on the header is the same swap.
- A104. Move row down on `| c | d |` above `| e | f |` swaps the two lines byte for byte (padding and escapes included) and keeps the moved row's cell active; Move column right on column 0 of `| a | b |\n| :-- | --: |\n| c | d |` gives `| b | a |\n| --: | :-- |\n| d | c |`.
- A105. Duplicate row copies the line below itself; Duplicate column copies the slot after itself in every row and the delimiter; the original cell stays active in both.
- A106. Align center on column 0 of `| a | b |\n| :---- | --: |` gives `| :---: | --: |` and touches no other byte; on `| --- | --: |` it gives `| :-: | --: |` (width kept); Align left when already left changes nothing and returns false.
- A107. Sort Z to A on the Name column of the research fixture reorders the body rows to gamma, beta, alpha as whole lines; Sort A to Z restores them; a numeric column sorts 2 before 10.
- A108. Insert table with the caret at the end of a paragraph appends a blank line and the three-line `|     |     |` table, and the first header cell is active with focus.
- A109. Clicking the bottom add bar of a table appends `|   |   |` (column count preserved) and activates the new row's first cell; clicking the right add bar appends `   |` to every header and body row and ` --- |` to the delimiter and activates the new header cell; both are one undo step.
- A110. (browser) Resting the pointer in the strip below the table shows only the bottom bar with the tooltip "Add row below"; resting it in the strip to the right shows only the right bar with "Add column to the right"; resting it on the table's cells shows neither; moving away hides them; no add bar appears at the top or left.
- A111. A click on a body row's handle selects that row (every cell carries the selected class, the row's first cell is active); a click on a column's handle selects that column header included; a right-click on the row handle lists the six row commands flat; on the column handle the sort and column commands flat, in the spec's order, with the grid omissions; Escape, a click elsewhere, or typing collapses the selection to the active cell.
- A112. (browser) Resting the pointer in the left gutter beside a row shows that row's grip only; in the top gutter above a column, that column's grip only. Dragging a body row's grip shows a horizontal drop indicator between body rows, never above the header, and releasing moves the row there in one undo step; Escape during the drag cancels; a column grip drags with a vertical indicator. The move-to-position commands behind the drop (`moveRowTo`, `moveColumnTo`) are tested by exact source in happy-dom.
- A113. A drag from inside `alpha` to inside `22` selects the six-cell rectangle; Backspace deletes those two rows; on a two-cell rectangle within one column Backspace clears the two cells and keeps the rows; Clear cells empties the rectangle; Delete cells is offered only when the rectangle spans every column or every row.
- A114. The rectangle's menu lists Cut, Copy, Paste, Align left, Align center, Align right, Clear cells, and (when applicable) Delete cells; Copy puts `alpha\t**bold** note\t1\nbeta\t\t22` on the clipboard as text.
- A116. With Vim mode on, the editor starts in normal mode; `i` enters insert mode and typing lands; Escape returns to normal mode; the panel shows the mode.
- A117. `dd` on a list item removes the line as one Yjs undo step; `u` restores it and `Ctrl-r` removes it again; an agent peer's concurrent insertion elsewhere is untouched by `u`.
- A118. On `L **bold** R` in normal mode, `w` from `L` lands on `b` (never inside the hidden `**`), reveals the span, and `l` steps one character at a time through the text; `$` lands on `R`.
- A119. In insert mode, Mod-b wraps the word as in section 5, Enter at the end of a list item continues the list, and Tab indents the item.
- A120. Inside an active table cell in insert mode, Escape goes to normal mode with the cell still active; a second Escape leaves the cell with the caret where 4.11 says; `j` at the cell's last row moves to the row below's cell.
- A121. With Vim mode off, nothing from this section is installed: `i` types an `i`, and no panel is drawn.
- A115. Every command in this section is exported from the package's `./markdown` entry and returns false with no current cell; each is one undo step under the Yjs undo manager.

## 12. Out of scope for v1

Column resizing, merged cells, embed transclusion, the properties editor, mobile and touch tuning beyond target sizes, find-in-rendered-text, dual-format clipboard, image paste and upload, per-context suppression settings, and an "always show source" mode. Each is a later slice with its own spec section. Math rendering and the table widget moved into scope in draft 3, in-place cell editing in draft 4, row and column commands with the cell menu in draft 5, and the full table surface (add bars, handles, rectangle selection, move, duplicate, align, sort, insert table) in draft 7.

## 13. Confirmed against Obsidian

The research pass confirmed the adjacency reveal with both boundaries, per-character traversal after reveal, line-scoped heading marks, no heading hash on reopen, literal unresolved brackets, no marker auto-pairing, list continuation and exit on Enter, per-line quote rails, the properties widget for frontmatter, fenced code with a language label, folded collapsed callouts, and persistent widgets beside revealed embed source. It corrected nested emphasis, escapes, list and task marker reveal, quote literals, and footnote references, all applied above. A second pass on 2026-09-27 (Obsidian 1.13.7, `~/dev/mercurian/research/obsidian-live-preview-2026-09-26/tables/`) confirmed the table surface: the Row and Column submenus with omitted entries, the flat handle menus, the add bars and their effects, rectangle selection with Clear and Delete cells, the header-as-row-0 model, alignment and sort results, and Insert table; it also showed that Obsidian re-pads the whole table on every command, which we deliberately do not. Not observed, still DECIDED: closing hashes, setext underlines, Backspace and Delete at hidden boundaries, mouse landing offsets, Shift-Tab, quote continuation, and width measurements.

## 14. What makes this better than the reference

Inline elements reveal on adjacency, not per line. Nothing but syntax is ever atomic, so clicks land where the user clicked. Nothing reveals before the user has focused the editor. Bullets, callouts, wikilinks, embeds, highlights, tags, footnotes, comments, math, hard breaks, and frontmatter are handled. Nested syntax inside headings and link text is decorated. Unresolved brackets stay literal and reference resolution follows CommonMark. Unsafe links and images are treated alike. Images do not collapse when edited. List continuation preserves the user's numbering style and never touches other items. Tab indents lists. The URL policy no longer leaks emails and `www.` links as relative paths. Reference definitions are cached per tree instead of walked per keystroke. Composition maps decorations instead of freezing them. Every theme property does something.
