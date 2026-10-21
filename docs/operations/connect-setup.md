# T3 Connect setup

Deployment and client configuration for T3 Connect. The [architecture note](../internals/t3-connect.md)
explains the trust boundaries; the [relay README](../../infra/relay/README.md#deployment) owns relay
provisioning instructions, and the [cloud README](../../infra/cloud/README.md) owns the Sign in with
Mercurian deployment.

## Public application configuration

T3 Connect is disabled in a fresh clone. To build against the production deployment, copy the
repository-root example:

```sh
cp .env.example .env
```

For another deployment, set these values in the repository-root `.env` or `.env.local`:

```dotenv
T3CODE_AUTH_URL=https://auth.example.com
T3CODE_RELAY_URL=https://relay.example.com
```

Process variables take precedence over `.env.local`, then `.env`. Use these canonical names;
the build loader supplies framework-specific aliases. These values are public. Sign in with
Mercurian's secrets belong to its cloud deployment, never in client configuration.

Client and bundled-server builds embed the public values, so set them before building.
EAS preview and production environments need the auth URL and relay URL.
Bundled servers also accept runtime overrides for operator-managed deployments.

Copy `infra/relay/.env.example` to `infra/relay/.env` for relay deployment settings.
Deploy `prod` before personal stages because it owns the retained database that their branches
depend on. The stack's `PublishClientConfig` action writes the resulting relay URL back to the root `.env`.

The auth URL and relay URL must belong together. The relay's `ACCOUNT_JWT_ISSUER` is the auth URL,
and the cloud API's `RELAY_URL` is the relay's origin, because relay tokens are issued for exactly
that audience.

## Desktop passkeys

Desktop sign-in happens in the system browser, so it needs no app capability. Passkeys inside the
in-app browser do: they need a signed app with a provisioning profile for bundle ID
`com.mercurian.astrolabe`.

1. Create an explicit macOS App ID in the Apple Developer portal.
2. Create a provisioning profile for that App ID and the distribution signing certificate.
3. Configure signing as described in the [release runbook](./release.md#2-apple-signing--notarization-setup-macos),
   which lists the passkey entitlements the profile can grant.

Local signed builds additionally use:

```dotenv
T3CODE_APPLE_TEAM_ID=ABC1234567
T3CODE_MACOS_PROVISIONING_PROFILE=/absolute/path/to/t3code.provisionprofile
```

The ordinary `dev:desktop` launcher is unsigned and cannot exercise macOS passkeys. For renderer
HMR, install a signed build, start `vp run dev:web`, and launch the installed executable with the
actual web and server ports. For example, with the default ports:

```sh
VITE_DEV_SERVER_URL=http://127.0.0.1:5733 \
T3CODE_PORT=13773 \
  "/Applications/Astrolabe (Alpha).app/Contents/MacOS/Astrolabe (Alpha)"
```

Rebuild the signed app after native dependency, main-process, preload, entitlement, provisioning,
or signing changes. Renderer edits can reuse it. Verify the installed bundle before testing:

```sh
codesign --verify --deep --strict "/Applications/Astrolabe (Alpha).app"
codesign -d --entitlements :- "/Applications/Astrolabe (Alpha).app"
```

## Sign-in providers

Google, GitHub, Microsoft, and Apple sign-in are off for launch. Each is built and appears on the
sign-in page once its client ID and secret are set on the cloud deployment (`GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET`, and likewise for the others).

When one is turned on, it gets two OAuth clients, each in its own provider project, because the
consent screen and its publishing status belong to the project:

- **Production:** published, with one redirect URI,
  `https://app.astrolabe.sh/api/auth/callback/<provider>`. Its secret lives only in the cloud
  deployment.
- **Development:** left in testing with named test users, redirecting to the local stack's
  `localhost` auth URL. A production secret never sits on a laptop.

Desktop, mobile, and the CLI sign in through the auth pages, so they need no provider clients of
their own.

## Restricting sign-ups

Every new account starts on the waitlist. It can sign in, but gets no relay token until it is
approved or accepts an invitation to an organization. Approve or decline accounts at
the admin site ([`apps/admin`](../../apps/admin/src/main.ts)), which is reachable only on the
Mercurian tailnet: it listens on loopback behind `tailscale serve` and trusts the tailnet user that
`tailscale serve` names on each request. Never expose it any other way. From a terminal with
database access, [`apps/cloud/scripts/waitlist.ts`](../../apps/cloud/scripts/waitlist.ts) does the
same. Approving emails the person; locally, `vp run dev` in `apps/admin` serves it without the
tailnet check.
