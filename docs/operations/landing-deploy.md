# Landing Site Deployment

> For maintainers. The production landing site is served at `https://mercurian.ai/astrolabe`;
> the bare root redirects there permanently.

## One-time provisioning

Complete this provisioning on `mercurian-labs/astrolabe` **before merging the cut-over PR** so the
first push to `main` deploys successfully:

1. In the Mercurian Cloudflare account, create an API token scoped to **Workers Scripts:Edit**.
2. Add the token as the repository secret `CLOUDFLARE_API_TOKEN`.
3. Add the Mercurian Cloudflare account ID as the repository variable
   `CLOUDFLARE_ACCOUNT_ID`.

The workflow fails when `CLOUDFLARE_API_TOKEN` is absent. It never silently skips a production
publish.

## How publishing works

Every push to `main` runs `.github/workflows/deploy-landing.yml`. The workflow builds the static
site, including its postbuild guard, and deploys `apps/landing/dist` to the Cloudflare Worker named
`landing`. There is deliberately no paths filter: shared web components can change the landing
site.

After the standard fresh-clone dependency install (`vp i`), the production publish is reproducible
with two commands from the repository root:

```sh
vp run build:landing
(cd apps/landing && vp dlx wrangler@4.104.0 deploy)
```

The deploy requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the environment.

## Preview without touching production

Build the site, then upload a version without shifting production traffic:

```sh
vp run build:landing
cd apps/landing
vp dlx wrangler@4.104.0 versions upload
```

Wrangler prints a preview URL for the uploaded version. Do not use `deploy` when the intent is only
to preview.

## Cut-over checklist

The first production deploy after the cut-over PR merges replaces the prototype Worker in one act:

- The existing `mercurian.ai` Custom Domain remains attached to the Worker named `landing` and
  begins serving this repository's static site.
- The prototype SSR entrypoint and its D1 binding are absent from the replacement Worker, so
  `POST /api/waitlist` is no longer accepted.
- The `mercurian_waitlist` D1 database is preserved but unbound. Decide its long-term fate later.

After the workflow succeeds:

1. Verify the bare root redirects permanently to the product page:

   ```sh
   curl -s -o /dev/null -w '%{http_code} %{redirect_url}' https://mercurian.ai/
   ```

   Expected output: `308 https://mercurian.ai/astrolabe`.

2. Verify the new page title at `/astrolabe`:

   ```sh
   curl -fsS https://mercurian.ai/astrolabe | grep -F '<title>Mercurian</title>'
   ```

3. Verify the former waitlist endpoint returns `404` or `405` and does not accept the signup:

   ```sh
   curl -i -X POST https://mercurian.ai/api/waitlist \
     -H 'content-type: application/json' \
     --data '{"email":"cutover-verification@example.com"}'
   ```

4. Archive the `mercurian/landing` prototype repository.
5. Record a later decision for the preserved, unbound `mercurian_waitlist` D1 database.

## Rollback

From `apps/landing`, use Wrangler to roll back to the prior Cloudflare deployment:

```sh
vp dlx wrangler@4.104.0 rollback
```

Alternatively, build and deploy an earlier known-good commit with the same two publishing commands.
