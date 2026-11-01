# Changes (pull requests and wiki change requests)

Astrolabe's section after Agents, Wikis and Projects: every pull request on the
connected git hosts, listed in its own sidebar and opened as tabs of the panes every
section shares ([panes.md](panes.md)). Astrolabe owns the section's sidebar shell
(frame, selection, drag); the panes and their tab history are the shared ones. The list logic, filters, rows, the review itself and every action are upstream
T3 Code's (`pullRequestList.logic.ts`, `PullRequestDetailPanel.tsx`), shared with the
thread's own Pull request tab. Shown only when a connected server reports
`capabilities.pullRequests` (every current server does).

## Sub-features

- **Name**: the rail item, Go to (`g p`), the narrow-window footer and the sidebar read
  **Changes** / "Changes"; the route is still `/pull-requests` and
  upstream's own strings ("Open pull requests" in the palette, "pull request" inside a
  review) are unchanged.
- **Wiki changes** (web, `components/changeRequests/WikiChangesGroup.tsx`): the wikis' change
  requests in their own group above the pull requests (`ul[aria-label='Wiki changes']`):
  "Wiki changes" with its count at the right (`Wiki changes · <wiki>` with a clear button,
  `button "Show every wiki's changes, not only <wiki>'s"`, when this section's own wiki,
  `astrolabe:change-request-wiki-scope:v1`, picks one: set by Filter by project, or copied
  once from Wikis' filter when Wikis' "Open changes · N" row is clicked), open ones as cards
  (`[data-testid=wiki-sidebar-row]`), then a folded "Merged and closed" shelf (count at the right) of slim
  rows. The section search narrows them by title. A click shows one in the focused
  pane's tab in front (`showChangeRequestTab`), Option-click a new tab, Cmd/Shift
  select, drag places them; a pull request row over a wiki change replaces it, and
  Back/Forward walk across both kinds. Hidden when a project or a single host is picked.
- **A wiki change request's pull requests** (`client-runtime/src/wikiPullRequests.ts`):
  its view lists the writing thread's pull requests (`ul[aria-label='Pull requests']`,
  state per row, **Open** shows one beside it as a tab, or as the thread's own Pull
  request surface). One merged → an info alert
  "Pull request #N merged" with **Merge docs**; all closed unmerged → **Close change
  request**. **Merge** while one is open confirms first. Nothing merges on its own; the
  pull request's own view is upstream's and shows no link back.
- **Mobile**: the tab reads "Changes"; a "Wiki changes · N" section (open rows,
  a folded "Merged and closed · N" shelf, then a "Pull requests" rule) sits above the pull
  requests (`features/wikis/WikiChangesSection.tsx`); the Wikis tab's first row "Open
  changes · N" (`button "N open changes"`) switches to it. A wiki change request's screen
  lists its thread's pull requests (`#N · State`, tap opens the review), the merge/close
  prompt, and Merge into main's dialog names an unmerged one. No kind switch on mobile.
  Walk on an iPhone with agent-device; rows are buttons named
  `<title>, change request in <wiki>`.
- **Change groups** (`components/changeRequests/groups/`, `@t3tools/shared/changeGroups`,
  server `changeGroups/ChangeGroupService.ts`, decisions in `<state>/change-groups.json`):
  `ul[aria-label="Change groups"]` heads the list (a collapsible `button "Groups N"`, the count at the right in the new design and "Groups · N" in the classic one; merged groups are hidden),
  each card `button "<title>, change group, <state>"` with a primary-colour dot, its members as
  buttons (`<member>, in <group>`) and `button "N threads in <group>"`. A group needs two
  members (or a decision); its id is the root thread. Its threads: the root, those that opened
  members, their forks and coordinator's children (even ones that opened nothing), threads on a
  member pull request's head branch (Same branch; never main/master/develop/trunk or the base),
  threads whose title or branch names its issue key (References), and threads added or accepted
  from suggestions (decisions keyed `thread:<threadId>`); a thread can be in several groups. The
  tab (`change-group:<env>:<id>`) has the shared tab header (`nav[aria-label='Change group
  breadcrumb']` reading `Changes / <title>`, the state as quiet status) whose icon buttons are
  **Ask to update the docs** / **Draft the docs**, **Ask for suggestions** (when
  agent suggestions are on; messages the root thread to use `astrolabe_change_group_suggest`),
  **Add a change request**, **Add a thread** and **Open as a tab group**; below it the counts,
  `switch "Merge with the code"`, Suggested rows (✓ / ✕, threads too), Code /
  Documentation rows and a **Threads** section (each `button "Open <title>"` with its reason and
  Working / Settled / Idle; opens its chat beside) with ✕ to take out. **Open as a tab group**
  opens the group's threads as chats after the front chat (which stays in front); when the
  front chat is in the group, the other tabs (the group's, its members') open linked to the
  group, else they stand on their own, together in one new pane beside it. **Ask to update the docs** shows on Docs behind;
  **Draft the docs** on Docs missing with drafts on. The server sweeps armed groups each minute
  and merges their open docs once all live code merged. A thread's header shows
  `button "Change group: <title>, <state>"`, which opens the group's tab beside the chat (in
  front where it is open) and stays in Agents. Tab groups
  (`panes/tabGroups.tsx`, see panes.md): in any panes, a group's run of tabs is headed by a
  marker, `button[data-tab-group]` named `<title>, tab group <n>, <state>` (`, collapsed`
  appended): a stack icon with the group's number (the same in every pane and section), in
  the primary colour as every group is. Click shows the group's tab, opening it at the head
  of the run when it is not open; right-click (plain buttons on web): Expand the group /
  Collapse the group (only the pane's front tab stays beside the marker), Merge with the code
  (Stop merging with the code once armed), Close the group's tabs.
  MCP: `astrolabe_change_groups`, `astrolabe_change_group_suggest`, `astrolabe_change_group_update`.
  Mobile: the Changes tab leads with `Groups · N` and cards
  `button "<title>, change group, <state>"` (route `ChangeGroup`: Merge with the code switch,
  members and a Threads section as buttons, "Take … out of the group"); Settings → Changes
  (`SettingsChangeRequests`) holds the Grouping switches. No tab groups or agent asks on the phone.
- **Settings › Changes** (`/settings/change-requests`,
  `settings/ChangeRequestSettings.tsx`; the palette finds it as "Grouping"): server-scoped
  switches, each `switch "<title>"`: Same thread, Same coordinator, Thread lineage,
  References, Same branch, Agent suggestions, Flag documentation that falls behind, Offer drafts for
  missing documentation, Merge new groups with the code (all on by default except Offer
  drafts). One reads `aria-checked="mixed"` when the selected environments disagree. Agent
  suggestions shows **Ask for suggestions** on a group's tab, Flag documentation lets a
  group reach Docs behind (**Ask to update the docs**), Offer drafts shows **Draft the
  docs**, and Merge new groups turns on a new group's Merge with the code. Walk:
  `preview_navigate /settings/change-requests`, read each switch's `aria-checked`, turn
  Agent suggestions off, check the group's tab loses **Ask for suggestions**, turn it back on.
- **Project filter** (`changeRequests/ChangeRequestSourceFilter.tsx` over the shared
  `projects/projectFilter.ts`, `combobox "Filter by project: <name>"` beside Sort and Filters, in
  place of upstream's provider menu): a searchable list of All, **Projects** and each
  project (A→Z, projects sharing a repository merged), **Wikis** and each wiki; with only
  projects (or only wikis) the headings drop and the first row reads All projects (or All
  wikis). Its popup's field is `Search projects` ("No matching projects."); All drops out
  while it holds a query, the headings stay searchable. The kind
  (`astrolabe:change-request-kind:v1`: repositories or wikis; choosing All removes the key)
  and this section's own wiki (`astrolabe:change-request-wiki-scope:v1`, not Wikis' filter)
  hold the choice; both are read once per page load, so a value seeded from
  `preview_evaluate` needs a reload. A project is the list's `projectId` scope; choosing All
  afterwards drops `projectId` but keeps `environmentId` in the URL. Projects (all or one)
  hides Wiki changes; Wikis (all or one) hides the pull requests, Sort and Filters, and an
  empty wiki says `No change requests in <wiki> yet` (with no wikis at all, "No wiki change
  requests yet"). With only wikis, "All wikis" is the kind All, so Sort, Filters and the
  pull requests stay. Change groups follow the filter on web: Projects keeps groups with a
  pull request, one project only its threads' groups, Wikis only wiki change-request members. The Agents filter (`projects/useThreadsFilter.ts`, `Filter threads`; see
  [sidebar-header.md](sidebar-header.md)) lists the same projects and no wikis, but picks
  several and adds status rows; this filter stays single-pick. Filters still holds Host (with several hosts) and
  upstream's Project, which mirrors the project scope (its badge counts a project picked
  here). Known gap, not intended: it never resets the kind, so after picking a project,
  Filters → Project → All projects leaves this trigger reading "Projects" and Wiki changes
  hidden; pick **All** here to reset.
  Mobile's iOS **More filters** pill (`button "More filters"`, or `Filters, N active`;
  Android's header `Filter pull requests`) → **Project** lists All, "Projects" and each
  project (sidebar order), then "Wikis" and `<wiki> · Wiki`; without wikis it is All projects
  and the projects, and with only wikis the first row still reads "All projects". The
  submenu's title follows the pick (Project, Projects, Wikis, `<wiki> · Wiki`, or the
  project). The menu scrolls, so walk it with two short `scroll down 0.3` steps. Mobile's
  change groups ignore the filter. The mobile thread list's project menu (iPhone's
  `Filter threads by project`, elsewhere the **Project** submenu of `Filter threads`) is
  upstream's: All projects and each project.
- **Sidebar** (`role=navigation[name='Changes']`): heading **Changes** and
  **Refresh pull requests**; no New or Link button. Under it `searchbox "Search pull
  requests"` (placeholder "Search pull requests, or label:bug"), then `Filter by project:
  <name>`, `Sort pull requests: <sort>` and **Filters** (a count badge per non-default
  filter; Sort and Filters are hidden while Wikis is picked). `mod+f` (find) focuses and
  selects the search, opening the sidebar, or the narrow window's sheet, first.
  - Search matches number, title, repository, branch and author, and takes GitHub-style
    qualifiers: `label:`, `-label:`, `author:`, `draft:`, `review:`, `checks:`/`status:`;
    an unknown `key:value` is read as that label. The query is the URL's `q`. No match
    shows "Nothing matches “…”" with **Clear search** and **Check again**.
  - Sort: Merge readiness (default, left out of the URL), Blocked on me, Recently
    updated, Newest/Oldest shown, Largest/Smallest shown.
  - Filters submenus: State (All/Open/Closed/Merged), Involvement (All/Reviewing/
    Authored), Author, Labels (both built from what is loaded), Draft, Review, Checks,
    Project; Server only when there are several, Host when there are several or one cannot
    be read (marked `· Unavailable`, the reason in its tooltip).
  - Groups, only with Involvement All: **Authored**, **Review requested**, **Others**
    (an `h2` with the count beside it), empty ones hidden. 99 rows per repository's page with **Load more pull
    requests**; refreshes on focus and every minute, so rows reorder while you look.
  - Rows: `[data-pull-request-key] > button`, named `#<n> <title>`: state glyph, the
    host's icon (labelled GitHub, GitLab …) when several hosts are listed, `owner/repo`,
    time; `#n` and title; author, the first label (`+N` for the rest), for a stacked one
    `button "Stack <n>, layer <i> of <size>"` whose menu lists and opens the layers, a
    **Checks: …** popover button, the review glyph and `+a −d`. No hover card. The open one
    is `aria-current="page"`.
  - Quick actions: holding Shift shows `group "Quick actions for pull request #n"` on
    each row (Close/Merge, Ready for review, Reopen, as the host allows); they are in
    the DOM but `display: none` otherwise. They write to the host.
- **Main area**: the shared panes ([panes.md](panes.md)); `routes/_chat.pull-requests.tsx`
  renders only the sidebar list (`PullRequestsPage.tsx`). The section's old arrangement
  (`t3code:right-panel-panes:v1:pull-requests`) and history
  (`astrolabe:pull-request-tab-history:v1`) join `astrolabe:workspace:v1` beside what was there
  once, then are removed. A plain click replaces the focused pane's tab in front with the pull
  request (`workspace.show`: one open in another tab comes forward there; when the tab in front
  is a chat, a linked tab, empty or has unsaved edits, a new tab opens instead). Option-click, middle-click, Alt+Enter and the row's right-click
  **Open in new tab** open a new tab. Mod-click and Shift-click select rows
  (`data-selected`) without opening; a selected row's right-click is **Open N in new
  tabs**. Rows drag onto a pane's strip or content, the selection with them
  (`placePullRequests`). Tabs are `[data-pane-tab]` labelled `#<n> <owner/repo>`, keyed
  `surface:pull-request:<env>:<project>:<host>:<repo>:<n>`; an empty tab shows the shared New
  tab launcher. The URL follows the focused pane's pull request (`repository`, `number`,
  `selectedHost`, `selectedProjectId`, `selectedEnvironmentId`), and a URL naming one opens it
  (or brings it forward) once. The lit row (`aria-current="page"`) is the focused tab's pull
  request. With servers too
  old for pull requests the sidebar reads "Pull requests unavailable". Below the md width the sidebar is a sheet, and opening a row closes it.
- **History**: each tab walks back and forward through what it showed (the shared panes'
  `astrolabe:workspace-tab-history:v1`) with `mod+[`/`mod+]` and Space `t h`/`t l`, and the
  arrows in its header. A pull request picked inside a review (stack menu, a link in its
  text) or a Changes row click replaces that review's tab, which pushes onto its history.
- **Header** (`PullRequestTabHeading.tsx`, the shared `TabHeader`, panes.md): in the shared
  panes, `nav[aria-label='Pull request breadcrumb']` reads `<owner/repo> / #<n> <title>`, the
  title truncating before the repository; then **Open** or **Draft** as quiet status, **Edit
  title** (opens the title field below), and T3 Code's actions in the same row (Merge,
  Check out, **More pull request actions**; a merged or closed one's state badge). A thread's
  pull request adds **This thread's pull requests**. Below it the author, branches and diff
  stat, then the Summary/Timeline/Code strip with no line above it; the review scrolls under a
  line, not a fade (Summary's section headings and Code's file headers are sticky). Outside
  the shared panes the panel keeps T3 Code's crumbs.
- **The review**: `nav[aria-label='Pull request tabs']` holds **Summary** (reviewers,
  labels, description, checks, comments), **Guide** (only with Settings → Source Control
  → review guides on), **Timeline** and **Code** (the diff, with scope, split/stacked,
  file tree, Viewed). Every review opens on Summary. A written guide coming on screen in
  the focused pane collapses the sidebar (wide windows only, on Changes) and maximizes the pane when
  other panes share the area (`maximizeForGuide`). Leaving the Guide gives nothing back,
  as in T3 Code; leaving Changes opens the sidebar again unless it was opened by hand
  since. **More pull request actions**: Link to thread, Refresh, Ask a question, Explain
  this PR, Fix findings in a thread, Open on GitHub, Copy link, Copy PR number. Commenting and reviewing use the floating
  **Comment on pull request** button.

## How to get to it (user POV)

The **Changes** icon in the icon rail (between Projects and Usage), the
keyboard menu's `g p`, **Open pull requests** in the Command Palette (type "pull
requests"; "change requests" finds Open wikis and Settings › Changes instead), or
a pull request link in a conversation. Each lands on the last list filters (localStorage
`t3.pullRequests.preferences`, written only when a list control changes).

## Driving it with the Browser panel

```
preview_act click     role=navigation[name='Sections'] >> role=button[name='Changes']
preview_wait_for  [data-pull-request-key] > button
preview_act click     [data-pull-request-key] > button >> nth=1    # replaces the tab in front
preview_act click     [data-pull-request-key] > button >> nth=2   button="right"
preview_act click     role=button[name='Open in new tab']          # a second tab
preview_evaluate  dispatch a click with metaKey / altKey on a row button
preview_act click     [data-pane-id][data-focused] [data-tab-history] >> role=button[name='Back']   # or mod+[
preview_evaluate  set the searchbox's value with the native setter, then dispatch input
preview_navigate  /pull-requests?involvement=authored&state=open   # Filters shows 1
```

**Proof:** tab labels per pane (`[data-pane-id]` → `[data-pane-tab]`, `aria-selected`),
the lit row (`[data-pull-request-key] > button[aria-current=page]`), the URL's `number`
and `q`, and the localStorage keys above. Nodes are not paint: in the focused pane
(`[data-pane-id][data-focused]`) take the `nav[aria-label='Pull request tabs']` with a
non-zero rect (tabs behind the front one are `display: none`) and check that
`document.elementFromPoint` at the centre of its **Summary** tab lands on that tab (the nav's
own centre can fall on the checks summary beside it); do the same at the lit row's centre.
Save a screenshot of the section.

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
  with `astrolabe_wiki_amend` only, then **Link pull request to thread** (palette) with a merged
  and an open upstream pull request URL; nothing is written to the host.
- Escape with nothing open goes back to the previous page, whichever section that was (`useEscapeToGoBack`,
  `pullRequest/PullRequestsPage.tsx`). It does not yet clear a selection here as it does in
  Wikis: a known gap, not intended; don't pass it.
  Blur, then press Escape only while a menu is open.
- Shift-click ranges follow the data's order, not the screen's, so a short range can
  select dozens of rows.
- A reload brings every tab back: a pull request's tab key names it in full
  (`pullRequestTargetOfKey`). The default profile shares this localStorage with any
  other tab on the same origin, so two walks at once overwrite each other's layout.
- The row's right-click menu renders as plain buttons, not menuitems. Filters'
  submenus open on hover and often lag in the Browser panel; read their options from
  `PullRequestListFilters.tsx` when a hover times out.
- The row's checks badge counts skipped checks as passing, so it can say "All checks
  have passed" while Summary says "22 of 31 passing".

## Owns

`components/pullRequest/PullRequestsSidebar.tsx`, `pullRequestTabs.ts`,
`pullRequestWorkspace.ts`, `components/changeRequests/` (project filter, kind, Wiki changes,
and `groups/` with the thread header's pill), `state/changeGroups.ts`,
`components/projects/` (the project filter, shared with the Agents sidebar),
`settings/ChangeRequestSettings.tsx` and `routes/settings.change-requests.tsx`, the
change-group branch of `sectionTabs/`, `packages/shared/src/changeGroups.ts`,
`packages/contracts/src/changeGroups.ts`, `client-runtime/src/wikiPullRequests.ts`, server
`changeGroups/ChangeGroupService.ts` and `mcp/toolkits/changeGroups/`, the section shell in
`pullRequest/PullRequestsPage.tsx` (sidebar portal, selection, drag, row menu, URL), its list
in `PullRequestsColumn.tsx` (`PullRequestsSidebarList`) and `PullRequestListGroups.tsx`, and
the Pull Requests branches in `AppSidebarLayout.tsx`, `sidebar/AppIconRail.tsx` and
`sidebar/mainAppLocation.ts`. Tab groups (`panes/tabGroups.tsx`) are panes.md's.
