# Workspaces

Settings › Workspaces shows the workspaces you belong to, synced live from the
cloud: their name, address and two policies; people with roles and pending
invitations; teams to join, leave, create and manage (rename, owners, delete);
handing over, leaving and deleting. Invitations addressed to you appear above
them. `/w/<short name>` opens a workspace there.

## How to get to it (user POV)

**Settings → Workspaces**, the account menu's **Workspaces** row (see
[account-menu.md](account-menu.md)), or a `/w/<short name>` link, which
redirects to `/settings/workspaces?w=<short name>`. It needs an Astrolabe
account; signed out it offers **Sign in**. A build without cloud addresses hides
it: the settings nav and search leave Workspaces out, and `/settings/workspaces` (and so
`/w/<short name>`) redirects to `/settings/general`.

## Setup

It needs a cloud: run the stack with `vp run dev` in `infra/cloud` (it builds
`@mercurian/auth` first; plain `alchemy dev --stage <name>` skips that), with its own
`CLOUD_POSTGRES_PORT`, and give the worktree a `.env` with
`T3CODE_AUTH_URL=<the API URL it prints>` and a relay URL. Cloud features turn on only when
**both** are set; without them the route redirects to `/settings/general` (see above).
`T3CODE_RELAY_URL=https://relay.invalid` is enough when relay features aren't under test.
Restart the dev server after changing `.env`. Worktree setup links `.env` to the main
checkout's, so replace the link with a real file before adding lines, or you write into the
main checkout.

Signed out with cloud config, the page reads "Sign in to work with your team" with a
**Sign in** button.

Sign in from the page or the account menu, then approve the code with
`scripts/cloud-kit.sh approve <code> <email>` (see SKILL.md, Cloud). The kit
creates the account approved off the waitlist. Approving through the browser
pages works too (`<API>/device?user_code=<code>`, codes from
`cloud-kit.sh mail`), but the emulator's load balancer drops all but the last
`Set-Cookie`, so that sign-in often bounces. Act as a second person with
`cloud-kit.sh person <email>`, whose bearer token drives the write API or
`createWorkspaceSync` from a Node script, so changes arrive while you watch.

## Driving it with the Browser panel

```
preview_act click  role=dialog[name="Settings"] >> role=button[name="New workspace"]
preview_act type   role=dialog[name="New workspace"] >> role=textbox[name="Name"]   text=Acme
preview_act click  role=dialog[name="New workspace"] >> role=button[name="Create workspace"]
preview_wait_for  text="Who can create teams"
preview_act click  #workspace-people >> role=button[name="Invite"]
preview_act type   role=dialog[name="Invite to Acme"] >> role=textbox[name="Email"]  text=ben@example.test
preview_act click  role=dialog[name="Invite to Acme"] >> role=button[name="Send invitation"]
# after the second person accepts (a pending invitation only offers Revoke):
preview_act click  #workspace-people >> role=combobox[name="Role"]   then role=option[name="Admin"]
preview_act click  #workspace-teams >> role=button[name="Manage"] >> nth=0   # rename, owners, "Delete team…"
preview_act click  #workspace-leave >> role=button[name="Hand over…"]        # needs a second person
preview_act click  #workspace-leave >> role=button[name="Delete…"]
```

Settings is a modal (`role=dialog[name="Settings"]`), so nothing here is under `main`, and
the workspace dialogs open beside it: scope to their own names. **New workspace** shows only
for an approved account that owns no workspace yet; the cloud enforces the same rule. Rerun
with a fresh `cloud-kit.sh person` or delete the workspace first. A new workspace starts with
a team of the same name, invite policy "Owner and admins" and team policy "Everyone"
(`#workspace-invite-policy`, `#workspace-team-policy`, each combobox named by its row title).
The **Workspace** picker shows only when you are in more than one. A person's remove button
is `Remove <name> from the workspace`. Five seats count pending invitations; past that the
cloud refuses (`ORGANIZATION_FULL`). Invitations for you show only for a verified email.

Sections have ids: `#workspace`, `#workspace-people`, `#workspace-teams`,
`#workspace-leave`, `#workspace-invitations-for-you`. Read state with
`preview_evaluate` on their `innerText` and confirm writes in the stack's
Postgres (`auth.organization`, `auth.member`, `auth.invitation`, `auth.team`,
`auth.team_member`, `auth.team_owner`).

## End state that proves it

- A change made by the second person (accepting, creating a team) appears
  without a reload.
- Renames, role and policy changes show at once and match the database.
- Deleting asks for the name to be typed; the button stays disabled until it
  matches.
- Leaving the page for longer than the collections' idle time (5 s) and coming
  back loads the page, not a spinner. Go to another settings page, wait about
  8 s, come back.
- Signing out while the page is open shows the signed-out state with no
  `[Live Query Error]` in the console.

## Traps

- Seven shapes hold long-polls; over the emulator's HTTP/1.1 a write can wait
  a few seconds for a free connection, so read the database after the UI
  settles.
- Closing every tab of the incognito profile drops its pairing and cloud
  session; mint a new pairing token and type it into `/pair`.
- The workspace name saves on blur (Enter blurs it); a team's name saves through its
  **Rename** button. `preview_act press Enter` may not reach a focused input; dispatch the
  key from `preview_evaluate`
  (`el.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}))`)
  or click elsewhere, then confirm in Postgres.
- `preview_act type` has left stray text in a field; read the input's value back
  before submitting a dialog.
- Signing out on the emulator can take around ten seconds while the sign-out
  request waits behind the live polls; wait for the gear before judging.

## Mobile

The same screens live under Settings → Workspaces in the app (row shown once
signed in). Walk them with `test-t3-mobile`: sign in from Settings → Account (the phone has
no account menu) or the Workspaces screen's own row, read the
pending code from `auth.device_code` (`client_id='astrolabe-mobile'`) and
approve it with `cloud-kit.sh approve-latest astrolabe-mobile <email>`. Each
view is its own stack entry: on iOS the native back button is labelled with the
previous view's title, on Android it reads "Navigate up". Shared client code
runs on the phone's JavaScript engine, not Node, so exercise an optimistic
write (a rename) and a live arrival on the device, then check the phone's
`astrolabe-workspaces-<user id>.db` appears after opening Workspaces and
disappears on sign-out.

## Owns

`apps/web/src/components/workspaces/`, `apps/web/src/cloud/workspaces.ts`,
`apps/web/src/routes/_chat.settings.workspaces.tsx`, `apps/web/src/routes/w.$slug.tsx`,
`packages/client-runtime/src/workspaces/`, `apps/cloud/src/workspaces/`,
`apps/cloud/src/auth/workspaces.ts`, `apps/cloud/src/auth/access.ts` (who may create one), `apps/mobile/src/features/workspaces/`.

Tests: `apps/cloud/src/workspaces/*.test.ts` and
`apps/cloud/src/auth/workspaces.test.ts` (rules and the write path on PGlite),
`packages/client-runtime/src/workspaces/*.test.ts` (views, `stopped`, `close`).
