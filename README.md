# OPSTALIA 1.0

## Declassified Records Search Engine

**Search the official record of declassification.**

Opstalia is an independent, open-source research tool for determining whether a record described by **unclassified metadata** appears to have been officially released to the public by the United States Government.

> **Use unclassified information only.** Do not enter, upload, paste, or transmit classified information, controlled unclassified information, personally identifiable information, or other restricted material. Opstalia searches public U.S. Government repositories and is not an authorized system for classified records.

Opstalia 1.0 operates only on the regular, unclassified Internet. It has no connection, synchronization, bridge, or network route to **Opstalia-c** or any closed network. A future relationship with Opstalia-c would require separate authorization, engineering, and security review; it is not implemented in this release.

Opstalia is an independent research tool and is not an official U.S. Government website.

## What Opstalia does

Opstalia 1.0 lets a researcher:

- define a target record in a guided form or quick search;
- acknowledge the unclassified-use boundary before building or running a search;
- generate and edit deterministic query variants without a paid AI service;
- run supported official-source searches with failures isolated by source;
- normalize results into a shared, provenance-aware schema;
- rank results with visible scoring factors;
- group possible versions using explainable matching;
- compare two public versions, available text, metadata, and page alignment;
- review, correct, confirm, reject, merge, or split automated interpretations;
- save projects and research judgments in browser-local IndexedDB;
- use a private mode that avoids project persistence;
- export Markdown, CSV, JSON, and printable HTML reports; and
- export and re-import a complete project as JSON.

Every result admitted to the primary result set must have a registered adapter provenance record, an approved official domain, and an official record or file URL.

Project imports receive deep structural and official-domain validation. Because importing does not re-fetch every official source, imported records are visibly marked **Imported · source not revalidated** and cannot claim checked-in fixture status.

## What Opstalia does not do

Opstalia does not:

- accept classified documents or provide a classified-document upload workflow;
- accept CUI, PII, or other restricted information;
- search leaked, hacked, unlawfully obtained, or unofficially disclosed collections;
- search media caches, personal sites, commercial repositories, social-media uploads, crowdsourced archives, anonymous hosts, or unofficial GitHub document copies;
- determine whether information is classified or declassified;
- make legal, disclosure, authenticity, or completeness determinations;
- infer a full release from the absence of visible black boxes;
- claim to search every government system; or
- connect to Opstalia-c.

Absence of a result does not establish that a document has never been released. Government systems may be incomplete, unindexed, temporarily unavailable, or limited to metadata. “Declassified” and “publicly available online” are not synonymous.

## Security warning

The search acknowledgement is an operational boundary, not a classification review. Classification is not removed by transcription, paraphrase, OCR, summarization, or metadata extraction, and Opstalia never claims that AI can determine classification.

The public build contains no source-document upload control. Its only live search API route accepts a validated, size-limited search request for NARA; the separate health route reports configuration status without revealing a secret. The NARA key remains a Cloudflare Worker secret named `NARA_API_KEY`; it is never a frontend variable.

Read [SECURITY.md](SECURITY.md), [PRIVACY.md](PRIVACY.md), [the security model](docs/SECURITY_MODEL.md), and [the threat model](docs/THREAT_MODEL.md) before deployment.

## Supported sources

The registry snapshot was validated on **2026-07-29** and contains 30 official-source entries:

| Status | Count | 1.0 behavior |
|---|---:|---|
| Integrated | 2 | National Archives Catalog; Office of the Historian / FRUS |
| Beta | 2 | ISCAP releases; National Declassification Center release lists |
| Temporarily unavailable | 1 | CIA FOIA Electronic Reading Room, with an official manual-search link |
| Manual search | 20 | Official agency search or reading-room links; no normalized results are claimed |
| Planned | 5 | Registry and official link only |
| Retired | 0 | None |

The automated implementations are deliberately different:

- **National Archives Catalog:** live Catalog API v2 search through a Cloudflare Worker. A working deployment requires `NARA_API_KEY`.
- **FRUS:** browser-local search of exactly **752 documents in three volumes** (`frus1981-88v03`, `frus1981-88v05`, and `frus1981-88v06`) built from a pinned official Office of the Historian TEI project snapshot.
- **ISCAP:** browser-local search of exactly **529 release-table objects** built from the official NARA ISCAP releases page.
- **NDC:** browser-local search of exactly **121 rows** from the official FY2026 Q3 release-list workbook. These are generally series-level finding-aid or availability descriptions, not item-level digital records.

CIA and Department of State FOIA are **not** working automated integrations in 1.0. They have first-class links to their official search systems. See [SOURCE_COVERAGE.md](docs/SOURCE_COVERAGE.md) for the complete registry and its limitations.

Opstalia searches its current registry of supported official repositories.

### NARA attribution

> This product uses the National Archives Catalog API but is not endorsed or certified by the National Archives and Records Administration.

NARA API content is transient: Opstalia does not cache or store NARA API responses. Saving or exporting a project reduces a NARA result to a generated NAID/official-URL locator and researcher-created review data, not the API response, source metadata, API-derived scoring explanation, or automatic NARA-derived version evidence.

## Architecture

Opstalia uses a two-part architecture:

1. A React 19, TypeScript, and Vite single-page application is built for the `/opstalia/` base path and hosted on GitHub Pages.
2. A TypeScript Cloudflare Worker holds `NARA_API_KEY`, validates requests, enforces a fixed NARA upstream, applies CORS and rate limits, and returns normalized transient results.

FRUS, ISCAP, and NDC are checked-in, same-origin static indexes searched inside the browser. Projects, comparisons, annotations, reports, and preferences are stored in IndexedDB unless private mode is active. No user account or public multi-user database is required.

The source registry and official-domain allowlists live in [`data/sources.json`](data/sources.json). Shared TypeScript entities live in [`src/core/types.ts`](src/core/types.ts), and input-boundary validation lives in [`src/core/validation.ts`](src/core/validation.ts).

See:

- [Architecture and decision record](docs/ARCHITECTURE.md)
- [Data model](docs/DATA_MODEL.md)
- [Source-adapter guide](docs/SOURCE_ADAPTERS.md)
- [Deployment guide](docs/DEPLOYMENT.md)

## Local development

Prerequisites:

- Node.js 22.13 or later;
- npm;
- a Cloudflare account and Wrangler login only if running the live Worker; and
- a NARA Catalog API key only if testing live NARA search.

Install and start the frontend:

```bash
git clone https://github.com/therealjameswilson/opstalia.git
cd opstalia
npm ci
npm run dev
```

The frontend runs at `http://localhost:5173/`. The three checked-in local indexes work without a Worker or API key.

To test the local Worker, create an ignored `worker/.dev.vars` file:

```dotenv
NARA_API_KEY=replace-with-your-local-development-key
RATE_LIMIT_SALT=replace-with-a-random-local-value
FRONTEND_ORIGIN=http://localhost:5173
APP_ENV=development
```

Then set the public local Worker URL in an ignored `.env.local`:

```dotenv
VITE_API_BASE=http://127.0.0.1:8787
```

Run the Worker and frontend in separate terminals:

```bash
npm run worker:dev
```

```bash
npm run dev
```

Never commit `.dev.vars`, `.env.local`, an API key, or any other secret.

## API secrets

`VITE_` variables are compiled into public browser JavaScript. **Never put `NARA_API_KEY` in a `VITE_` variable.**

Install the production NARA key directly into Cloudflare’s secret store:

```bash
npx wrangler secret put NARA_API_KEY --config worker/wrangler.toml
```

Wrangler prompts for the value without requiring it in source or a command-line argument. A production rate-limit salt should also be installed as a secret:

```bash
npx wrangler secret put RATE_LIMIT_SALT --config worker/wrangler.toml
```

The health endpoint reports only whether the NARA secret is configured; it never returns the value.

## Deployment

The frontend deployment target is:

<https://therealjameswilson.github.io/opstalia/>

The Worker URL is created by Cloudflare and must be verified from Wrangler’s deployment output. This repository does not invent or publish an unverified backend URL. After deployment, place the verified URL in the GitHub Actions repository variable `VITE_API_BASE`.

The safe order is:

```bash
npm ci
npm run check
npm run secret:scan
npm run worker:deploy
npx wrangler secret put NARA_API_KEY --config worker/wrangler.toml
npx wrangler secret put RATE_LIMIT_SALT --config worker/wrangler.toml
```

Then configure the public Worker URL and trigger the frontend workflow:

```bash
gh variable set VITE_API_BASE \
  --repo therealjameswilson/opstalia \
  --body "https://VERIFIED-WORKER-URL"
git push origin main
```

The frontend still builds when `VITE_API_BASE` is absent. In that state, NARA is shown as unavailable with a manual Catalog link; FRUS, ISCAP, and NDC continue to work. Backend deployment is therefore not a precondition for a successful static frontend build.

Full Cloudflare, GitHub Pages, Actions-variable, readiness, and verification instructions are in [DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Testing

Run the full local quality gate:

```bash
npm run check
```

Run individual suites:

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:security
npm run test:e2e
npm run test:a11y
npm run build
npm run audit
npm run secret:scan
```

Vitest tests use recorded fixtures rather than consuming live API quota in normal CI. Playwright runs desktop Chromium and a mobile profile against the production-base-path preview.

## Source-adapter development

Source definitions belong in [`data/sources.json`](data/sources.json); do not scatter domain allowlists across UI code. A backend adapter implements the shared `SourceAdapter` contract in [`worker/src/adapters/types.ts`](worker/src/adapters/types.ts). Client-side pinned-index adapters are isolated in [`src/search/local-adapters.ts`](src/search/local-adapters.ts).

Before marking an adapter automated:

1. validate the official endpoint, terms, robots guidance, authentication, and rate limits;
2. add exact official domains and a manual fallback to the registry;
3. preserve the raw record when policy permits;
4. normalize fields with per-field source, extraction method, and confidence;
5. reject results that fail registered-domain and provenance validation;
6. add recorded integration fixtures and partial-failure tests; and
7. document the actual coverage boundary.

Refresh checked-in indexes only through their builders:

```bash
npm run indexes:frus
npm run indexes:iscap
npm run indexes:ndc
```

These commands access official public sources and may change generated data. Review record counts, provenance metadata, source hashes or pinned commit, and diffs before committing.

## Known limitations

- Live NARA search is unavailable until a Worker URL and `NARA_API_KEY` are configured.
- FRUS coverage is 752 documents in three volumes, not the complete FRUS series.
- ISCAP and NDC searches use build-time snapshots, not live runtime queries.
- NDC rows are generally finding-aid or series-level descriptions and may report that records are not online.
- CIA and State FOIA are manual-only in this release.
- Official search indexes and OCR may be incomplete.
- Textual redaction-marking detection is deterministic and probabilistic; it requires human review.
- The current image routine is a limited dark-region primitive, not a production claim of page-level redaction recognition.
- Synchronized document frames support manual page alignment, but cross-origin viewer behavior depends on the official source.
- Printable HTML is provided; a dedicated PDF-generation dependency is not included.
- Private mode prevents Opstalia persistence but is not anonymous. The selected live source still receives the query needed to search.
- A more complete-looking copy is not presumed authentic or complete.

See [KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md) for the maintained limitations statement.

## Relationship to NARA Scout

**Opstalia was developed from concepts first implemented in NARA Scout.**

[NARA Scout](https://therealjameswilson.github.io/nara-scout/) remains a specialized FRUS research-planning tool. Opstalia is a separate repository and application with a federated source registry, normalized records, cautious release-status analysis, deterministic version relationships, and a broader human-review workflow. The NARA Scout repository is not modified by this project.

## Screenshots

The screenshots below show the production frontend build with the Worker intentionally unconfigured. The dashboard therefore labels the backend **Setup** instead of presenting NARA as live.

### Research dashboard

![Opstalia dashboard showing the Internet-only security boundary, source coverage, and demonstration projects](docs/screenshots/dashboard.png)

### Unclassified search form

![Guided search form with the required unclassified-information acknowledgement](docs/screenshots/search.png)

### Version-comparison workspace

![Side-by-side official-version comparison with deterministic relationship assessment and page alignment](docs/screenshots/comparison.png)

## Roadmap

Priorities after 1.0 include:

- expand the reproducibly pinned FRUS coverage;
- revalidate and, if a stable official interface permits, automate CIA and State FOIA search;
- add other documented official APIs, beginning with GovInfo where release evidence is properly qualified;
- strengthen page-image redaction overlays and manual correction;
- improve attachment, missing-page, and marginal-marking comparison;
- add an optional, stable PDF-report path; and
- separately evaluate a future local analyst and Opstalia-c relationship only inside an authorized environment after explicit security review.

Nothing on that roadmap changes the 1.0 boundary: the public application is unclassified, Internet-only, and disconnected from Opstalia-c.

## License

Opstalia is released under the [MIT License](LICENSE).
