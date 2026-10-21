# Change Requests (Pull Requests)

Astrolabe's third section, beside Threads and Wikis: every pull request on the
connected git hosts, listed in its own sidebar and opened in Obsidian-style tabs and
splits (the same panes as Wikis and the right panel, see [panes.md](panes.md)).
Astrolabe owns the section's shell (sidebar frame, panes, tab history, selection,
drag); the list logic, filters, rows, the review itself and every action are upstream
T3 Code's (`pullRequestList.logic.ts`, `PullRequestDetailPanel.tsx`), shared with the
thread's own Pull request tab. Shown only when a connected server reports
`capabilities.pullRequests` (every current server does).

## Sub-features

- **Name**: the rail item, Go to (`g p`), the narrow-window footer and the sidebar read
  **Change Requests** / "Change requests"; the route is still `/pull-requests` and
  upstream's own strings ("Open pull requests" in the palette, "pull request" inside a
  review) are unchanged.
- **Wiki changes** (web, `components/changeRequests/WikiChangesGroup.tsx`): the wikis' change
  requests in their own group above the pull requests (`ul[aria-label='Wiki changes']`):
  "Wiki changes · N" (with the wiki's name and a clear button when Wikis' filter,
  `astrolabe:wiki-scope:v1`, picks one), open ones as cards
  (`[data-testid=wiki-sidebar-row]`), then a folded "Merged and closed · N" shelf of slim
  rows. The section search narrows them by title. A click shows one in the focused
  pane's tab in front (`showChangeRequestTab`), Option-click a new tab, Cmd/Shift
  select, drag places them; a pull request row over a wiki change replaces it, and
  Back/Forward walk across both kinds. Hidden when a project or a single host is picked.
- **A wiki change request's pull requests** (`client-runtime/src/wikiPullRequests.ts`):
  its view lists the writing thread's pull requests (`ul[aria-label='Pull requests']`,
  state per row, **Open** shows one beside it: a Change Requests tab, a Wikis pane, or the
  thread's own Pull request surface in its right panel). One merged → an info alert
  "Pull request #N merged" with **Merge docs**; all closed unmerged → **Close change
  request**. **Merge** while one is open confirms first. Nothing merges on its own; the
  pull request's own view is upstream's and shows no link back.
- **Mobile**: the tab reads "Change requests"; a "Wiki changes · N" section (open rows,
  a folded "Merged and closed · N" shelf, then a "Pull requests" rule) sits above the pull
  requests (`features/wikis/WikiChangesSection.tsx`); the Wikis tab's first row "Open
  changes · N" switches to it. A wiki change request's screen lists its thread's pull
  requests (`#N · State`, tap opens the review), the merge/close prompt, and Merge into
  main's dialog names an unmerged one. No kind switch on mobile. Walk on an iPhone with
  agent-device; rows are buttons named `<title>, change request in <wiki>`.
- **Source filter** (`changeRequests/ChangeRequestSourceFilter.tsx`, button `Filter by source:
<name>` beside Sort and Filters, in place of upstream's provider menu): a searchable list of
  All, each project (a wiki's folder project is left out), All wikis, each wiki ("Wiki").
  A project is the list's `projectId` scope and hides Wiki changes; a wiki sets the kind
  (`astrolabe:change-request-kind:v1`) and Wikis' own wiki filter (`astrolabe:wiki-scope:v1`,
  one shared store), and hides the pull requests, Sort and Filters; All clears both. Filters
  still holds Host (with several hosts) and upstream's Project, which mirrors the same scope.
  Mobile puts the wikis at the end of Filters → Project ("All wikis", "<wiki> · Wiki");
  the menu scrolls, so walk it with two short `scroll down 0.3` steps.
- **Sidebar** (`role=navigation[name='Change requests']`): heading **Change requests** and
  **Refresh pull requests**; no New or Link button. Under it `searchbox "Search pull
requests"` (placeholder "Search pull requests, or label:bug"), then **Filter by source:
  <name>**, **Sort pull requests: <sort>** and **Filters** (a count badge per non-default
  filter).
  - Search matches number, title, repository, branch and author, and takes GitHub-style
    qualifiers: `label:`, `-label:`, `author:`, `draft:`, `review:`, `checks:`/`status:`;
    an unknown `key:value` is read as that label. The query is the URL's `q`. No match
    shows "Nothing matches “…”" with **Clear search** and **Check again**.
  - Sort: Merge readiness (default, left out of the URL), Blocked on me, Recently
    updated, Newest/Oldest shown, Largest/Smallest shown.
  - Filters submenus: State (All/Open/Closed/Merged), Involvement (All/Reviewing/
    Authored), Author, Labels (both built from what is loaded), Draft, Review, Checks,
    Project; Host and Server only when there are several.
  - Groups, only with Involvement All: **Authored**, **Review requested**, **Others**
    (an `h2` with the count), empty ones hidden. 99 rows a page with **Load more pull
    requests**; refreshes on focus and every minute, so rows reorder while you look.
  - Rows: `[data-pull-request-key] > button`, named `#<n> <title>`: state glyph,
    `owner/repo`, time; `#n` and title; author, a **Checks: …** popover button, the
    review glyph and `+a −d`. No hover card, labels or stack grouping (the thread's
    list has those). The open one is `aria-current="page"`.
  - Quick actions: holding Shift shows `group "Quick actions for pull request #n"` on
    each row (Close/Merge, Ready for review, Reopen, as the host allows); they are in
    the DOM but `display: none` otherwise. They write to the host.
- **Main area**: one arrangement on the device (localStorage
  `t3code:right-panel-panes:v1:pull-requests`). A plain click shows the pull request in
  the focused pane's tab in front (one open in another tab comes forward there; an
  empty tab makes way). Option-click, middle-click, Alt+Enter and the row's right-click
  **Open in new tab** open a new tab. Mod-click and Shift-click select rows
  (`data-selected`) without opening; a selected row's right-click is **Open N in new
  tabs**. Rows drag onto a pane's strip or content, the selection with them
  (`placePullRequests`). Tabs are `[data-pane-tab]` labelled `#<n> <title>`; an empty
  tab reads "No change request open". **Pane actions**: Split right / Split down (disabled
  for a pane's only tab), Close pane. The URL follows the focused pane's pull request
  (`repository`, `number`, `selectedHost`, `selectedProjectId`, `selectedEnvironmentId`).
- **History**: each tab walks back and forward through what it showed (localStorage
  `astrolabe:pull-request-tab-history:v1`) with the title bar's **Back**/**Forward**,
  `mod+[`/`mod+]` and Space `t h`/`t l`. A pull request picked inside a review (stack
  menu, a link in its text) replaces that review's tab.
- **The review**: `nav[aria-label='Pull request tabs']` holds **Summary** (reviewers,
  labels, description, checks, comments), **Guide** (only with Settings → Source Control
  → review guides on), **Timeline** and **Code** (the diff, with scope, split/stacked,
  file tree, Viewed). Every review opens on Summary. **More pull request actions**: Link
  to thread, Refresh, Ask a question, Explain this PR, Fix findings in a thread, Open on
  GitHub, Copy link, Copy PR number. Commenting and reviewing use the floating
  **Comment on pull request** button.

## How to get to it (user POV)

The pull request icon in the icon rail (between Wikis and Usage), the keyboard menu's
`g p`, **Change Requests** in the Command Palette, or a pull request link in a
conversation. Each lands on the last list filters (localStorage
`t3.pullRequests.preferences`, written only when a list control changes).

## Driving it with the Browser panel

```
preview_click     role=navigation[name='Sections'] >> role=button[name='Change Requests']
preview_wait_for  [data-pull-request-key] > button
preview_click     [data-pull-request-key] > button >> nth=1    # replaces the tab in front
preview_click     [data-pull-request-key] > button >> nth=2 (button: right)
preview_click     role=button[name='Open in new tab']          # a second tab
preview_evaluate  dispatch a click with metaKey / altKey on a row button
preview_click     role=button[name='Back']                    # the focused tab's history
preview_evaluate  set the searchbox's value with the native setter, then dispatch input
preview_navigate  /pull-requests?involvement=authored&state=open   # Filters shows 1
```

**Proof:** tab labels per pane (`[data-pane-id]` → `[data-pane-tab]`, `aria-selected`),
the lit row (`[data-pull-request-key] > button[aria-current=page]`), the URL's `number`
and `q`, and the localStorage keys above. Save a screenshot of the section.

## Gotchas

- **Never click anything that writes to the host**: the list shows real pull requests
  (often upstream `pingdotgg/t3code`). Merge, Close, Reopen, Ready for review, Approve,
  Submit review, Comment, reactions, title/description edits, reviewer and label
  pickers, Update branch and Link to thread all write. Open menus to read them, then
  Escape. Hold Shift only to read the quick actions.
- The URL keeps the last pull request while a wiki change request or other foreign tab
  is focused (it follows only pull requests).
- A real link test needs a thread with a linked pull request that wrote a wiki change:
  add a scratch folder as a project, start a Claude thread there, ask it to amend a note
  with `t3_wiki_amend` only, then **Link pull request to thread** (palette) with a merged
  and an open upstream pull request URL; nothing is written to the host.
- Escape with nothing open leaves the section for the last thread (`useEscapeToGoBack`,
  `routes/_chat.pull-requests.tsx`); it does not clear the row selection as in Wikis.
  Blur, then press Escape only while a menu is open.
- Shift-click ranges follow the data's order, not the screen's, so a short range can
  select dozens of rows.
- A reload brings every tab back: T3 Code keeps the page's record for the session only,
  so the panes put back the pull requests their saved tab keys name
  (`restorePullRequestTabs`). The default profile shares this localStorage with any
  other tab on the same origin, so two walks at once overwrite each other's layout.
- The row's right-click menu renders as plain buttons, not menuitems. Filters'
  submenus open on hover and often lag in the Browser panel; read their options from
  `PullRequestListFilters.tsx` when a hover times out.
- The row's checks badge counts skipped checks as passing, so it can say "All checks
  have passed" while Summary says "22 of 31 passing".

## Owns

`components/pullRequest/PullRequestsSidebar.tsx`, `PullRequestPanes.tsx`,
`pullRequestTabs.ts`, the section shell in `routes/_chat.pull-requests.tsx` (sidebar
portal, panes, selection, drag, row menu), and the Pull Requests branches in
`AppSidebarLayout.tsx`, `sidebar/AppIconRail.tsx` and `sidebar/mainAppLocation.ts`.
