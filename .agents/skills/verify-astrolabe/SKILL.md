---
name: verify-astrolabe
description: Verify what Astrolabe adds on top of T3 Code (chat tabs, settings tabs, tabs and splits in the right panel, sidebar header and icon rail, Wikis, Vim mode, the which-key keyboard menu, Mercurian theme and branding) by driving the web app in T3's Browser panel. Use to prove an Astrolabe change works, and after every upstream T3 Code sync to walk each mapped feature.
---

# Verify Astrolabe

Astrolabe is T3 Code with a layer on top. Launch, pairing, fixtures and the
Browser panel work exactly as in [test-t3-app](../test-t3-app/SKILL.md); read
it first. This skill adds the map of Astrolabe's own features in
[features/](features/README.md), which upstream's skill cannot know about.

If the Browser panel tools are absent or report unavailable, report the
blocker and stop. Do not switch to another automation system.

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

## Doctor

Before driving, and whenever something looks off:

- `curl -s localhost:<webPort>/.well-known/t3/environment` answers JSON.
- After pairing, `preview_evaluate` on `document.documentElement.dataset.themeId`
  returns `"mercurian"` on a fresh profile. Anything else means you are on a
  build without the Astrolabe layer or a profile that picked another theme.
- The sidebar has `role=link[name='Go to threads']` holding `img[name='Astrolabe']`.

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
**server** project; click a sidebar row when the feature needs a real thread
(`[data-testid=sidebar-row-card] >> nth=N`, or by name `role=button[name='<title>, <project>']`,
which becomes `'<title>, <status>, <project>'` while a status shows). Then:

- Prefer `role=…[name='…']` locators from the feature files over coordinates.
  Tools take Playwright selectors: a bare CSS descendant selector
  (`[data-x] input`) is rejected; chain with `>>` or use roles.
- `preview_press` sends modifiers (`modifiers: ["Meta"]` for Cmd+K) and one key per
  call; `preview_click` sends none. Keyboard flows (Vim, the keyboard menu) are
  driven with `preview_press`.
- Opening a chat focuses its composer, so keys "to the page" type into the draft.
  Move focus first (click a sidebar heading, or `document.activeElement.blur()`).
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
