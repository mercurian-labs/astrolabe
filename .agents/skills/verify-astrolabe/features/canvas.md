# Canvases in threads

An agent's `astrolabe_canvas_show` call draws a board in the thread. The tool call is the only
record, so a real turn is the test: the Replay provider can't make an MCP call. Use the cheapest
real model (a walk on Codex GPT-6-Luna worked), and ask for a diagram of boxes and arrows that
cites a file.

- **Web and desktop:** a board shows inline where the reply embeds `![[Name.canvas]]`, with no
  layout shift when it loads, and every board the turn drew is also in its "1 canvas" / "N
  canvases" list (`[aria-label="Canvases"]`, `components/canvas/TurnCanvases.tsx`). Its
  caption's `Open <title> in a linked tab` (`components/canvas/CanvasFrame.tsx`) opens a Canvas
  tab, which is editable (Edit on an inline board opens it there). Drag, wheel, Ctrl-wheel and the zoom chip (`Zoom out`, `Fit the board in view` whose text is
  the zoom level such as "99%", `Zoom in`; `packages/wiki-editor/src/CanvasBoard.tsx`) all work
  there. A code card opens its file at the cited line. **Canvas menu** → **Ask about this
  canvas** (`canvasMenuItems.ts`) adds a board chip to the composer (`chat/CanvasContextChip.tsx`).
  Check dark mode. The keys help (`?`) still lists "Present the story" (`P`), a known leftover of
  retired stories (`CanvasChrome.tsx`).
- **Phone:** the feed shows the layout as a thumbnail. Tapping opens the board, which pans by
  touch. A swipe from the left edge goes back, and doesn't pan. A code card opens its file. A
  killed page (`onContentProcessDidTerminate`) comes back with the camera where it was.
- **Keep:** on web, the timeline's bookmark (`role=button[name='Keep <title> in the project']`, in the
  turn's canvases list) and the board's **Canvas menu** → **Keep in the
  project…** (the Canvas tab and the inline board) open the `Keep <title>` dialog
  (`components/canvas/KeepCanvas.tsx`; no comment step on web): an explanation, a **Folder**
  picker when the project has several folders on disk (else it picks the only one), a **Name**
  field (a prefix such as `ops/Board` files it in that folder) and **Place it**
  (`role=button[name='Place it']`). Where it lands
  (`CanvasKeep.ts`): a hosted repository's main checkout on its default branch puts it in your
  draft ("`<file>` is in your draft in `<folder>`. Open a pull request from the draft's menu…",
  **Open it** opens the board inside the draft); anywhere else (a thread's own worktree, a
  repository with no host, a plain folder, a main checkout on another branch) writes the file on
  disk ("`<file>` is written in `<folder>`, uncommitted: commit it with your other changes. The
  canvas stays in this thread either way.", **Done**, and **Open it** only for the project
  folder, in the thread's files). The phone's sheet (`KeepCanvasSheet.tsx`) reads the same, and its header
  **Keep** still opens a comment box first: Enter adds a board chip to the composer, Cmd/Ctrl+Enter
  adds and sends, **Place in the project** goes to the same form. Check the file opens at the
  coordinates the thread showed, ids are 16 hex, and the thread's board stays either way. Code cards: each pins to its own folder's remote (`api:src/index.ts` and `src/index.ts`
  link to two repositories); a pushed commit gives a link pinned to it, with `astrolabe` holding
  repository, commit, path and lines; an unpushed commit links to the nearest pushed one and the
  dialog says so; a file only in unpushed commits, a repository with no remote, and a self-hosted
  Bitbucket write a text card with the folder, path and commit, and the dialog says so (e.g. "2
  code cards became text: this repository has no remote to link to."). Only a kept board marks a
  code card "Changed since this commit" or "Gone from the project's head"
  (`packages/wiki-editor/src/CanvasBoard.tsx`, `wiki/wikiCanvasHost.tsx`). A name already taken
  says so. A guest page has no Keep.
- **Settings:** the canvas settings are under Settings → Projects → a project → **Canvases** (one
  set per server; `components/settings/ProjectDocumentSettings.tsx`, `WikiCanvasSettings.tsx`).
- **Source:** web `components/canvas/`, `chat/CanvasContextChip.tsx`; phone
  `features/threads/ThreadCanvas.tsx`, `ThreadCanvasScreen.tsx`, `KeepCanvasSheet.tsx`; server
  `wiki/CanvasKeep.ts`.
- **Hermes:** the phone runs the layout code on an engine without newer array methods. A broken
  build shows as a render error on any thread holding a canvas.
