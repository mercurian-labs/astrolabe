# Account menu

Where cloud sign-in is configured, the Settings button is also the Astrolabe
account menu: a gear until you sign in, your avatar after. It holds the way in
(Sign in), the way out (Sign out), and shortcuts to Account, Workspaces and
Settings. Builds without sign-in keep a plain Settings button.

## States

- **No cloud config**: a plain Settings button (no `aria-haspopup`) that opens
  `dialog "Settings"` at `/settings/general`. No menu, no account dialogs, no
  Workspaces in the Settings nav, and `/settings/workspaces` redirects to
  `/settings/general` (LIVE). This also covers values the client rejects. The auth
  URL must be `https`, or `http` on a local hostname, with no path, query or hash
  (`packages/shared/src/mercurianAccount.ts:72-82`). The relay URL must be `https`
  with no username, password, path, query or hash (`packages/shared/src/relayUrl.ts:1-18`).
  `cloud/publicConfig.ts:81-84` only requires both. Vite reads them at startup, so a
  `.env` change needs a dev restart.
- **Config set, cloud down**: with no stored token it shows Signed out at once, but **Sign in**
  then fails silently (only `console.error("Sign-in failed")`, no dialog). With a stored token it
  stays on Loading and retries every 15 s, and re-reads the session on window focus
  (`cloud/managedAuth.tsx:72-80`). The token lives in localStorage
  `astrolabe:cloud-session-token`; removing it and reloading resets the web state.
- **Loading** (session not known yet): the gear with only **Settings**.
- **Signed out**: a gear named "Settings". Menu: **Sign in**, **Settings**.
  Sign in opens "Sign in to Astrolabe" with a device code
  (`[aria-label="Sign-in code"]`), **Open sign-in page** and **Cancel** (Cancel, or closing it,
  returns to signed out); the hosted static app redirects to the sign-in page instead
  (`cloud/account.ts`).
- **Signed in**: initials (or the photo), and the trigger is named after the
  user's name, else email. Menu: a header with name and email, **Account**,
  **Workspaces**, **Settings**, then **Sign out**. Signing in on web opens a "Set up remote
  access" dialog (`components/cloud/ConnectOnboardingDialog.tsx`), which stays until Escape.
- **Waitlisted or declined**: the email line reads "On the waitlist".
- **Settings shortcut**: ⌘, (Ctrl+, off macOS) only in the desktop app. The
  browser keeps that key, so the Browser panel never shows it.
- **Reverse**: Sign out returns the trigger to the gear and the menu to Sign in.

Account opens the account dialog (`nav[aria-label="Account"]` with Account,
Mobile clients and Remote access). Its Account page is a second way out: **Manage sign-in
methods**, **Sign out** and **Delete account** (or **Leave the waitlist**).

## How to get to it (user POV)

Web: the foot of the icon rail; on narrow windows the first item of the sidebar footer (only
legacy `/projects/…` pages add **Back** beside it). Mobile has no account menu; see Mobile
below.

## Driving it with the Browser panel

With cloud config only (without it the rail's Settings is a plain button with no
`aria-haspopup`, and the query below returns null). The walk that proved it set
`T3CODE_AUTH_URL=<local API>` and `T3CODE_RELAY_URL=https://relay.invalid` in `.env`
(LIVE). Locator clicks on the rail can time out at the scroll step; click the
trigger from `preview_evaluate` instead:

```
preview_evaluate  document.querySelector('nav[aria-label="Sections"] button[aria-haspopup="menu"]').click()
preview_act click     role=menuitem[name='Sign in']        # signed out: menu is Sign in, Settings
preview_evaluate  document.querySelector('[aria-label="Sign-in code"]')?.textContent
# approve it: scripts/cloud-kit.sh approve <code> <email>   (see SKILL.md, Cloud)
# "Set up remote access" opens on its own: press Escape before reopening the menu
preview_act click     role=menuitem[name='Account']        # signed in: account dialog
preview_act click     role=menuitem[name='Workspaces']     # → /settings/workspaces
preview_act click     role=menuitem[name='Sign out']
```

The trigger is the only rail button with `aria-haspopup="menu"`. On a narrow
window, open the sidebar with `role=button[name='Toggle main sidebar']` first;
the trigger is in `[data-sidebar=footer]`.

## End state that proves it

- Signed out: the trigger is named "Settings" and the menu holds exactly Sign in
  and Settings. Sign in shows "Sign in to Astrolabe" with the code, **Cancel** and
  **Open sign-in page** (LIVE).
- After approval, the trigger's `aria-label` is the user's name or email ("walker"
  for `walker@walk.test`), the "Set up remote access" wizard opens, and the menu
  shows a header (initial, name, email) then Account, Workspaces, Settings and
  Sign out (LIVE).
- Signing out on Settings › Workspaces brings the gear back and leaves no
  `[Live Query Error]` in the console (hook `console.error` from
  `preview_evaluate` before signing out).

## Mobile

Walk with `test-t3-mobile`. The phone has no account menu (the v0.1.3 sync
removed it): the Android header's gear and the Settings tab lead to Settings,
whose **Account** row opens the Account screen (`SettingsAuthRouteScreen.tsx`,
`settings/auth`). The Account row and screen exist only with cloud config (from
`app.config.ts`). Signed out it offers **Sign in** and then shows the code
(`Sign-in code`) under "Approve this code"; approve with
`scripts/cloud-kit.sh approve-latest astrolabe-mobile <email>`. Signed in it shows a section
named after the user with **Remote access** and **Manage sign-in methods** (the email is that
row's value), then **Sign out** and **Delete account** (or **Leave the waitlist**), and
Settings gains a **Workspaces** row. After signing in, a "Set up remote access" sheet can
appear; close it.

## Owns

`apps/web/src/components/sidebar/AccountMenu.tsx`, its mounts in
`AppIconRail.tsx` and `SidebarChrome.tsx`,
`apps/web/src/components/clerk/CloudAccountDialogs.tsx`, `T3ConnectAccountPages.tsx`,
`components/cloud/ConnectOnboardingDialog.tsx`, `apps/web/src/cloud/account.ts` and
`managedAuth.tsx`, the URL rules in `packages/shared/src/mercurianAccount.ts` and
`relayUrl.ts`, and on mobile `apps/mobile/src/features/settings/SettingsAuthRouteScreen.tsx`.
No tests cover the menu itself yet.
