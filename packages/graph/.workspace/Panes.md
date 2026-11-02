# Panes

A pane is a region of the main area that holds a group of the thread's views as [[Tabs|tabs]] and shows one of them. The main area is a tree of panes, divided side by side or stacked, arranged however you like: drag a tab to an edge of another pane to divide it there, or onto its strip to move it, and drag a divider to resize. One pane has focus at a time, and the [[Composer|composer]] sits beneath it. Every pane shows views of the space's threads: one thread, or the members of a space of several ([[Spaces]]). _(2026-09-27, later: panes own tabs again, thread-scoped.)_ _(Designed 2026-09-24 as Splits, regions that held tabs; turned over 2026-09-27 into panes under a tab. The name Splits once also belonged to the retired design's per-repository splits, deleted 2026-09-16 ([[Mercurian]]).)_

## Why panes

A thread's views are read together: the conversation beside its checkpoints, a diff beside the turn that made it, a note beside the conversation that is amending it. Panes replaced the right sidebar for this ([[Thread Tabs]]). Comparing two threads is two browser windows, or one [[Spaces|space]] of several that gathers them.

## A pane's header

Beneath its tabs, every pane has a header, as Obsidian's panes do: back and forward through the tabs that pane has shown, the active tab's title in the middle, and the pane's options at the end. For a thread's view the title is the thread's name with its attention mark, so the pane says which thread you are reading and the [[Composer]] no longer needs to; in a [[Spaces|space]] of several the title opens the list of the space's threads, and choosing one shows **the same view for that thread**: from one thread's Files to the other's Files, not back to its conversation _(2026-09-30, Venkat: "each pane needs its own header like what obsidian does. We can move the thread name out of the composer to here"; and later, "switching the thread in the pane header switches it to the corresponding tab of the thread to which is switched")_. A view that holds several things, the browser preview's pages, terminals, open files, shows them as **sub-tabs** along the header's right side, condensing as Chrome's tabs do when the pane narrows, so each thread keeps one tab per view and the header's switch always has one place to go ([[Thread Tabs]]).

## Making and arranging

- A thread's own views open from the thread's header as panes beside it ([[Thread Tabs]]); a view already showing in another pane moves to the pane you open it from instead of opening a copy ([[Tabs]], 2026-09-28).
- Dragging a tab to an edge of another pane divides that pane, side by side or stacked; dropping it on the pane's strip moves it there.
- Closing a pane's last tab closes the pane and gives its room to its neighbours. The last pane stays, empty, with one action that asks which view to open ([[Tabs]]).
- Dividers resize. The arrangement and its sizes stay with the space, remembered per device ([[Tabs]]).

## On the phone

The [[Mobile App]] has no panes. A phone screen fits one view, and the phone's job is following and steering, not comparing.

## What exists today

See [[Tabs]].

## Open Decisions

### What happens when a split's last tab closes?

_(Raised 2026-09-25.)_ Closing the last tab in the main area leaves it empty, with the composer ready for a new thread ([[Tabs]]). With several splits open, closing the last tab in one of them is not yet designed. **The split closes:** its neighbours take its room, as in Obsidian. **The split stays, empty:** it keeps its place until something is opened into it. **Recommendation:** the split closes, and only the last split in the main area stays empty. An empty split is a layout nobody asked for. Given up: a slot that keeps its position for the next thing you open.

**Dissolved (2026-09-27): a pane holds one view.** Closing the pane is closing the view; its neighbours take its room, and only the last pane stays, empty. The recommendation survives as the rule above.

### Where does the one composer sit?

This question is recorded on [[Composer]]: beneath the focused pane, or across the bottom of the main area.

### Should the splits scroll sideways, as in Niri?

_(Raised 2026-09-25 by Venkat.)_ The Niri window manager lays windows out as columns on a strip that extends to the right without end. Opening a window adds a column beside the focused one at its own width instead of shrinking the others, and moving focus scrolls the strip to bring the column into view. Here the columns would be splits, and a column could still stack splits within it. **Tiled only:** splits always divide the main area as designed above. Everything open is on screen, and each split gets narrower as you add one. **Scrolling as an option:** a per-device setting lets splits keep their width while the main area scrolls sideways. It is the same splits with a different rule for width, and dragging, focus, and the composer behave the same way in both. **Scrolling only:** the strip replaces tiling. **Recommendation:** scrolling as an option, defined as a width rule on the same splits rather than a second way of arranging them. It suits research, where the next fork or note is opened beside the last one and the earlier ones should keep their room. It also fits what the design already does: a split scrolled out of view is a hidden view, so it stops updating and catches up when you scroll back ([[Tabs]]), which makes a long strip cost nothing. It stays optional because tiling is what people expect from Obsidian and most editors, and a strip hides what is off screen. The [[Mobile App]] has neither. Given up in scrolling mode: seeing everything you have open at once; knowing that a thread needs you still depends on its tab's attention state ([[Status Vocabulary]]).

**Resolved (2026-09-25, Venkat): scrolling as an option, set per device.** Each device chooses tiled or scrolling splits for itself, as it keeps its own arrangement of tabs and splits ([[Tabs]]). The phone stays single-view, with neither layout ([[Mobile App]]). Given up: one layout that follows you from machine to machine. The ruling did not separately address defining scrolling as a width rule on the same splits; that framing stands as the recommendation above.

**Reversed (2026-09-27, Venkat): no scrolling layout.** The strip existed to hold panes that did not fit on screen. With tabs holding what is not visible, a tab's panes always fit its window, and a second layout engine has nothing left to do. The 2026-09-25 option is withdrawn before shipping, and the playground's Niri build comes out. Given up: Niri's columns, and the sideways strip as a research surface.
