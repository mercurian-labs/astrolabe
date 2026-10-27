# Account menu

Where cloud sign-in is configured, the Settings button is also the Astrolabe
account menu: a gear until you sign in, your avatar after. It holds the way in
(Sign in), the way out (Sign out), and shortcuts to Account, Workspaces and
Settings. Builds without sign-in keep a plain Settings button.

## States

- **No cloud config** (`T3CODE_AUTH_URL` or `T3CODE_RELAY_URL` unset): a plain
  Settings button that goes to `/settings`. No menu, no account dialogs.
- **Loading** (session not known yet): web shows the gear with only
  **Settings**; mobile shows the plain Settings button.
- **Signed out**: a gear named "Settings". Menu: **Sign in**, **Settings**.
  Sign in opens "Sign in to Astrolabe" with a device code
  (`[aria-label="Sign-in code"]`).
- **Signed in**: web shows initials (or the photo) and the trigger is named
  after the user's name, else email; mobile shows a person icon. Menu: a header
  with name and email (web), **Account**, **Workspaces**, **Settings**, then
  **Sign out**.
- **Waitlisted or declined**: the email line reads "On the waitlist".
- **Settings shortcut**: ⌘, (Ctrl+, off macOS) only in the desktop app. The
  browser keeps that key, so the Browser panel never shows it.
- **Reverse**: Sign out returns the trigger to the gear and the menu to Sign in.

Account opens the account dialog on web (`nav[aria-label="Account"]` with
Account, Mobile clients and Remote access) and the Account screen on mobile.

## How to get to it (user POV)

Web: the foot of the icon rail; on narrow windows the sidebar footer, where
Settings-type pages show **Back** beside it. Mobile: the right of each header
(iOS toolbar and sidebar headers, Android headers).

## Driving it with the Browser panel

Locator clicks on the rail can time out at the scroll step; click the trigger
from `preview_evaluate` instead:

```
preview_evaluate  document.querySelector('nav[aria-label="Sections"] button[aria-haspopup="menu"]').click()
preview_act click     role=menuitem[name='Sign in']        # signed out
preview_evaluate  document.querySelector('[aria-label="Sign-in code"]')?.textContent
# approve it: scripts/cloud-kit.sh approve <code> <email>   (see SKILL.md, Cloud)
preview_act click     role=menuitem[name='Account']        # signed in: account dialog
preview_act click     role=menuitem[name='Workspaces']     # → /settings/workspaces
preview_act click     role=menuitem[name='Sign out']
```

The trigger is the only rail button with `aria-haspopup="menu"`. On a narrow
window, open the sidebar with `role=button[name='Toggle main sidebar']` first;
the trigger is in `[data-sidebar=footer]`.

## End state that proves it

- Signed out: the trigger is named "Settings" and the menu holds Sign in and
  Settings.
- After approval, the trigger's `aria-label` is the user's name or email, and
  the menu holds Account, Workspaces, Settings and Sign out.
- Signing out on Settings › Workspaces brings the gear back and leaves no
  `[Live Query Error]` in the console (hook `console.error` from
  `preview_evaluate` before signing out).

## Mobile

Walk with `test-t3-mobile`. Tap the header's right button: a native menu with
the same rows. Sign in opens Account plus the browser sheet; approve with
`scripts/cloud-kit.sh approve-latest astrolabe-mobile <email>`. After signing
in, a "Set up remote access" sheet can appear; close it.

## Owns

`apps/web/src/components/sidebar/AccountMenu.tsx`, its mounts in
`AppIconRail.tsx` and `SidebarChrome.tsx`,
`apps/web/src/components/clerk/CloudAccountDialogs.tsx`,
`apps/mobile/src/features/cloud/accountMenu.tsx` and the headers that render it.
No tests cover the menu itself yet; `useAccountMenu` (mobile) is the cheapest
first one.
