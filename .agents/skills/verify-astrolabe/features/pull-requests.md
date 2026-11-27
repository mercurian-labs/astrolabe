# Changes (pull requests and change groups)

Astrolabe's section after Agents and Projects: every pull request on the
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
- **Docs pull requests**: there are no wiki change requests in the UI any more. A pull request
  whose head branch is `cr/<id>` was opened from a person's docs draft (project-docs.md) and is
  the docs side of a change group (`packages/shared/src/changeGroups.ts`); that branch check is
  all the group and mobile's Docs label use. The web review's **Docs** tab, second in
  `nav[aria-label='Pull request tabs']`, shows only when `useWikiOfPullRequest`
  (`wiki/wikiEnvironment.tsx`) finds the server's change-request record whose `pullRequest`
  matches, and the merge starting on Merge commit keys off the same record
  (`PullRequestDetailPanel.tsx`). So a `cr/` pull request with no record counts as docs in its
  group but has no Docs tab. The tab (`wiki/WikiPullRequestTab.tsx`) lists amendments with
  **Revert**, **Publish now** while work is unpublished, and the writing thread's
  `ul[aria-label='Pull requests']`, under which a nudge reads "Pull request #n merged" ("Merge
  these docs too, so they match the code on main.") or "Pull request #n closed without merging"
  ("Close this <noun> too?" with a button). Merging while those code pull requests are open asks
  first: "Pull request #n hasn't merged yet, so these docs would describe code that isn't on
  main. Merge them anyway?"
- **Mobile**: the tab reads "Changes": change groups above the host's pull requests. A pull request opened from a docs
  draft (its branch is `cr/<id>`) shows a `Docs` label over its merge button and starts on a
  merge commit. Walk on an iPhone with agent-device.
- **Change groups** (`components/changeRequests/groups/`, `@t3tools/shared/changeGroups`,
  server `changeGroups/ChangeGroupService.ts`, decisions in `<state>/change-groups.json`, every
  branch a thread was on in `<state>/thread-branches.json`):
  `ul[aria-label="Change groups"]` (`role=presentation`, so use this CSS form, not a role
  locator) heads the list (a collapsible `button "Groups N"`, the count at the right in the new design and "Groups · N" in the classic one; merged groups are hidden),
  each card `button "<title>, change group, <state>"` with a primary-colour dot, its members as
  buttons (`<member>, in <group>`) and `button "N threads in <group>"`. A group needs two
  members (or a decision); its id is the root thread. Its threads: the root, those that opened
  members, their forks and coordinator's children (even ones that opened nothing), threads on a
  member pull request's head branch (Same branch; never main/master/develop/trunk or the base),
  threads whose title or branch names its issue key (References), and threads added or accepted
  from suggestions (decisions keyed `thread:<threadId>`); a thread can be in several groups. The
  tab (`change-group:<env>:<id>`) has the shared tab header (`nav[aria-label='Change group
  breadcrumb']` reading `Changes / <title>`, the state as quiet status) whose icon buttons are
  exactly **Add a pull request** (a pull request glyph with a plus), **Add a thread** and
  **Open as a tab group**; below it the counts, Suggested rows
  (✓ / ✕, threads too; only agents calling `astrolabe_change_group_suggest` fill it, nothing in
  the app asks), Code / Documentation rows (each opens beside) and a **Threads** section (each
  `button "Open <title>"` with its reason and Working / Settled / Idle; `workspace.openChat`:
  comes forward if open, else fills a focused empty tab, else a new tab after the chat in front)
  with ✕ to take out. **Add a thread** (`ChangeGroupView.tsx`, its actions in
  `useChangeGroupActions.ts`; search `Search threads`, empty text "No other threads.") lists **New thread**, then the starters **Update the docs**
  (Docs behind) and **Draft the docs** (Docs missing with Offer drafts on), then the
  environment's other threads. New thread or a starter opens a draft in the root thread's
  project in a pane right of the group's (`SectionTabContent.tsx` `showBeside`; the group stays
  in front of its own pane) with the group's chip `button "Change group, <title>. Show
  details"` in its composer (a starter adds its sentence after it; nothing sends). Until its
  first send the Threads section shows it as a draft row (`button "Open draft <first line or
  New thread>"`, "Draft · joins when sent", `button "Discard draft …"` with the usual undo);
  the send adds the thread (Added by hand) and the row goes. Drafts are per device
  (`localStorage['astrolabe:change-group-drafts:v1']`, `changeGroupJoins.ts`) and survive a
  reload. New thread again while that draft still holds only what it started with brings it
  forward instead of making another. Picking an existing thread adds it at once, puts the chip
  in its draft unsent and shows it beside; its own pull requests join under Code as **From its
  thread**, and taking the thread out takes them back to its own group. **Open as a tab group**
  opens the group's threads as chats after the front chat (which stays in front); when the
  front chat is in the group, the other tabs (the group's, its members') open linked to the
  group, else they stand on their own, together in one new pane beside it. Nothing merges on
  its own: each member merges in its own place. A thread's
  way to its group is thread details (`button "Toggle thread details panel"`): under Version
  Control, a server thread in a group shows `button "Change group: <title>, <m> of <n>
  merged"` (`ThreadChangeGroupRows.tsx`), which opens the group's tab beside the chat (in
  front where it is open); the chat header has no group pill. A pull request's header shows `button "Change group: <title>"` (state in its tooltip,
  `ChangeGroupHeaderLink.tsx`) back to the group. **A thread's linked pull requests open as its
  change group**, or its one pull request when it is in no group
  (`openThreadChangeRequests.ts`): the sidebar row's pull request badge, the branch toolbar's
  list button, the palette's **Show linked pull requests** ("Opens its change group, or its
  pull request") and the automatic open after a turn. Linking moved off the retired right-panel
  list: right-click a pull request row in thread details (Open, Copy link, Watch for changes /
  Stop watching, Unlink from thread / Dismiss from thread, Link pull request;
  `ThreadDetailsPrRowMenu.tsx`), or the palette's **Manage linked pull requests...** (per pull
  request: Open, Copy link, Watch / Stop watching, Unlink / Dismiss;
  `linkedPullRequestsSubmenu.tsx`). **@ a group**: in any composer, `@` plus a group's title,
  a member's title or a pull request number lists up to three groups (the thread's own first),
  each option reading `<title> · Change group · <state>`; picking one inserts the chip and does
  **not** add the thread. The chip's popover lists the members and has **Open group**; a sent
  chip tells the agent to call `astrolabe_change_groups({groupId, memberKeys})`. Tab groups
  (`panes/tabGroups.tsx`, see panes.md): in any panes, a group's run of tabs (its chats, change
  requests, and project file, changes and graph tabs keyed by any branch its threads ever
  worked on, main/master/develop/trunk excepted; main-checkout tabs are keyed by folder and
  never join; a branch tab apart from the group's tabs gets its own marker with the same number) is headed by a marker, `button[data-tab-group]` named `<title>, tab group <n>, <state>` (`, collapsed`
  appended): a stack icon with the group's number (the same in every pane and section), in
  the primary colour as every group is. Click shows the group's tab, opening it at the head
  of the run when it is not open; right-click (plain buttons on web): Expand the group /
  Collapse the group (only the pane's front tab stays beside the marker), Close the group's
  tabs.
  MCP: `astrolabe_change_groups` (optional `groupId` and `memberKeys` read one group in full
  as `{group}`; without them it lists every group), `astrolabe_change_group_suggest`,
  `astrolabe_change_group_update`.
  Mobile: the Changes tab leads with `Groups · N` and cards
  `button "<title>, change group, <state>"` (route `ChangeGroup`: its state,
  members and a Threads section as buttons, "Take … out of the group"); Settings → Changes
  (`SettingsChangeRequests`) holds the Grouping switches. A sent message's change group chip
  (layers icon) opens the `ChangeGroup` route on tap, or a sheet reading "Not on a connected
  environment now." when the group can't be found (`ThreadFeed.tsx`,
  `ComposerContextSheet.tsx`). No tab groups or thread starters on the phone.
- **Settings › Changes** (`/settings/change-requests`,
  `components/settings/ChangeRequestSettings.tsx`; the palette finds it as "Grouping"): server-scoped
  switches, each `switch "<title>"`: Same thread, Same coordinator, Thread lineage,
  References, Same branch, Flag documentation that falls behind, Offer drafts for
  missing documentation (all on by default except Offer drafts). One reads
  `aria-checked="mixed"` when the selected environments disagree. Flag documentation lets a
  group reach Docs behind (**Update the docs** in **Add a thread**), and Offer drafts adds
  **Draft the docs** there on a Docs missing group. Walk: `preview_navigate
  /settings/change-requests`, read each switch's `aria-checked`, turn Offer drafts on, check
  a Docs missing group's **Add a thread** lists **Draft the docs** second, turn it back off.
- **Project filter** (`changeRequests/ChangeRequestSourceFilter.tsx` over the shared
  `projects/projectFilter.ts`, `combobox "Filter by project: <name>"` beside Sort and Filters, in
  place of upstream's provider menu): a searchable list of **All projects**, then each project
  (A→Z, projects sharing a repository merged). Its popup's field is `Search projects` ("No
  matching projects."); All projects drops out while it holds a query. A project is the list's
  `projectId` scope; choosing All afterwards drops `projectId` but keeps `environmentId` in the
  URL. The empty text reads "No pull requests found" while searching. Change groups follow the
  filter on web: one project keeps only its threads' groups. The Agents filter
  (`projects/useThreadsFilter.ts`, `Filter threads`; see [sidebar-header.md](sidebar-header.md))
  lists the same projects, but picks several and adds status rows; this filter stays
  single-pick. Filters still holds Host (with several hosts) and upstream's Project, which
  mirrors the project scope (its badge counts a project picked here).
  Mobile's iOS **More filters** pill (`"More filters"`, or `Filters, N active`, an `[other]`
  in the snapshot whose centre can land on the next pill, so tap it by coordinate;
  Android's header `Filter pull requests`) → **Project** lists All projects and each project
  (sidebar order); the submenu's title follows the pick. Read every row from a full `snapshot`
  (without `-i`) rather than scrolling: a `scroll` gesture over the open menu dismisses it and
  can pick the row under it. Mobile's change groups ignore the filter. The mobile thread
  list's project menu (iPhone's `Filter threads by project`, elsewhere the **Project** submenu
  of `Filter threads`) is upstream's: All projects and each project.
- **Sidebar** (`role=navigation[name='Changes']`): heading **Changes** and
  **Refresh pull requests**; no New or Link button. Under it `searchbox "Search pull
  requests"` (placeholder "Search pull requests, or label:bug"), then `Filter by project:
  <name>`, `Sort pull requests: <sort>` and **Filters** (a count badge per non-default
  filter). `mod+f` (find) focuses and
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
  request (`workspace.show`: one open in another tab comes forward there; an empty tab in front
  is filled (`arrangement.ts` `openTab`); when the tab in front is a chat, a linked tab or has
  unsaved edits, a new tab opens instead). Option-click, middle-click, Alt+Enter and the row's right-click
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
  A link that names a place (`#issuecomment-…`, `/files#diff-…`, `/commits/<sha>`) opens
  that review on the tab holding it (Timeline or Code) scrolled to it, the item marked
  `[data-pr-link-target]` (`usePullRequestTabReveals` in `pullRequestWorkspace.ts`). Seeded
  data had one: #37824's Summary links `…/pull/34860#issuecomment-6817985936`.
- **Header** (`PullRequestTabHeading.tsx`, the shared `TabHeader`, panes.md): in the shared
  panes, `nav[aria-label='Pull request breadcrumb']` reads `<owner/repo> / #<n> <title>`, the
  title truncating before the repository; then `button "Change group: <title>"` when the pull
  request is in a group (opens the group's tab); then **Open** or **Draft** as quiet status, **Edit
  title** only when the pull request can be edited (opens the title field below), and T3 Code's actions in the same row (Merge,
  Check out, **More pull request actions**; a merged or closed one's state badge). A thread's
  pull request in a group adds **This thread's change group** (opens the group). Below it the author, branches and diff
  stat, then the Summary/Timeline/Code strip with no line above it; the review scrolls under a
  line, not a fade (Summary's section headings and Code's file headers are sticky). Outside
  the shared panes the panel keeps T3 Code's crumbs.
- **The review**: `nav[aria-label='Pull request tabs']` holds **Summary** (reviewers,
  labels, description, checks, comments), **Docs** (second, only on a docs pull request the
  server has a change-request record for, above; `PullRequestDetailPanel.tsx`), **Guide** (only with Settings → Source Control
  → review guides on), **Timeline** and **Code** (the diff, with scope, split/stacked,
  file tree, Viewed). Every review opens on Summary. A written guide coming on screen in
  the focused pane collapses the sidebar (wide windows only, on Changes) and maximizes the pane when
  other panes share the area (`maximizeForGuide`). Leaving the Guide gives nothing back,
  as in T3 Code; leaving Changes opens the sidebar again unless it was opened by hand
  since. **More pull request actions**: Link to thread, Refresh, Ask a question, Explain
  this PR, Fix findings in a thread, Open on GitHub, Copy link, Copy PR number. Commenting and reviewing use the floating
  **Comment on pull request** button. Both names follow the host's term (`More <term> actions`,
  `Comment on <term>`: "merge request" on GitLab; `PullRequestActionsMenu.tsx`,
  `PullRequestComposer.tsx`).

## How to get to it (user POV)

The **Changes** icon in the icon rail (after Projects, before **Issues** when the host
supports them and **Workflows** when reachable; Usage sits in the rail's foot), the
keyboard menu's `g p`, **Open pull requests** in the Command Palette (type "pull
requests", which also finds Settings › Changes), or
a pull request link in a conversation. Each lands on the last list filters (localStorage
`t3.pullRequests.preferences`, written only when a list control changes).

## Driving it with the Browser panel

```
preview_act click     role=navigation[name='Sections'] >> role=button[name='Changes']
preview_wait_for  [data-pull-request-key] > button
preview_act click     role=navigation[name='Changes'] >> role=button[name=/^#\d+ /] >> nth=1    # rows are "#<n> <title>"; replaces the tab in front
preview_act click     role=navigation[name='Changes'] >> role=button[name=/^#\d+ /] >> nth=2   button="right"
preview_act click     role=button[name='Open in new tab']          # a second tab; may time out, then click its measured x,y
preview_evaluate  dispatch a click with metaKey / altKey on a row button
preview_act click     [data-focused="true"] >> role=button[name='Back']   # the focused pane's; or mod+[
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
- The URL keeps the last pull request while another kind of tab
  is focused (it follows only pull requests).
- A real link test needs a thread with linked pull requests: start a Claude thread in a
  scratch project, then **Link pull request to thread** (palette) with a merged and an open
  upstream pull request URL; nothing is written to the host. A docs member is a pull request
  from a draft's `cr/` branch, which only a draft's **Open pull request** makes: do that on a
  throwaway repository only.
- Escape with nothing open goes back to the previous page, whichever section that was (`useEscapeToGoBack`,
  `pullRequest/PullRequestsPage.tsx`). It does not yet clear a selection here: a known gap,
  not intended; don't pass it.
  Blur, then press Escape only while a menu is open.
- Shift-click ranges follow the data's order, not the screen's, so a short range can
  select dozens of rows.
- A reload brings every tab back: a pull request's tab key names it in full
  (`pullRequestTargetOfKey`). The default profile shares this localStorage with any
  other tab on the same origin, so two walks at once overwrite each other's layout.
- The row's right-click menu renders as plain buttons, not menuitems, and a role locator on
  **Open in new tab** may time out: click it by its measured centre. Filters'
  submenus open on hover and often lag in the Browser panel; read their options from
  `PullRequestListFilters.tsx` when a hover times out.
- The row's checks badge counts skipped checks as passing, so it can say "All checks
  have passed" while Summary says "22 of 31 passing".
- A thread started from a group and sent with only the chip takes the group's title, so seeded
  data can hold several threads named like the group. **This thread's change group** belongs
  to the thread that opened the change, so open the root from
  the group's Threads row ("Opened a pull request"), not a same-named sidebar row. A settled
  root isn't under Active in the sidebar; merged groups are hidden from the Changes list, so
  reach one through a member thread's thread details row.
- A group's tab needs an unmerged group in the seeded data (two members, or a decision); a seed
  with none can't reach it, so check `Groups N` before planning a group walk.
- Thread starters and draft rows write nothing until a send: discard each draft from its row
  (and turn Offer drafts back off) before ending a walk.

## Owns

`components/pullRequest/PullRequestsSidebar.tsx`, `pullRequestTabs.ts`,
`pullRequestWorkspace.ts`, `components/changeRequests/` (project filter
and `groups/`: the group's tab, the header link, thread details' group row, drafts that join on
send), `state/changeGroups.ts`, `client-runtime/src/changeGroups.ts` (opening a thread's group,
the @ items), `chat/ChangeGroupContextChip.tsx`, `chat/ThreadDetailsPrRowMenu.tsx`,
`pullRequest/linkedPullRequestsSubmenu.tsx`, the change-group kind in
`shared/src/composerContextReferences.ts` and `contracts/src/composerContext.ts`, mobile
`state/changeGroups.ts` and the change-group chip in `features/threads/ThreadFeed.tsx`,
`components/projects/` (the project filter, shared with the Agents sidebar),
`components/settings/ChangeRequestSettings.tsx` and `routes/_chat.settings.change-requests.tsx`,
`pullRequest/PullRequestTabHeading.tsx` (the header), the
change-group branch of `sectionTabs/`, `packages/shared/src/changeGroups.ts`,
`packages/contracts/src/changeGroups.ts`, the Docs tab in `components/wiki/WikiPullRequestTab.tsx`
and `useWikiOfPullRequest` in `wiki/wikiEnvironment.tsx`, `client-runtime/src/wikiPullRequests.ts`
(read only by `WikiPullRequestTab.tsx`), server
`changeGroups/ChangeGroupService.ts` and `mcp/toolkits/changeGroups/`, the section shell in
`pullRequest/PullRequestsPage.tsx` (sidebar portal, selection, drag, row menu, URL), its list
in `PullRequestsColumn.tsx` (`PullRequestsSidebarList`) and `PullRequestListGroups.tsx`, and
the Pull Requests branches in `AppSidebarLayout.tsx`, `sidebar/AppIconRail.tsx` and
`sidebar/mainAppLocation.ts`. Tab groups (`panes/tabGroups.tsx`) are panes.md's.
