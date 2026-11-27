# Project docs

Every project's notes (`.md`), canvases (`.canvas`), bases (`.base`) and skill maps
(`*.skillmap.md`), kept as files in any of its folders (the project folder and each tracked
folder). There is no Wikis section any more: documents live in **Projects**
([repositories.md](repositories.md)) and open as its tabs in the shared panes
([panes.md](panes.md)). User guide: `docs/user/project-docs.md`.

Selectors below come from the components, their browser tests and a live walk.

## Sub-features

- **Docs filter** (`RepositoryFilterMenu.tsx`, `repositoryFilter.ts`, the `docs` field of
  `astrolabe:repository-filter:v1`): `role=combobox[name=/^Filter projects/]` has a **Show**
  group with **Docs** and **All files**. Docs narrows every tree to notes, canvases, bases,
  skill maps, the files they link and their folders; the open file stays listed. While on, the
  pills (`[aria-label="Project filters"]`) hold a one-tap **Docs** pill that turns it off. It
  changes only the list: tabs, the file in front, its route and branch stay as they were.
- **Folders**: each tracked folder outside the project folder gets its own section,
  `button "<folder name>"` over a `tree "<absolute path>"`; a folder gone from disk reads
  "This folder isn't on disk any more: <path>" (`ProjectRootSections.tsx`, its browser test).
  The section's `ul` carries an `aria-label` but is `role=presentation`, so locate by the
  header button and the tree. Add one in Settings → Projects → <project> → **Repositories** →
  **Add folder** (dialog "Track a repository or folder anywhere on this project's machine.", a
  `Folder path` field listing entries, then **Add folder**); it then lists with **Remove**
  (`button "Remove <name> from the project"`) and Projects shows its section.
- **Documents open from Projects** (`RepositoryFileView.tsx` → `ProjectDocumentView.tsx`,
  `projectDocument.ts` `opensAsProjectDocument`): a note, canvas or base in a project's tree
  opens in the document editors; a `*.skillmap.md` and a chat's linked file tab keep the code
  editor. A file outside every project folder shows "This document can't be opened here".
- **Where edits land** (`projectDocument.ts` edit target, `ProjectDraftPill.tsx`): only a hosted
  repository's main checkout on its default branch saves to the person's draft; every other
  branch, worktree, remote-less repository and plain folder writes the file on disk. Nothing
  saves by hand. A draft shows `button "Draft actions"` in the header, reading
  `Draft · N documents`, with `Open pull request…` (dialog **Open pull request**, a `Title`
  field, toast "Pull request opened") and `Discard draft…` (confirm "Discard this draft? Its
  edits leave your documents."). Nothing reaches the host until **Open pull request**. Save
  status (`Saving…`, `Saved`, `Not saved`) is the header's quiet `TabHeader.Status` text
  (`wiki/wikiAutosave.tsx`).
- **Links across folders** (`ProjectDocumentView.tsx`, `packages/wiki/src/resolveLink.ts`): a
  bare `[[Plan]]` resolves in its own folder first, then to the one match elsewhere; several
  matches mark it `.cm-wiki-link-ambiguous` (never `.cm-wiki-link-missing`), opens nothing, and
  its hover preview is headed "<name> could mean several documents" with "Fits <places>. Put a
  folder's name first, as <example>, to choose one." `[[lib:Spec]]` opens lib's file in lib's
  folder, in a `wiki-file:<env>:<rootId>:…` tab; before lib is tracked it is missing. A resolved
  link is `span.cm-md-wikilink[data-wikilink="<target>"]`, a missing one `.cm-wiki-link-missing`.
  A plain click moves the cursor into the link (its raw text shows) and opens a preview card
  with `button "Open <name>"`; **Open** or ⌘-click follows it. `region "Links here"` lists
  backlinks from every folder as `button "<root>:<Note>"` ("No note links here yet." when empty);
  "Links to" lists outgoing ones, ambiguous ones with an `Ambiguous` meta. Typing `[[` in a note
  offers every folder's documents as `option`s; another folder's inserts `[[<root>:<Name>]]`.
- **Typed links** (`packages/wiki/src/links.ts` `displayRuns` / `typedLinks`,
  `packages/wiki-editor/src/linkTools.tsx` `typeSuggestions`): an `@` word in a link's display
  text is its type, `[[Rounding|the rounding rule @depends_on]]` reading "the rounding rule
  depends_on" with the type marked (`.cm-md-link-type`). Typing `@` there completes from the
  types already used. Previews list a link's types (`.cm-wiki-link-preview-type`).
- **Move with links** (web only; `ProjectMoveDialog.tsx`, server `WikiService.personMove`): a
  tree row's menu (`menuitem "Move or rename…"`, on notes, canvases, bases and folders, defined
  in `RepositoryWorktrees.tsx` and shown only with the `wikiEnvironment.move` permission) or the
  palette's **Move or rename this document** (for the project document in front) opens a
  `dialog` titled "Move or rename document" or "Move folder", with a `Path` field prefilled from
  the top of its folder, **Cancel** and **Move**. Links in every writable folder follow and open
  tabs move with the file. From a draft-saving checkout it moves in the draft (toast "Moved in
  your draft"); a folder whose main checkout drafts, or every other folder when moving from a
  worktree, keeps its links (toast "Moved, but some links still lead to <old path>", described
  "<folders> can't be written here, so their links were left as they were.").
  An unsaved open document refuses the move ("An open document's edits haven't saved yet.").
  The phone has no move.
- **Bases across the project** (`WikiBaseView.tsx`, `packages/wiki/src/baseCorpus.ts`
  `projectBaseCorpus`, `baseFunctions.ts`): a base lists every folder's files; another folder's
  paths read `<root>:<path>`, and `file.root` is a file's folder key, so `file.root == "<key>"`
  keeps one repository's. Broken bases show "This base can't be shown"; ones with warnings
  "Parts of this base don't work as written". Row names open as buttons named after the file.
  With the code index on, code files carry read-only `code.*` fields (`code.language`,
  `code.lines`, `code.isTest`, …) and their imports are typed links (`imports`, `calls`, …;
  `baseCorpus.ts`, the user guide's "Code in a base").
  A turn that saves a broken base or an ambiguous bare link gets one "A base needs fixing" /
  "A link needs fixing" message (`TurnDocsCheck.ts`).
- **Canvases** (`WikiCanvasView.tsx`, `packages/wiki-editor/src/CanvasBoard.tsx`): a `.canvas`
  opens in a Projects tab; cards are `[data-card-id]` on `.cv-board`. Edits save as a note's do
  (draft or disk, as above). A code card whose file changed or went marks it
  (`.cv-code-stale[data-status]`: "Changed since this commit" / "Gone from the project's head").
  The full editing walk is in [canvas.md](canvas.md) and the user guide's canvas section.
- **Document settings** (Settings → Projects → <project>; `ProjectDocumentSettings.tsx` over
  `WikiLocationSettings.tsx`, `WikiCanvasSettings.tsx`, `WikiMapBackgrounds.tsx`, per server):
  headings **New files** (Attachments, New notes), **Canvases** (New canvases, Mouse wheel, Card
  names, Snap to grid, Snap to objects, Hide card content below) and **Map backgrounds**.
- **Keep a canvas** (`components/canvas/KeepCanvas.tsx`, server `wiki/CanvasKeep.ts`): a chat
  board's `button "Keep in the project…"` opens `dialog "Keep <title>"`; with several folders
  a `Folder` select (`option "<root>"`), then `button "Place it"`. In a hosted main checkout it
  lands in the person's draft ("<file> is in your draft in <folder>."); anywhere else on disk
  ("<file> is written in <folder>, uncommitted"). `button "Open it"` opens it. Phone:
  `ThreadCanvasScreen` **Keep** → **Place in the project** → **Place it**
  (`KeepCanvasSheet.tsx`).
- **Old links** (`routes/_chat.wikis.tsx`, `routes/_chat.wikis_.$wikiId.tsx`,
  `wiki/LegacyWikiTab.tsx`, rendered by `sectionTabs/SectionTabContent.tsx`): `/wikis` redirects
  to `/repositories`; `/wikis/<wikiId>?environmentId=…&note=<file>` opens that document's tab in
  Projects once the server says where the wiki went; a change request link lands on Projects
  alone. Tabs saved by the Wikis section become Projects tabs. `/settings/wikis` →
  `/settings/projects` through `RENAMED_SETTINGS_PATHS` in `settings/settingsSearch.ts`
  (`routes/_chat.settings.wikis.tsx` has no redirect of its own).
- **Agents** (`mcp/toolkits/projectDocs/`): agents edit docs with their own file tools in the
  thread's folders, and use `astrolabe_project_orient`, `_links`, `_query` and `_transform` for
  what file edits can't do. `<workspace_folders>` says per folder how far the provider's tools
  reach (`folderReach` in `contracts/workspaceFolders.ts`). Prove it with a real turn that never
  names the folder.
- **Mobile** (iPhone; `features/wikis/`, `features/repositories/RepositoriesScreen.tsx`,
  `features/files/ThreadFilesRouteScreen.tsx`): no Wikis tab. A document in the Projects tab
  (recent, uncommitted, search) or its tree (`Browse all files`) opens `ProjectDocument`
  (`projects/:environmentId/:projectId/:rootKey/documents/:name`). The tree's header menu
  **Show** has **All files** and **Docs**. The subtitle names where edits go: `In your draft`,
  `On disk` or `Main` (`wikiDocumentSubtitle`). The header's `Edit the document` /
  `Stop editing` button switches modes. A draft's bar opens the "Your draft" sheet with **Open
  pull request** and **Discard** (confirm "Discard this draft?"). Bases: a `View` header menu
  with two or more views (iOS). Canvases: `Jump to section` with labelled sections. Mermaid
  blocks draw through `packages/wiki-editor/src/MobileMermaid.tsx`. Old
  `wikis/...` deep links redirect (`LegacyWikiRouteScreen.tsx`). Walk with test-t3-mobile.

## How to get to it (user POV)

**Projects** in the icon rail, then a document in a project's tree (Docs in the filter to see
only documents), Search, a link in another document, or a `[[` chip sent in a thread.

## Driving it with the Browser panel

```
preview_act click     role=navigation[name='Sections'] >> role=button[name='Projects']
preview_act click     role=combobox[name=/^Filter projects/]      # then the Show group's Docs option
preview_act click     role=treeitem[name=/<document>/]            # a tree row, through its shadow root
preview_act click     span.cm-md-wikilink[data-wikilink='<target>']   # preview card; then role=button[name='Open <name>']
preview_evaluate  dispatch contextmenu on the row, then click role=menuitem[name='Move or rename…']
preview_act fill      role=textbox[name='Path'] <new path>        # then Enter, or button "Move"
preview_act click     role=button[name='Draft actions']           # only on a draft-saving checkout
```

**Proof:** `JSON.parse(localStorage['astrolabe:repository-filter:v1']).docs` (`true`) and the
**Docs** pill for the filter;
tab keys per pane (`[data-pane-id]` → `[data-pane-tab]`) or
`JSON.parse(localStorage['astrolabe:workspace:v1'])` for opened and moved tabs; `git -C <root>
status` and `git -C <root> log main` for disk versus draft (a draft never moves main); the
files on disk for a move's rewritten links in each folder. Save a screenshot of the section.

## Walk

1. A project with two folders (the project folder plus a tracked folder, added with **Add
   folder** in its settings), one hosted and one plain, each holding `Plan.md`, and a third note
   linking `[[Plan]]` from a folder without one. Before the folder is tracked, a
   `[[<root>:Plan]]` link to it reads missing.
2. Docs filter on: only documents and their folders list; the open file stays; tabs unchanged.
3. Open a note in the plain folder and type: the file on disk changes, no draft. Open one in the
   hosted main checkout and type: `Draft actions` appears, `git log main` is unchanged.
4. The third note's `[[Plan]]` is ambiguous (`.cm-wiki-link-ambiguous`, opens nothing, hover
   names both folders). Rewrite it as `[[<root>:Plan]]`: click it, then **Open** in the preview
   card: that folder's file opens in a `wiki-file:` tab, whose **Links here** lists the third
   note as `<root>:<Note>`. A bare link to a name with one match elsewhere resolves to it. Type
   a typed link (`[[Plan|the plan @depends_on]]`): it reads "the plan depends_on", the type
   marked.
5. Move `Plan.md` in the plain folder from its tree row: links in the plain folders follow on
   disk; the hosted folder's links stay and the toast names that folder. Repeat from the hosted
   main checkout: "Moved in your draft". Repeat with the palette command.
6. A base with no filters lists both folders' files, the other folder's as `<root>:<path>`;
   add `file.root == "<key>"` and only that folder's remain.
7. Keep a chat canvas into the hosted folder (draft) and the plain one (on disk).
8. Open `/wikis` and an old `/wikis/<id>?environmentId=…&note=…` link.
9. Phone: Projects → `Browse all files` → Show → Docs; open a note in each folder and check the
   subtitle; edit; open the draft sheet.

## Gotchas

- Seed `statev2.sqlite`, not `state.sqlite` (AGENTS.md). A hosted root needs a pull request host
  remote and its main checkout on the default branch, or every edit goes to disk.
- Never press **Open pull request** on a repository we use: it pushes to the host.
- `data-wikilink` holds the raw target (with any `#Heading`).
- Tree rows live in the `@pierre/trees` shadow root; dispatch events on the row found there.

## Owns

`components/repositories/ProjectDocumentView.tsx`, `ProjectDraftPill.tsx`,
`ProjectMoveDialog.tsx`, `ProjectRootSections.tsx`, `projectDocument.ts`, the Docs parts of
`RepositoryFilterMenu.tsx` and `repositoryFilter.ts`, the tree row's move entry in
`RepositoryWorktrees.tsx`, `apps/web/src/components/wiki/` (the document editors, bases,
canvases, legacy tabs), `routes/_chat.wikis*.tsx`, the move entry in `CommandPalette.tsx`,
`components/settings/ProjectDocumentSettings.tsx`, `WikiLocationSettings.tsx`,
`WikiCanvasSettings.tsx` and `WikiMapBackgrounds.tsx`, `packages/wiki/` and
`packages/wiki-editor/`, which builds on the note editor's core in `packages/editor/src/`
(`editor.tsx`, `markdown/`, `collab/`, `bridge/`), server `wiki/WikiService.ts`,
`wiki/CanvasKeep.ts`, `wiki/TurnDocsCheck.ts` and `mcp/toolkits/projectDocs/`, mobile
`features/wikis/`, the `ProjectDocument` route and legacy `Wiki*` redirects in
`apps/mobile/src/Stack.tsx`, and the Docs filter in `features/files/`.
