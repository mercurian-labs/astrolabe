# Thread header in the tab strip

T3 Code's thread header (the project / title breadcrumb, panel controls, and
thread details) stays at the top of each conversation's tab, inside the panes.
The tab strip above is the window's title bar, so the header drops its drag
region and its inset for a collapsed sidebar's toggle.

## Sub-features

- The breadcrumb `navigation "Thread breadcrumb"` sits under the strip in the
  Main Thread tab and in each guest's tab.
- **Toggle thread details panel** ends the conversation's header. It opens
  the Thread details card (Workspace, Version Control) at a fixed width, even
  when the pane is narrow.
- The header takes the tab strip's colour, and keeps T3 Code's gutter from the
  sidebar.

## How to get to it (user POV)

Open any thread. The breadcrumb is under the tabs, and the details toggle is at
its right end.

## Driving it with the Browser panel

```
preview_wait_for  locator=role=navigation[name='Thread breadcrumb']
preview_click     role=button[name='Toggle thread details panel']
preview_wait_for  locator=role=complementary[name='Thread details']
```

**Proof:** the toggle's `aria-pressed` flips and the `Thread details` region
appears or disappears. After a Split right, with the conversation in a pane
half the width, the details card keeps its width (read
`getBoundingClientRect().width` of the complementary element before and after).
Save a screenshot for header colour and gutter, since those are visual-only.

## Gotchas

- A fresh draft opens with details pressed (shown). Read the current state
  before toggling.
- With a non-conversation tab in front, the details shortcut does nothing, by
  design (see `panes/shortcuts.ts`).
