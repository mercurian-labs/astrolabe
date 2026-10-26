# Astrolabe release destinations

> For maintainers. Where an Astrolabe release ships today, what is off and why, and the one-time
> steps before the first run. The workflow mechanics are upstream's, in [release.md](./release.md);
> where the two disagree, this page describes Astrolabe.

Last reviewed: 2026-10-25, against `astrolabe/launch`.

Releases are GitHub Releases on `mercurian-labs/astrolabe`, cut by `.github/workflows/release.yml`
on a `vX.Y.Z` tag push or a manual dispatch. There is no nightly schedule.

| Destination                                     | Status   | Notes                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS desktop, arm64 and x64 (`.dmg`, `.zip`)   | Ships    | Signed and notarized with the five Apple secrets. `APPLE_TEAM_ID` and `MACOS_PROVISIONING_PROFILE` are both set, so the build embeds that profile: it must be a Developer ID profile for `com.mercurian.astrolabe` on team `SC9Q89Q4B6`.                                                       |
| Linux desktop, x64 and arm64 (AppImage, `.deb`) | Ships    | Unsigned, as upstream.                                                                                                                                                                                                                                                                         |
| CLI archives and `SHA256SUMS`                   | Ships    | `t3-<version>-{darwin-arm64,linux-x64,linux-arm64}.tar.gz`. No Intel Mac archive (Node SEA). Install scripts, `astrolabe update` and SSH installs read them.                                                                                                                                   |
| npm `@mercurian/astrolabe`                      | Ships    | Launcher only; downloads the archive above. Trusted publishing with `--provenance` from `publish_cli`. Needs the npm step below.                                                                                                                                                               |
| Desktop auto-update                             | Ships    | electron-builder's feed is this repository (`GITHUB_REPOSITORY`). Stable and nightly carry manifests; preview never does.                                                                                                                                                                      |
| Windows desktop and CLI                         | Off      | Not launching yet. `release.yml` does not call the Windows jobs; `release-desktop.yml` keeps them. The npm launcher and `install.ps1` still list Windows and fail with "not listed in SHA256SUMS".                                                                                             |
| Remote access and sign-in (relay, auth)         | Off      | No `RELAY_DOMAIN` or `AUTH_URL` variable, so clients build with both hidden. Setting both (and `CLOUDFLARE_ACCOUNT_ID` as a variable for the relay's tracing state) turns them on.                                                                                                             |
| Hosted web app (`app.astrolabe.sh`)             | Ships    | Cloudflare Worker `astrolabe-app` (`apps/web/wrangler.jsonc`), deployed by `deploy_web` after npm on stable releases only, so it matches the server `npx` installs. One channel; nightlies and previews never touch it. Skips without the Cloudflare secrets. Needs the Cloudflare step below. |
| AUR                                             | Off      | `publish-aur.yml` is `if: false`. Needs an Astrolabe PKGBUILD for `Astrolabe-*-x86_64.AppImage`, an AUR account, `AUR_SSH_PRIVATE_KEY`, then the `publish_aur` job back in `release.yml`.                                                                                                      |
| iOS and Android stores (EAS)                    | Manual   | `mobile-eas-production.yml` runs only from a dispatch, never on push.                                                                                                                                                                                                                          |
| Website                                         | Separate | `astrolabe.sh` is `apps/landing`, the Cloudflare Worker `astrolabe-site` (`apps/landing/wrangler.jsonc`), deployed by `deploy-landing.yml` on pushes to `main` that touch it, or a dispatch. Its download page reads this repository's latest release.                                         |
| Discord, Homebrew, winget, scoop                | None     | No Astrolabe channel or package. The Discord job runs after a stable release's hosted web deploy and its steps fail softly without `DISCORD_RELEASE_WEBHOOK_URL`.                                                                                                                              |

## Before the first release

1. Delete the old prereleases on the repository (`v0.0.29-nightly.*`, `v0.0.41-preview.*`) and
   their tags. They are titled "T3 Code", and stable dispatches, generated notes and the nightly
   updater all start from the newest nightly they find.
2. Make the repository public: **Settings → General → Danger Zone → Change visibility**. The
   install scripts, the launcher and the landing page fetch release assets anonymously.
3. Enable the workflow: **Actions → Release → Enable workflow** (it is disabled by hand).
4. Register the npm trusted publisher: on npmjs.com, **@mercurian/astrolabe → Settings → Trusted
   publishing → GitHub Actions**, with organization `mercurian-labs`, repository `astrolabe`,
   workflow filename `release.yml` and no environment (`publish_cli` uses none). The package
   already exists, so the form is available. If one was registered for the old line, check it
   matches.
5. Let the Cloudflare token deploy both sites: the `CLOUDFLARE_API_TOKEN` secret needs **Account →
   Workers Scripts: Edit**, and for the `astrolabe.sh` zone **Workers Routes: Edit**, **DNS: Edit**
   and **Zone: Read** (custom domains write their own DNS records). Both workflows read
   `CLOUDFLARE_ACCOUNT_ID` as a secret. The first deploys replace the proxied records now answering 525 for `astrolabe.sh` and
   `app.astrolabe.sh`; if one fails on a conflicting record, delete it under **DNS → Records** and
   rerun. For `www.astrolabe.sh`, add a proxied `AAAA` record to `100::` and a **Rules → Redirect
   Rules** entry (the "Redirect from WWW to root" template, 301, keep the query string).

## Cutting a release

- **Preview** (exercises the whole pipeline, reaches no user): **Actions → Release → Run workflow**,
  any branch, channel `preview`; or
  `gh workflow run release.yml -R mercurian-labs/astrolabe --ref main -f channel=preview`. It
  publishes a prerelease and npm's `preview` dist-tag. Check that the `.dmg` opens on a clean Mac
  without a Gatekeeper warning and that `npx @mercurian/astrolabe@preview --version` runs.
- **Stable**: push a `vX.Y.Z` tag on `main`. A stable dispatch instead builds the newest nightly's
  commit, so it needs a nightly dispatched first. After publishing, `finalize` pushes the version
  bump to `main` with the release GitHub App (`RELEASE_APP_ID`), which must be installed on the
  repository and allowed to push there.
- Every channel runs the release quality checks and the full test suites first; a red suite blocks
  the release.
