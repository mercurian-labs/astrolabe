# Canvases in threads

An agent's `astrolabe_canvas_show` call draws a board in the thread. The tool call is the only
record, so a real turn is the test: the Replay provider can't make an MCP call. Use the cheapest
real model, and ask for a diagram of boxes and arrows that cites a file.

- **Web and desktop:** the board shows in the timeline with no layout shift when it loads. Its
  caption's `Open <title> in a linked tab` (`components/canvas/CanvasFrame.tsx`) opens a Canvas
  tab. Drag, wheel, Ctrl-wheel and the zoom buttons (`Zoom in`, `Reset zoom`, `Fit the board in
  view` with text "Fit", `Zoom out`; `packages/wiki-editor/src/CanvasBoard.tsx`) all work there. A code card opens its file at the cited line. Check dark mode.
- **Phone:** the feed shows the layout as a thumbnail. Tapping opens the board, which pans by
  touch. A swipe from the left edge goes back, and doesn't pan. A code card opens its file. A
  killed page (`onContentProcessDidTerminate`) comes back with the camera where it was.
- **Keep:** the board's Keep button (`Keep <title>`: a bookmark in the timeline, **Keep** in the
  Canvas tab, the phone's header) opens a comment box (`components/canvas/KeepCanvas.tsx`). Enter
  adds a board chip to the composer; Cmd/Ctrl+Enter adds and sends. **Place in wiki** shows the
  wiki and name form, where a folder prefix such as `ops/Board` files it in that folder. **Place
  it** files it, then says it's in a pull request, with **Done** and **Open it**. Check the
  file opens at the coordinates the thread showed, ids are 16 hex, and closing the pull request
  leaves the thread's board. Code cards: a pushed commit gives a link pinned to it, with `astrolabe`
  holding repository, commit, path and lines; an unpushed commit links to the nearest pushed one
  and the dialog says so; a file only in unpushed commits, a repository with no remote, and a
  self-hosted Bitbucket write a text card with the path and commit. A name already taken says so,
  and no wiki on the server reads "A canvas is kept in a wiki, and this server has none yet…". A
  guest page has no Keep.
- **Settings:** the canvas settings are under Settings → Wikis → **Canvases**.
- **Hermes:** the phone runs the layout code on an engine without newer array methods. A broken
  build shows as a render error on any thread holding a canvas.
