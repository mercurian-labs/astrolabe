# Canvases in threads

An agent's `astrolabe_canvas_show` call draws a board in the thread. The tool call is the only
record, so a real turn is the test: the Replay provider can't make an MCP call. Use the cheapest
real model, and ask for a diagram of boxes and arrows that cites a file.

- **Web and desktop:** the board shows in the timeline with no layout shift when it loads. Its
  caption's `Open <title> in a linked tab` (`components/canvas/CanvasFrame.tsx`) opens a Canvas
  tab. Drag, wheel, Ctrl-wheel and the zoom chip (`Zoom out`, `Fit the board in view` whose text is
  the zoom level such as "99%", `Zoom in`; `packages/wiki-editor/src/CanvasChrome.tsx`) all work
  there. A code card opens its file at the cited line. Check dark mode.
- **Phone:** the feed shows the layout as a thumbnail. Tapping opens the board, which pans by
  touch. A swipe from the left edge goes back, and doesn't pan. A code card opens its file. A
  killed page (`onContentProcessDidTerminate`) comes back with the camera where it was.
- **Keep:** on web, the timeline's bookmark (`button "Keep <title> in the project"`, in the
  turn's "N canvas" list, `TurnCanvases.tsx`) and the board's **Canvas menu** → **Keep in the
  project…** (the Canvas tab and the inline board) open the `Keep <title>` dialog
  (`components/canvas/KeepCanvas.tsx`; no comment step on web). It picks the project's only folder
  on disk by itself and shows a **Folder** picker when there are several; a prefix such as
  `ops/Board` files it in that folder. Where **Place it** lands it (`CanvasKeep.ts`): a thread with
  its own worktree of the folder gets the file there, uncommitted; a hosted repository's main
  checkout on its default branch gets a change request ("…is in “Keep <title>” in <folder>",
  **Open it** opens the board inside it, cards marked Added); a repository with no host, a plain
  folder, or a main checkout on another branch gets the file on disk ("…is written in <folder>,
  uncommitted", **Open it** only for the project folder, in the thread's files). The phone's header
  **Keep** still opens a comment box first: Enter adds a board chip to the composer, Cmd/Ctrl+Enter
  adds and sends, **Place in the project** goes to the same form. Check the file opens at the
  coordinates the thread showed, ids are 16 hex, and closing a change request leaves the thread's
  board. Code cards: each pins to its own folder's remote (`api:src/index.ts` and `src/index.ts`
  link to two repositories); a pushed commit gives a link pinned to it, with `astrolabe` holding
  repository, commit, path and lines; an unpushed commit links to the nearest pushed one and the
  dialog says so; a file only in unpushed commits, a repository with no remote, and a self-hosted
  Bitbucket write a text card with the folder, path and commit. A name already taken says so. A
  guest page has no Keep.
- **Settings:** the canvas settings are under Settings → Projects → a project → **Canvases** (one set per server).
- **Hermes:** the phone runs the layout code on an engine without newer array methods. A broken
  build shows as a render error on any thread holding a canvas.
