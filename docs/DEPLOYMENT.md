# Deployment

## Deployment architecture

- **Frontend:** GitHub Pages at the `/opstalia/` project path
- **Backend:** Cloudflare Worker containing the fixed live adapter registry
- **Local research storage:** browser IndexedDB
- **Backend storage:** none
- **Upstream response cache:** none

Frontend target:

<https://therealjameswilson.github.io/opstalia/>

The backend URL is assigned by Cloudflare during deployment. Do not guess it from the Worker name. Copy the exact HTTPS URL from Wrangler’s successful deployment output, verify its health endpoint, and only then configure it as `VITE_API_BASE`.

## Prerequisites

- Node.js 22.13 or later
- npm
- GitHub CLI authenticated as an account with access to `therealjameswilson/opstalia`
- Cloudflare account
- Wrangler authenticated to that account
- NARA Catalog API key if NARA or either NARA record-group profile should run
- GovInfo API key if GovInfo search should run

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
| `GOVINFO_API_KEY` | Cloudflare Worker secret | Yes | GovInfo Search Service authentication |
| `RATE_LIMIT_SALT` | Cloudflare Worker secret | Yes | Salt for ephemeral hashed rate-limit keys |
| `FRONTEND_ORIGIN` | `worker/wrangler.toml` non-secret variable | No | Exact allowed browser origin |
| `APP_ENV` | `worker/wrangler.toml` non-secret variable | No | Enables production origin policy |
| `CLOUDFLARE_API_TOKEN` | GitHub Actions secret, only for automated Worker deploy | Yes | Scoped Worker deployment credential |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub Actions secret, only for automated Worker deploy | Yes | Cloudflare account selector |

`VITE_API_BASE` is public by design. No value beginning with `VITE_` may contain `NARA_API_KEY`, `GOVINFO_API_KEY`, or another credential.

For GitHub Pages, the workflow uses GitHub’s short-lived `GITHUB_TOKEN`; no custom Pages secret is needed. The Worker deployment secrets are independent of Pages.

## Local verification

The four static indexes need no Worker or API key:

```bash
npm run dev
```

For local Worker testing, create the ignored file `worker/.dev.vars`. Include only the source keys you intend to test:

```dotenv
NARA_API_KEY=replace-with-your-local-development-key
GOVINFO_API_KEY=replace-with-your-local-development-key
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

The response reports public service metadata, registered adapter IDs, and Boolean `naraSecretConfigured` and `govInfoSecretConfigured` values; it must never contain either key. The Worker can be ready and useful with both values false because NTRS and OSTI require no application source secret.

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

At this moment the health endpoint can be reachable with `ready: true` while source-key Booleans remain false. `ready` means the Worker registry is reachable, not that every adapter's optional prerequisite is configured.

### 3. Install secrets

Install the NARA key directly into Cloudflare:

```bash
npx wrangler secret put NARA_API_KEY --config worker/wrangler.toml
```

Install the GovInfo key if GovInfo should run:

```bash
npx wrangler secret put GOVINFO_API_KEY --config worker/wrangler.toml
```

Install a random production rate-limit salt:

```bash
npx wrangler secret put RATE_LIMIT_SALT --config worker/wrangler.toml
```

These commands prompt for their values. Do not put values in shell history, `.env.example`, documentation, screenshots, GitHub Actions output, or repository files.

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
  "govInfoSecretConfigured": true,
  "registeredAdapters": [
    "nara",
    "nara-cia-rg263",
    "nara-state-rg59",
    "govinfo",
    "nasa-ntrs",
    "osti-sti"
  ]
}
```

Either source-secret Boolean may legitimately be false when that keyed adapter is intentionally disabled. Do not record a backend URL in release notes until the endpoint and intended adapter readiness have been verified.

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

The frontend workflow should pass `vars.VITE_API_BASE` into the Vite build. If the variable is missing, it should pass an empty value rather than fail. This preserves a deployable static site whose Worker-backed sources report setup status while FRUS, ISCAP, NDC, the optional NARA JFK index, and manual adapters remain available.

### Optional automated Worker deployment

The safest first deployment is the local Wrangler procedure above because source API keys are installed directly in Cloudflare rather than passed through GitHub.

If the repository’s backend workflow is enabled, create a Cloudflare API token scoped only to the target account and Workers deployment. Add the deployment credentials interactively:

```bash
gh secret set CLOUDFLARE_API_TOKEN \
  --repo therealjameswilson/opstalia
```

```bash
gh secret set CLOUDFLARE_ACCOUNT_ID \
  --repo therealjameswilson/opstalia
```

Do **not** add `NARA_API_KEY` or `GOVINFO_API_KEY` as GitHub secrets for routine deployment. Wrangler retains Worker secrets independently across code deployments. The backend workflow validates only Cloudflare deployment credentials; it does not read, print, or replace source API secrets, and it must not break the frontend Pages workflow.

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
rg -n "NARA_API_KEY|GOVINFO_API_KEY|x-api-key" dist
```

The second command must not reveal a secret value. Secret names may appear in user-facing setup or security copy; no actual credential may appear.

Also confirm:

- every result fixture uses an approved official domain;
- the header and search acknowledgement contain the unclassified warning;
- the site says it is independent and not an official Government site;
- no UI asks for a classified document;
- the source dashboard reports 35 sources: 2 integrated, 8 beta, 20 manual, 1 temporarily unavailable, and 4 planned;
- the FRUS, ISCAP, NDC, and NARA JFK counts remain 752, 529, 133, and 2,709;
- Worker and upstream API requests use the intended no-store policy;
- native CIA and State remain manual/unavailable, while the separate opt-in NARA RG 263/RG 59 profiles are labeled as NARA-only discovery;
- the NARA JFK index is opt-in, links only to official release-path PDFs, and contains no Doctly/GitHub evidence URLs;
- streamed request/response limits and source-specific file-to-record ID checks pass their security tests;
- Packet Lab health reports only Boolean `pdfRelayConfigured` readiness, no R2,
  KV, D1, Durable Object, or PDF cache binding is configured, and the deployed
  relay enforces prefix-only admission plus a hard 100 MiB full-stream cap;
- GovInfo, NTRS, and OSTI carry their publication/STI—not declassification-proof—caveats; and
- the application states that Opstalia-c is not connected.

## Publish

After review:

```bash
git status --short
git add .
git commit -m "Release Opstalia 1.2.0"
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
4. FRUS, ISCAP, NDC, and the optional NARA JFK index return local-index results for known fixture terms or RIFs;
5. Worker health reports version `1.2.0`, the registered adapters, and only Boolean secret readiness, including `pdfRelayConfigured` without exposing `RATE_LIMIT_SALT`;
6. when `NARA_API_KEY` is installed, an exact general-NARA NAID search produces a transient official result; after explicitly opting into each RG profile, its results remain visibly NARA-only;
7. when `GOVINFO_API_KEY` is installed, GovInfo runs without implying declassification evidence;
8. NTRS and OSTI run through the Worker without a source API key and retain their STI/publication caveats;
9. native CIA and State are clearly manual/unavailable, not automated;
10. Packet Lab admission accepts only the exact approved NARA host/path and a matching researcher-supplied NAID record locator, performs `HEAD` plus a prefix-only GET/cancel, and labels the association unverified;
11. opening an eligible packet makes one bounded full-source transfer, computes source SHA-256 in the browser, and gives PDF.js local page access without byte-range requests;
12. a source whose reported or streamed body exceeds 100 MiB is rejected, including when no usable upstream length is visible;
13. derivative export makes a second complete source transfer and refuses output when that copy's SHA-256 differs from the opening hash;
14. neither Worker configuration nor runtime contains an R2, KV, D1, Durable Object, PDF cache, or persisted PDF body;
15. an unofficial-domain fixture is rejected;
16. project save, export, import, comparison, and private mode work; and
17. the browser network panel contains no source API key.

Run a remote bundle check:

```bash
curl --fail --silent \
  https://therealjameswilson.github.io/opstalia/ \
  -o /tmp/opstalia-index.html
rg -n "NARA_API_KEY|GOVINFO_API_KEY|x-api-key" /tmp/opstalia-index.html
```

No secret value may appear. Inspect referenced JavaScript assets as part of the release verification when recording the final commit.

## Failure modes

### Frontend is live but Worker-backed sources say setup is required

Check, in order:

1. `VITE_API_BASE` exists as a GitHub Actions repository variable;
2. the frontend workflow rebuilt after the variable was set;
3. the URL has no trailing `/api` path;
4. `/api/health` is reachable; and
5. `/api/health` lists the expected adapter; and
6. the selected keyed adapter's readiness Boolean is true when that adapter should be enabled.

### Worker is reachable but CORS fails

Confirm `FRONTEND_ORIGIN` is exactly `https://therealjameswilson.github.io`, then redeploy Worker code.

### NARA returns 429

Wait for the upstream or local rate window. Do not bypass rate controls. Opstalia limits each NARA source run to the first three enabled queries that explicitly name that source ID. An empty source-ID list targets no source.

### GovInfo reports a missing key

Install `GOVINFO_API_KEY` directly in Cloudflare, verify only the Boolean readiness field, and retry. Do not put the key in GitHub Actions variables or frontend configuration.

### One source fails

This should not cancel other sources. Confirm the source receives `temporarily_unavailable` and exposes its manual fallback.

### Static index refresh changes counts sharply

Do not publish automatically. Check the upstream source, parser, hash or pinned commit, and generated diff.

## Rollback

Frontend rollback should redeploy a previously verified commit through the Pages workflow. Worker rollback should deploy the previous verified Worker commit with Wrangler. Cloudflare secrets remain outside Git and should not be copied into rollback artifacts.

After rollback, repeat health, CORS, secret, source-count, and production-URL checks.
