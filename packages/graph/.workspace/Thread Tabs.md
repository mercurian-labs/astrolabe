# Thread Tabs

Thread tabs are the views that belong to one [[Threads|thread]]: **[[Checkpoint Graph|Checkpoints]]**, **Files**, **Diffs**, the memory **[[Atlas Graph|graph]]**, the **terminal**, the **browser preview**, and the **pull request**. Each opens as a [[Tabs|tab]] in a [[Panes|pane]], most often beside the conversation, and the [[Composer|composer]] addresses the window's thread whichever pane has focus. _(2026-09-27: the window is one thread, panes hold its views as tabs.)_ _(2026-09-24: formerly the right sidebar, a panel of these views beside the thread. The splits in the main area now do its job; see "Why no right sidebar" below.)_

Its contained concepts are [[Checkpoint Graph]], [[Atlas Graph]].

## The views

- **Checkpoints** is the thread's history and its family, read as checkpoints, in its Thread, Columns, and Graph views. Its Graph view opened on its own is the thread's local DAG ([[Checkpoint Graph]]).
- **Files** reads the files the thread's turns touched, in the repository the thread's header has selected. A file keeps its repository and reading position when that selection changes, and a file from an earlier checkpoint says plainly when it no longer exists.
- **Diffs** reviews what the thread changed.
- **Graph** is the [[Atlas Graph]]: the memory as the thread's branch has it, with the notes and links the thread's turns reach rising into view.
- **Terminal**, **browser preview**, and **pull request** are T3 Code's own working views, each tied to the thread's checkout.

The working views appear once the thread has working state. Before the thread's first turn lands, the thread's menu names them and says why they wait. The git actions, the open-in picker, the repository scripts, and the repository switcher stay in the thread's header, not in a tab.

## Opening them

Each thread has at most one tab of each kind, linked to it, so switching the thread in a pane's header moves to the same kind of tab for the other thread ([[Panes]]). The kinds that hold several things, the browser preview, the terminal and Files, keep them as sub-tabs inside their one tab, each thread remembering its own _(2026-09-30, Venkat: "tab types like browser windows can and should allow more than one tab per tab type per thread. This is where sub tabs might be useful.")_. Each thread tab opens from the thread's header, and Checkpoints also opens from the thread's row menu in the [[Left Sidebar]]. Opening a thread tab that is already open in another pane moves it to the pane you asked from, never a copy ([[Tabs]], 2026-09-28). A thread tab is **linked** to the window's thread by construction: every pane shows that one thread, and the thread's tabs are its own arrangement, remembered per device ([[Tabs]]), so a sidebar click brings the other thread's own tabs rather than re-pointing these. _(2026-09-26 resolved this as Obsidian-style linking to the tab a view was opened from; the 2026-09-27 inversion makes it the only case, and there is no unlinking; the same evening's per-thread ruling on [[Tabs]] settles what a swap shows.)_

## Why no right sidebar

The right sidebar existed because the thread space had one column for the conversation and needed a second for everything that describes it. With splits, any view can stand beside any other, so a dedicated column is a second, weaker way to do what splits do. It also carried rules that splits make unnecessary: a pinned Checkpoints view that could never close, per-thread memory of the panel's open state, tab, and width, and a placement beside the header that narrowed it. Given up: a place that is always on the right, and history that is visible without asking for it (the question of a first-open default is below).

## What exists today

Nothing Mercurian. Astrolabe runs T3 Code's own client, whose thread view has a tabbed right panel for its working views. Before the reset, Mercurian's build of that panel carried the Checkpoint Graph and the working views behind corner icons; that build survives only on the archived main.

## Open Decisions

### Does a thread open with its Checkpoints beside it?

_(Raised 2026-09-24.)_ Since 2026-07 a thread has opened with its history visible, and the right sidebar "earns its closing rather than its opening." **Beside it on first open:** the first time you open a thread, it opens with Checkpoints in a split beside it, and after that the layout you leave is what returns. **Alone:** a thread opens alone, and Checkpoints is one control away in its header. **Recommendation:** beside it on first open. History has been visible by default for as long as it has existed in the design, and the reason still holds: forking and continuing start from seeing the checkpoints. Given up: a first open that fills the whole main area with the conversation. _(2026-09-27, morning: carried onto [[Tabs]] as the starting arrangement of a tab that holds nothing else.)_

**Resolved (2026-09-27, Venkat): alone.** A new thread opens as one pane with one tab, the conversation; adding a tab is where a view is chosen. The remembered starting arrangement of the same morning is withdrawn with it. Given up: history visible without asking for it; Checkpoints is one tab away.

### Can a thread tab follow the focused thread?

_(Raised 2026-09-24.)_ Obsidian lets a pane link to the active note, so its outline or local graph follows whatever note you focus. **Stays with its thread:** as designed above. Two threads' Diffs can stand side by side for comparing, which is the reason for splits. **Follows focus:** one Checkpoints tab always shows the focused thread's history. **Recommendation:** stays with its thread, and no following for now. Comparing two threads is the work splits exist for, and a view that changes under you when you click elsewhere works against it. Given up: one Checkpoints tab that serves every thread.

**Resolved (2026-09-26): linked, as Obsidian links a pane.** Neither option as framed. Obsidian's local graph is linked to one note pane, not to whichever note has focus, and that is the third answer: a thread tab follows the tab it was opened from, and nothing else. It keeps what "stays with its thread" was for, since two threads' Diffs side by side are each linked to their own thread, and it gives what "follows focus" was for, since moving a tab to another thread brings its Checkpoints, Diffs, and graph along instead of leaving them behind on the old thread. The rule is the same for every thread tab, so there is one thing to learn. Given up: a thread tab that can never change under you without unlinking it first. _(2026-09-27: subsumed by the one-thread-per-tab rule on [[Tabs]]; unlinking is gone with it.)_
