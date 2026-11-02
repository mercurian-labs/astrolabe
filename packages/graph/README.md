# @mercurian/graph

The code graph Astrolabe draws in Repositories (a file's local graph) and in a thread's Graph tab:
roots in the middle and what they import and what imports them, as folders, modules, files or
definitions, drawn the way Obsidian draws its graph. It is 2D only, painted with Pixi.js.

```sh
vp test run   # model, forces, renderer (with a recording drawer) and label placement
```

## Shape

- `src/FileGraph.tsx` (entry `@mercurian/graph/file`): the React component around the renderer.
  Hosts import `@mercurian/graph/styles.css` and set the `--atlas-*` colours on an ancestor.
- `src/model`: the graph a host hands over (`fileGraph.ts`: nodes, links, open clusters, a story
  step's focus) and the Obsidian-style display and force settings (`fileGraphSettings.ts`).
- `src/layout/fileForces.ts`: live d3 forces (centre, repel, link, and a cluster force that keeps
  an open cluster together) that stop once the graph settles.
- `src/render/file`: `FileGraphRenderer` owns the camera, hover, clicks (a single click waits out
  the double-click window), cluster discs and label placement; `pixiFileDrawer` only paints.
  Frames are drawn only on a change (`render/scheduler.ts`), so a graph at rest costs nothing.
