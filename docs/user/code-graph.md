# Code graph

The code graph shows how code connects, drawn the way Obsidian draws its graph: dots for files,
folders or definitions, lines for the imports and uses between them. It appears in two places: a
thread's **Graph** tab, around the files the thread changed, and a file's
[local graph](projects.md#local-graph) in Projects, around that file. Both read the
repository's code index, set in **Settings → Projects**.

## A thread's Graph tab

Open **Graph** from a thread's right-panel launcher. The files the thread's turns changed are in the
accent colour, with the files they import and the files that import them around them. A thread
that hasn't changed a file yet has no graph.

Click a file to open it beside the chat; the graph moves to it. **Back to the thread's changes** in
the header returns to the changed files.

## Levels of detail

**Level** in **Graph settings** sets how fine the dots are: **Folders**, **Modules**, **Files**,
**Definitions** (classes, types, functions) or **Members** (methods). A module is how the language
groups files: a TypeScript package (a folder with a `package.json`), a Go package, a Python package
(a folder with `__init__.py`), or a Rust module. Lines between folders or modules stand for the
imports between their files, and lines between definitions for the calls and uses between them.
A fainter line was matched by name alone, where several definitions share it.

## Growing the graph

- **Double-click** a dot to add its neighbours, or to take them away again. A dot those neighbours
  share with the rest of the graph stays.
- **Right-click** a dot for **Expand neighbours**, **Show contents** (a folder's files, a file's
  definitions, drawn inside a soft circle), **Centre here** and **Open**. Click the circle, or
  right-click it and choose **Hide contents**, to close it.
- **Reset the graph** in the header undoes what you added. Moving the graph to another file
  starts it fresh.

Drag a dot to move it, drag the background to pan, and scroll to zoom. **Graph settings** also has
the depth (0 shows only the files themselves and the lines between them), filters, groups,
display and forces.

## Pictures and stories from agents

When you ask an agent to explain or diagram how code fits together, it can show you a picture
of the code graph, or a story you step through, in the thread's Graph tab. The tab opens on it
with the agent's caption above the graph; **Previous step** and **Next step** move through a story.
The menu at the top of the tab lists every picture and story in the thread, and **Changes** goes
back to the thread's own changes. Agents show these only when you ask, or when a skill you ran
tells them to.
