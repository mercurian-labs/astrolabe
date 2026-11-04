# Canvases in threads

An agent's `astrolabe_canvas_show` call draws a board in the thread. The tool call is the only
record, so a real turn is the test: the Replay provider can't make an MCP call. Use the cheapest
real model, and ask for a diagram of boxes and arrows that cites a file.

- **Web and desktop:** the board shows in the timeline with no layout shift when it loads. Its
  expand button opens a Canvas tab. Drag, wheel, Ctrl-wheel, the zoom buttons and **Fit** all
  work there. A code card opens its file at the cited line. Check dark mode.
- **Phone:** the feed shows the layout as a thumbnail. Tapping opens the board, which pans by
  touch. A swipe from the left edge goes back, and doesn't pan. A code card opens its file.
- **Hermes:** the phone runs the layout code on an engine without newer array methods. A broken
  build shows as a render error on any thread holding a canvas.
