# Deployment

## Deployment architecture

- **Frontend:** GitHub Pages at the `/opstalia/` project path
- **Backend:** Cloudflare Worker containing the live NARA adapter
- **Local research storage:** browser IndexedDB
- **Backend storage:** none
- **NARA cache:** none

Frontend target:

<https://therealjameswilson.github.io/opstalia/>

The backend URL is assigned by Cloudflare during deployment. Do not guess it from the Worker name. Copy the exact HTTPS URL from Wrangler’s successful deployment output, verify its health endpoint, and only then configure it as `VITE_API_BASE`.

## Prerequisites

- Node.js 22.13 or later
- npm
- GitHub CLI authenticated as an account with access to `therealjameswilson/opstalia`
- Cloudflare account
- Wrangler authenticated to that account
- NARA Catalog API key

Install dependencies:

```bash
npm ci
```

Authenticate Wrangler:

```bash
npx wrangler login
```

Confirm both targets before publishing:

```bash
git remote -v
gh repo view therealjameswilson/opstalia --json nameWithOwner,visibility,url
npx wrangler whoami
```

Expected GitHub target: `therealjameswilson/opstalia`. Never force-push.

## Configuration map

| Name | Location | Secret | Purpose |
|---|---|---:|---|
| `VITE_API_BASE` | GitHub Actions repository variable or local `.env.local` | No | Public verified Worker base URL compiled into the frontend |
| `NARA_API_KEY` | Cloudflare Worker secret | Yes | NARA Catalog API authentication |
| `RATE_LIMIT_SALT` | Cloudflare Worker secret | Yes | Salt for ephemeral hashed rate-limit keys |
| `FRONTEND_ORIGIN` | `worker/wrangler.toml` non-secret variable | No | Exact allowed browser origin |
| `APP_ENV` | `worker/wrangler.toml` non-secret variable | No | Enables production origin policy |
| `CLOUDFLARE_API_TOKEN` | GitHub Actions secret, only for automated Worker deploy | Yes | Scoped Worker deployment credential |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub Actions secret, only for automated Worker deploy | Yes | Cloudflare account selector |

`VITE_API_BASE` is public by design. No value beginning with `VITE_` may contain `NARA_API_KEY` or another credential.

For GitHub Pages, the workflow uses GitHub’s short-lived `GITHUB_TOKEN`; no custom Pages secret is needed. The Worker deployment secrets are independent of Pages.

## Local verification

The three static indexes need no API key:

```bash
npm run dev
```

For live local NARA testing, create the ignored file `worker/.dev.vars`:

```dotenv
NARA_API_KEY=replace-with-your-local-development-key
RATE_LIMIT_SALT=replace-with-a-random-local-value
FRONTEND_ORIGIN=http://localhost:5173
APP_ENV=development
```

Wrangler loads local development variables from a `.dev.vars` or `.env` file in the same directory as the Wrangler configuration. Use one mechanism, not both, and never commit it. See Cloudflare’s [local environment-variable guidance](https://developers.cloudflare.com/workers/local-development/environment-variables/).

Create the ignored `.env.local`:

```dotenv
VITE_API_BASE=http://127.0.0.1:8787
```

Start the two processes:

```bash
npm run worker:dev
```

```bash
npm run dev
```

Check the local Worker without exposing the secret:

```bash
curl --fail --silent http://127.0.0.1:8787/api/health
```

The response may state `naraSecretConfigured: true`; it must never contain the key.

## Deploy the Cloudflare Worker

### 1. Review non-secret variables

`worker/wrangler.toml` contains:

```toml
[vars]
FRONTEND_ORIGIN = "https://therealjameswilson.github.io"
APP_ENV = "production"
```

An HTTP `Origin` contains no path, so the allowed origin is the GitHub Pages host, not `https://therealjameswilson.github.io/opstalia/`.

### 2. Deploy code

```bash
npm run worker:deploy
```

At this moment the health endpoint can be reachable but report `ready: false`. That is expected until the secret is installed.

### 3. Install secrets

Install the NARA key directly into Cloudflare:

```bash
npx wrangler secret put NARA_API_KEY --config worker/wrangler.toml
```

Install a random production rate-limit salt:

```bash
npx wrangler secret put RATE_LIMIT_SALT --config worker/wrangler.toml
```

Both commands prompt for their values. Do not put values in shell history, `.env.example`, documentation, screenshots, GitHub Actions output, or repository files.

Cloudflare documents that `wrangler secret put` creates and immediately deploys a Worker version containing the updated secret; subsequent code deployments preserve secrets unless they are explicitly deleted. See [Cloudflare Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

### 4. Verify the assigned backend URL

Use the exact URL shown by Wrangler:

```bash
curl --fail --silent https://VERIFIED-WORKER-URL/api/health
```

Expected properties:

```json
{
  "ok": true,
  "ready": true,
  "service": "opstalia-api",
  "naraSecretConfigured": true,
  "storagePolicy": "NARA responses are not cached or stored"
}
```

Do not record a backend URL in release notes until this check succeeds.

### 5. Verify CORS

Allowed production origin:

```bash
curl --include \
  --header "Origin: https://therealjameswilson.github.io" \
  https://VERIFIED-WORKER-URL/api/health
```

The response should include:

```text
Access-Control-Allow-Origin: https://therealjameswilson.github.io
```

An unapproved origin should receive 403:

```bash
curl --include \
  --header "Origin: https://example.com" \
  https://VERIFIED-WORKER-URL/api/health
```

## Configure GitHub Pages

### Repository variable

Set the verified Worker URL as a non-secret Actions variable:

```bash
gh variable set VITE_API_BASE \
  --repo therealjameswilson/opstalia \
  --body "https://VERIFIED-WORKER-URL"
```

Confirm the variable name:

```bash
gh variable list --repo therealjameswilson/opstalia
```

The value is intentionally public because it appears in the browser bundle.

### Pages source

In repository settings:

1. Open **Settings → Pages**.
2. Under **Build and deployment**, select **GitHub Actions**.
3. Keep the public base path `/opstalia/`; `vite.config.ts` already builds for it.

The frontend workflow should pass `vars.VITE_API_BASE` into the Vite build. If the variable is missing, it should pass an empty value rather than fail. This preserves a deployable static site whose NARA panel reports setup status while FRUS, ISCAP, NDC, and manual adapters remain available.

### Optional automated Worker deployment

The safest first deployment is the local Wrangler procedure above because it installs `NARA_API_KEY` directly in Cloudflare.

If the repository’s backend workflow is enabled, create a Cloudflare API token scoped only to the target account and Workers deployment. Add the deployment credentials interactively:

```bash
gh secret set CLOUDFLARE_API_TOKEN \
  --repo therealjameswilson/opstalia
```

```bash
gh secret set CLOUDFLARE_ACCOUNT_ID \
  --repo therealjameswilson/opstalia
```

Do **not** add `NARA_API_KEY` as a GitHub secret for routine deployment. Wrangler retains Worker secrets independently across code deployments. The backend workflow should skip or report “not ready” when Cloudflare deployment credentials are absent; it must not break the frontend Pages workflow.

## Pre-deployment quality gate

Run:

```bash
npm run check
npm run test:e2e
npm run test:a11y
npm run test:security
npm run audit
npm run secret:scan
```

Inspect the production build:

```bash
VITE_API_BASE="https://VERIFIED-WORKER-URL" npm run build
rg -n "NARA_API_KEY|x-api-key" dist
```

The second command must not reveal a secret value. The literal string `NARA_API_KEY` may appear in user-facing setup or security copy; no actual credential may appear.

Also confirm:

- every result fixture uses an approved official domain;
- the header and search acknowledgement contain the unclassified warning;
- the site says it is independent and not an official Government site;
- no UI asks for a classified document;
- the source dashboard reports 30 sources with the current status counts;
- the FRUS, ISCAP, and NDC counts remain 752, 529, and 121;
- the NARA Worker sends `Cache-Control: no-store`; and
- the application states that Opstalia-c is not connected.

## Publish

After review:

```bash
git status --short
git add .
git commit -m "Release Opstalia 1.0"
git push origin main
```

Never use `--force`.

Watch the repository’s Actions page. The frontend workflow should build and deploy GitHub Pages. A backend workflow, if enabled and configured, deploys Worker code separately.

## Production verification

Check the frontend:

```bash
curl --fail --silent \
  https://therealjameswilson.github.io/opstalia/ \
  | rg "OPSTALIA|root"
```

Then verify in a browser:

1. the application loads at the `/opstalia/` path;
2. the independent-site and unclassified notices are visible;
3. a search cannot proceed without acknowledgement;
4. FRUS, ISCAP, and NDC return local-index results for known fixture terms;
5. Worker health reports ready;
6. an exact NARA NAID search produces a transient official result;
7. CIA and State are clearly manual, not automated;
8. an unofficial-domain fixture is rejected;
9. project save, export, import, comparison, and private mode work; and
10. the browser network panel contains no `NARA_API_KEY`.

Run a remote bundle check:

```bash
curl --fail --silent \
  https://therealjameswilson.github.io/opstalia/ \
  -o /tmp/opstalia-index.html
rg -n "NARA_API_KEY|x-api-key" /tmp/opstalia-index.html
```

No secret value may appear. Inspect referenced JavaScript assets as part of the release verification when recording the final commit.

## Failure modes

### Frontend is live but NARA says setup is required

Check, in order:

1. `VITE_API_BASE` exists as a GitHub Actions repository variable;
2. the frontend workflow rebuilt after the variable was set;
3. the URL has no trailing `/api` path;
4. `/api/health` is reachable; and
5. `naraSecretConfigured` is true.

### Worker is reachable but CORS fails

Confirm `FRONTEND_ORIGIN` is exactly `https://therealjameswilson.github.io`, then redeploy Worker code.

### NARA returns 429

Wait for the upstream or local rate window. Do not bypass rate controls. Opstalia limits NARA to the first three enabled plan queries per run.

### One source fails

This should not cancel other sources. Confirm the source receives `temporarily_unavailable` and exposes its manual fallback.

### Static index refresh changes counts sharply

Do not publish automatically. Check the upstream source, parser, hash or pinned commit, and generated diff.

## Rollback

Frontend rollback should redeploy a previously verified commit through the Pages workflow. Worker rollback should deploy the previous verified Worker commit with Wrangler. Cloudflare secrets remain outside Git and should not be copied into rollback artifacts.

After rollback, repeat health, CORS, secret, source-count, and production-URL checks.
