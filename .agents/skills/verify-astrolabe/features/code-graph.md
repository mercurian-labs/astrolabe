# Code graph

The code graph over a project's code index, drawn the way Obsidian draws its graph (Pixi,
`packages/graph`): a thread's **Graph** tab (a right-panel surface and linked tab, around the
files the thread changed) and the Projects local graph (around one file, see the Projects
section in repositories.md; its **Following** toggle keeps it on the file in front). Both render `CodeGraphView`. Agents show pictures and stories in the Graph tab
with `astrolabe_code_graph_show`. User guide: `docs/user/code-graph.md`.

## Sub-features

- **Thread Graph tab**: right-panel launcher **Graph** (`G`). Header: no Back/Forward
  (a thread's surface never navigates in place), the view menu
  (`combobox "Graph view"`, only once an agent has shown a view: **Changes**, then each picture or
  story by title), **Back to the thread's changes** (after a click re-rooted it), **Reset the graph**
  (after an expansion), **Fit the graph**, **Graph settings**. Roots are the files in the thread's
  checkpoint summaries, in the thread's worktree (else the project folder); none reads "This
  thread hasn't changed any files yet."
- **Levels**: Graph settings › Filters › **Level** (`Folders`, `Modules`, `Files`, `Definitions`,
  `Members`) and **Depth** 0–3. Kept per device: `astrolabe:thread-code-graph:v1` (thread tab),
  `astrolabe:repository-local-graph:v1` (Projects).
- **Gestures**: click a file opens it (thread tab: beside the chat via the right panel's Files;
  Projects: the file pane) and re-roots; click a folder or module shows its contents;
  double-click a dot toggles its neighbours (the single click waits ~280 ms for it);
  right-click opens the app context menu (**Expand/Collapse neighbours**, **Show contents**,
  **Centre here**, **Open**; on a cluster's disc **Hide contents**, **Centre here**, **Open**);
  click a disc off its dots hides its contents. No keyboard path: the canvas takes no focus.
- **Clusters**: an opened folder, module, file or definition draws as a soft disc around its
  parts, its name above, the accent on its rim when it holds a root. At Definitions/Members
  only roots and expanded files show every definition; other files show only the definitions
  that link to the graph (`codeIndex/queries.ts`).
- **Agent views**: a finished `astrolabe_code_graph_show` call in the open thread opens the Graph
  tab on it; caption strip under the header, **Previous step** / **Next step** and `n / m` for a
  story. Views come from the thread's own tool calls (no store), so they survive a reload and read
  the same on every client.

## Walk

1. In a dev-server thread that has changed a few code files (one with none reads "This
   thread hasn't changed any files yet…"), open **Graph**: the changed files are
   the accent dots, links drawn at rest, nothing moving once settled (no frames at rest).
2. Graph settings › Level: walk Folders → Modules → Files → Definitions → Members; each keeps the
   picture (nodes grow from where their holder stood) and Definitions draws file discs.
3. Double-click a neighbour: its neighbours join one ring out; double-click again: they leave,
   except dots another expansion or the roots still reach. Right-click → **Show contents** on a
   file, then click its disc: it closes.
4. Click a file: it opens in the right panel's Files beside the chat, the graph re-roots on it;
   **Back to the thread's changes** returns.
5. Ask the agent: "Walk me through how X reaches Y, as a diagram I can step through." The tab
   opens on the story; step it; the view menu lists it; after a reload the tab opens on
   **Changes** and the story is still in `combobox "Graph view"`.
6. Projects: open a file's local graph (`r g`); click, double-click and the menu behave as in
   3–4, and a following graph follows the file the click opened.

## Owns

`apps/web/src/components/codeGraph/`, `components/graph/` (GraphPanel, threadGraph,
threadGraphStore, useCodeGraphViewOpener), `state/codeGraphViews.ts`,
`client-runtime/src/codeGraphViews.ts`, `packages/graph`, server `codeIndex/queries.ts`
(`localGraph`, `checkNodes`) and `codeIndex/levels.ts`, `mcp/toolkits/code/` (`astrolabe_code_graph_show`).
