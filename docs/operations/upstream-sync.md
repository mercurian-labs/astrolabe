# Mercurian release ownership and upstream sync

This runbook records the Mercurian-specific infrastructure layered on top of the inherited release
workflow. The upstream release runbook remains in [release.md](./release.md).

## One-time release setup

Complete these steps before publishing the first Mercurian release:

1. Create a GitHub App named `mercurian-release`, with **Contents: Read and write** and
   **Pull requests: Read and write**, and install it only on `mercurian-labs/astrolabe`.
2. Add its App ID and private key as repository Actions secrets named `RELEASE_APP_ID` and
   `RELEASE_APP_PRIVATE_KEY`.
3. Create the `production` GitHub Actions environment and populate the relay, Clerk, Cloudflare,
   and APNs configuration listed in [release.md](./release.md#t3-connect-relay-deployment).
4. Run `.github/workflows/deploy-relay.yml` from `main` and confirm the production relay deploy is
   green. Release preflight reads public client configuration from that deployed relay.
5. Reserve the npm organization `mercurian` and package `@mercurian/astrolabe`.
6. Configure npm Trusted Publisher for `@mercurian/astrolabe`:
   - provider: GitHub Actions
   - organization or user: `mercurian-labs`
   - repository: `astrolabe`
   - workflow: `release.yml`
   - environment: leave unset unless the npm package is configured to require one

The workspace package remains named `t3` to reduce upstream merge conflicts. The release workflow
passes `--publish-name @mercurian/astrolabe --publish-bin astrolabe`; these flags alter only the
temporary manifest used by `npm publish`, including its repository URL. They do not rename the
workspace. Stable releases publish the npm `latest` dist-tag, and nightlies publish `nightly`.

Install the channels with:

```sh
npm install --global @mercurian/astrolabe
npm install --global @mercurian/astrolabe@nightly
```

The hosted web app is outside the current release scope. When the Vercel secrets are absent, the
release workflow records `skipped_not_configured` and continues without failing the release.

## Upstream sync cadence

`.github/workflows/upstream-sync.yml` runs every Monday at 13:00 UTC and supports manual
`workflow_dispatch`. The weekly cadence comes from
[ADR 004](../architecture/fork-baseline.md#1-upstream-relationship-bounded-tracking). Run it manually
before adapting an inherited surface when fresher upstream code is useful.

The workflow authenticates as `mercurian-release`, fetches `pingdotgg/t3code:main`, and behaves as
follows:

- If `main` already contains the upstream head, it exits successfully without opening a pull
  request.
- If an upstream sync pull request is already open, it exits successfully rather than stacking
  another one.
- If the merge is clean, it pushes a `sync/upstream-<YYYYMMDD>` branch and opens a normal pull
  request. CI runs against the combined tree, and the pull request merges through the same rules as
  any other change. If that date's branch name already exists, the workflow appends the Actions run
  number.
- If the merge conflicts, it aborts the local merge, pushes the unmodified upstream head, and opens
  a pull request whose title starts with `[CONFLICTS]`. No conflict is resolved automatically.

### Resolve a conflicted sync pull request

Use the branch named in the pull request:

```sh
git fetch origin
git switch sync/upstream-<YYYYMMDD>
git merge origin/main
# Resolve every conflict deliberately.
vp check
vp run typecheck
vp run test
git add <resolved-files>
git commit
git push origin sync/upstream-<YYYYMMDD>
```

Do not regenerate or accept lockfile conflicts automatically. Review the incoming dependency changes
and regenerate `pnpm-lock.yaml` only when that is the deliberate resolution. Once CI is green, merge
the pull request normally.

## Protect `main`

Apply protection only after the release and upstream-sync workflow changes have landed. The release
App is the only bypass for the pull-request-flow ruleset because stable release finalization pushes
the version-bump commit directly to `main`. It does not bypass force-push or deletion protection.

The required status checks match CI **job names**. If an upstream merge renames `Check`, `Test`, or
`Release Smoke`, update the ruleset before merging that rename. `Mobile Native Static Analysis`
remains non-blocking while mobile is parked by ADR 004.

Export the repository and the numeric App ID shown in the GitHub App settings:

```sh
export REPO=mercurian-labs/astrolabe
export RELEASE_APP_ID=123456
```

Create the integrity ruleset. It has no bypass actors, so it applies to administrators and the
release App:

```sh
gh api --method POST "repos/$REPO/rulesets" --input - <<'JSON'
{
  "name": "main-integrity",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": {
    "ref_name": {
      "include": ["refs/heads/main"],
      "exclude": []
    }
  },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" }
  ]
}
JSON
```

Create the pull-request-flow ruleset:

```sh
gh api --method POST "repos/$REPO/rulesets" --input - <<JSON
{
  "name": "main-pr-flow",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [
    {
      "actor_id": $RELEASE_APP_ID,
      "actor_type": "Integration",
      "bypass_mode": "always"
    }
  ],
  "conditions": {
    "ref_name": {
      "include": ["refs/heads/main"],
      "exclude": []
    }
  },
  "rules": [
    {
      "type": "pull_request",
      "parameters": {
        "allowed_merge_methods": ["merge", "squash", "rebase"],
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_approving_review_count": 0,
        "required_review_thread_resolution": false
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "do_not_enforce_on_create": false,
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "Check" },
          { "context": "Test" },
          { "context": "Release Smoke" }
        ]
      }
    }
  ]
}
JSON
```

Verify the active rulesets:

```sh
gh api "repos/$REPO/rulesets" \
  --jq '.[] | {id, name, enforcement}'
```

Then probe protection with a disposable branch or pull request: confirm a direct push to `main` is
rejected, a pull request with a failed required check is blocked, and an administrator cannot
force-push or delete `main`.
