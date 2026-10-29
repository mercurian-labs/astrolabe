---
name: verify-astrolabe
description: Verify what Astrolabe adds on top of T3 Code (chat tabs, tabs and splits in the right panel, sidebar header and icon rail, the account menu, workspaces, Wikis, Repositories, Changes, Vim mode, the which-key keyboard menu, keyboard navigation, Mercurian theme, branding and visible names) by running the checks that cover it and driving the web app in T3's Browser panel (the phone app through test-t3-mobile, plus the iOS simulator for cloud features). Use to prove an Astrolabe change works, and after every upstream T3 Code sync to walk each mapped feature.
---

# Verify Astrolabe

Astrolabe is T3 Code with a layer on top. Launch, pairing, fixtures and the
Browser panel work exactly as in [test-t3-app](../test-t3-app/SKILL.md); read
it first. This skill adds the map of Astrolabe's own features in
[features/](features/README.md), which upstream's skill cannot know about.

A feature file's **Mobile** entries walk the phone app through
[test-t3-mobile](../test-t3-mobile/SKILL.md) (its Device panel and AgentDevice);
everything else walks in the Browser panel. If the tools a walk needs are absent
or report unavailable, report the blocker and stop that walk. Do not switch to
another automation system.

## Launch

Reuse this task's healthy dev server. Otherwise, from the repository root:

```bash
run="$TMPDIR/verify-astrolabe/<id>"
.agents/skills/verify-astrolabe/scripts/start-dev.sh "$run"
```

It starts `vp run dev` on a clean home in `$run/home`, records the PID in
`$run/pid`, and returns once the server prints its pairing URL. It also prints
the `[dev-runner] … serverPort=… webPort=…` line and writes the URL to
`$run/pairing-url`. The log is `$run/dev.log`. To test against the worktree's
own `.t3` (for example seeded data), run it in the background yourself and
track its PID:

```bash
nohup vp run dev --home-dir "$PWD/.t3" >"$run/dev.log" 2>&1 & echo $! >"$run/pid"
```

Then wait for `pairingUrl:` in the log, as `start-dev.sh` does, and stop it with
`stop-dev.sh "$run"`. Never point it at `~/.t3/userdata`, and never set
`VITE_HTTP_URL` or `VITE_WS_URL`.

A clean home is not empty: the server adds the directory it runs in
(`apps/server`, shown as the **server** project) and opens a draft thread.
Chat tabs need at least two threads; seed them with `vp run migrate-dev-db`
(server stopped) into the worktree's `.t3`, as AGENTS.md describes.

## Checks before driving

A walk proves what a person sees; it doesn't replace the checks underneath.
For the features a change touches, run these first, scoped to those files
(never the repo-wide suite):

- **The feature's tests.** Each feature file names them; `vp test run <files>`
  from the owning package, plus `vp exec tsc --noEmit -p .` there.
- **The cloud stack.** For a change to `apps/cloud`, `infra/cloud` or the
  workspace client, run `vp run test:integration` in `infra/cloud`: it
  deploys the real stack into a throwaway local stage, checks sign-in, who can
  see which workspace, and live requests, then removes the stage.
- **Visible names.** After an upstream sync or any change to product text, run
  the `git grep` under "After each sync" in
  [docs/operations/astrolabe-identity.md](../../../docs/operations/astrolabe-identity.md)
  and judge each hit against its rules.
- **Code shared across runtimes.** `packages/client-runtime` and
  `packages/shared` run in the browser, the desktop's Electron, Node (the
  server and the tests) and the phone's JavaScript engine, and each lacks
  things the others have. Tests run only on Node, so a change there that
  mobile imports gets one device walk (a write and a live update on the
  simulator via `test-t3-mobile`), and a change to mobile's dependencies needs
  Metro to start cleanly, which is also where licence and bundling problems
  surface.

Then walk the features. The walk is where the joins between pieces (server
timeouts, auth sessions, sync lifecycles, native navigation) fail, which unit
tests mock away.

## Cloud

Account, workspace and remote-access features need the local cloud stack:
`vp run dev` in `infra/cloud` (Postgres, Electric, the API and SES under
Alchemy's local AWS emulator; see its README), with the worktree's gitignored
`.env` holding `T3CODE_AUTH_URL=<the API URL it prints>` and
`T3CODE_RELAY_URL=https://relay.invalid` (or a real local relay). Restart the dev
server after changing `.env`.

[`scripts/cloud-kit.sh`](scripts/cloud-kit.sh) replaces hand-written SQL and
curl during walks. Set `CLOUD_API_URL` (and `CLOUD_POSTGRES_PORT` when the stack
isn't on 54341), then:

```bash
k=.agents/skills/verify-astrolabe/scripts/cloud-kit.sh
$k person ben@walk.test "Ben"                 # approved account; prints a bearer token
$k approve <user-code> venkat@walk.test       # approve the code a client is showing
$k approve-latest astrolabe-mobile venkat@walk.test
$k mail ben@walk.test                         # invitations and sign-in codes sent
$k invitations ben@walk.test                  # pending invitation ids for ben
$k write ben@walk.test acceptInvitation '{"invitationId":"<id>"}'   # ben acts while you watch
```

Doctor the stack before driving: `curl -s $CLOUD_API_URL/health` answers, and
`$k person doctor@walk.test` prints a token.

## Doctor

Before driving, and whenever something looks off:

- `curl -s localhost:<webPort>/.well-known/t3/environment` answers JSON.
- After pairing, `preview_evaluate` on `document.documentElement.dataset.themeId`
  returns `"mercurian"` on a fresh profile. Anything else means you are on a
  build without the Astrolabe layer or a profile that picked another theme.
- The icon rail is headed by the monogram tile, `[data-app-rail-mark]`, its first item above Agents; the sidebar toggle (`[data-app-rail-toggle]`) sits in the corner above the rail (after the window buttons in the macOS desktop app).

## Desktop (Electron) checks

The Browser panel drives the web build. For something only the macOS desktop app shows (the
window's own buttons, the rail's mark moving below them), run the desktop client against a
copy of the walk's home, so two servers never share one database:

```
H="$run/desktop-home"; mkdir -p "$H/userdata"
sqlite3 "$run/home/userdata/statev2.sqlite" ".backup '$H/userdata/statev2.sqlite'"
T3CODE_DESKTOP_REMOTE_DEBUGGING_PORT=9333 nohup vp run dev:desktop --home-dir "$H" >"$run/desktop.log" 2>&1 &
echo $! >"$run/desktop.pid"
```

Wait for `main window created` in the log; if the page reads "Astrolabe could not load",
reload it once the renderer's Vite is up. Read and screenshot the page over the DevTools
protocol (`curl 127.0.0.1:9333/json/list`, then `Runtime.evaluate` and
`Page.captureScreenshot` on the `astrolabe-dev://app/` page); `screencapture` and System
Events usually lack permission here. The window's own buttons are native, so they are not
in that screenshot. Stop it by `$run/desktop.pid`.

## Drive

Open the full URL from `$run/pairing-url` once with `preview_open` and
`profileId: "incognito"`. The token is single-use. Once it is consumed, mint
another with `node apps/server/src/bin.ts pair --base-dir "$run/home"`. Pairing
in incognito means your run neither reads nor leaves the user's default-profile
state, and the incognito session does not outlive the browser: a later run lands
on `/pair` again. On a tab already at `/pair`, navigating to `…/pair#token=…`
only changes the hash and pairs nothing; type the token into
`role=textbox[name='Pairing token']` and click **Continue** instead. The app boots behind a "Loading Astrolabe" status, so `preview_wait_for`
`role=tablist[name='Open chats']` before acting. It lands on a draft in the
**server** project; click a sidebar row (`role=button[name=/^<title>, /]`; the name is
`<title>, [<status>, ]<project>`, or `[data-testid=sidebar-row-card] >> nth=N`)
when the feature needs a real thread. Then:

- Prefer `role=…[name='…']` locators from the feature files over coordinates.
  Tools take Playwright selectors: a bare CSS descendant selector
  (`[data-x] input`) is rejected; chain with `>>` or use roles.
- Page input is one tool, `preview_act`, with an `action` (`click`, `type`, `press`,
  `hover`, `select`, `drag`, `upload`, `scroll`). The feature files write
  `preview_act click` for `preview_act` with `action: "click"`.
- `preview_act press` sends modifiers (`modifiers: ["Meta"]` for Cmd+K) and one key per
  call; `preview_act click` sends none, but takes `button: "middle"` or `"right"`.
  Keyboard flows (Vim, the keyboard menu) are driven with `preview_act press`.
- Opening a chat focuses its composer, so keys "to the page" type into the draft.
  Clicking a heading or `document.activeElement.blur()` is not enough: focus lands on
  the page and type-to-focus sends the next printable key (Space too) into the composer.
  Open the keyboard menu with Cmd+K, which works from the composer, or move focus to a
  row first with Cmd+K `h`. `preview_act press` names the space bar `Space` (a literal
  space is rejected).
- Read `aria-disabled` / `disabled` before clicking a menu item or button you expect to be
  enabled (Split right on a lone tab, Back with no history). A click on a disabled control
  waits out its whole timeout and the next call can find the automation host
  reconnecting; `preview_status` then a `requestAnimationFrame` probe confirms the tab
  survived. Where a popup covers a copy of the same control (an empty state's **Add a
  folder**), scope the locator to `role=dialog`.
- `preview_snapshot` returns a very large tree. Use `preview_wait_for` to
  settle and `preview_evaluate` for targeted reads (tab lists, localStorage),
  and take a snapshot only to look or to save evidence. If a snapshot times out,
  the tab it ran in can stay frozen: don't retry it there. Probe the tab with
  `preview_evaluate new Promise(r => requestAnimationFrame(() => r(1)))`, and if
  that times out too, close the tab and open a fresh one. Check a snapshot on a
  second page before blaming the page under test: a stuck snapshot can be the
  browser panel's, not the app's.
- Right-panel arrangements live in localStorage under
  `t3code:right-panel-panes:v1:<environmentId>:<threadId>`. Reading that key proves a
  layout change without a screenshot, and surviving `location.reload()` proves
  persistence.

## Evidence

Exercise the user's path (menus, tabs, drags), never internal setters. For
each claim, capture the action and the resulting state: a targeted
`preview_evaluate` read plus `preview_snapshot` with `save: true`. Saved PNGs
land in the host's `browser-artifacts` directory and outlive the run. Name
their paths in your reply. Use `preview_recording_start`/`_stop` for motion.

A node in the accessibility tree or the DOM is not proof that it paints. Prove
rendering with `document.elementFromPoint` at the element's centre (for a
shadow-DOM widget such as @pierre/trees,
`document.querySelector('file-tree-container').shadowRoot.elementFromPoint`) or
a screenshot: the Repositories Tree once had rows in the accessibility tree that
painted nothing, and a DOM-only walk passed it.

## Cleanup

Keep the server and tab while the user inspects or iterates. When done, close
your tab with `t3_preview_close`. If you started the server, also run:

```bash
.agents/skills/verify-astrolabe/scripts/stop-dev.sh "$run" && rm -rf "$run"
```

`stop-dev.sh` stops the recorded PID and all of its descendants. Stopping only
the runner leaves Vite and the server holding their ports. Never stop anything
by name. Saved screenshots are not in `$run`, so removing it keeps the evidence.

## After an upstream sync

Walk every file in [features/](features/README.md). Each one lists the source
files it owns. When the sync touched one of them, walk that feature first. When
a locator or step no longer matches, fix the feature file in the same
change. A map that drifts from the app teaches the next agent wrong steps. Add
a file when Astrolabe gains a feature, and remove one when a feature returns
to upstream.
