# Opstalia 1.0 architecture

## Decision record

**ADR-001 — Static research workspace plus a minimal secret-bearing proxy**

- **Status:** Accepted for 1.0
- **Date:** 2026-07-29
- **Decision:** Host a React/Vite application on GitHub Pages; keep research projects in browser-local IndexedDB; search reproducibly pinned FRUS, ISCAP, and NDC indexes in the browser; and use a small Cloudflare Worker only for the live NARA Catalog API.
- **Reason:** GitHub Pages provides a low-cost, reviewable public frontend, while the Worker prevents the NARA key from entering browser JavaScript. Local project storage avoids creating a public user database or account system. Pinned indexes avoid brittle runtime scraping where no suitable public search API exists.
- **Consequence:** NARA requires a separately deployed Worker and secret. FRUS, ISCAP, and NDC coverage is bounded by the checked-in snapshots. Manual adapters remain necessary for unsupported official systems.

## Security boundary

Opstalia 1.0 is a purely unclassified application on the regular Internet.

It does not accept source documents and must not receive classified information, CUI, PII, or other restricted material. It has no synchronization, connector, bridge, or route to Opstalia-c or another closed network. Future closed-network work is a separate architecture and authorization question; it is not a dormant feature in this build.

## System topology

```mermaid
flowchart LR
    U[Researcher browser]
    P[GitHub Pages<br/>React, TypeScript, Vite]
    IDB[(IndexedDB<br/>local projects)]
    IDX[Same-origin static indexes<br/>FRUS 752, ISCAP 529, NDC 121]
    W[Cloudflare Worker<br/>validation, CORS, rate limit]
    N[NARA Catalog API v2]
    M[Official manual-search sites]
    C[Opstalia-c / closed network]

    U --> P
    P <--> IDB
    P <--> IDX
    P -->|selected unclassified NARA query| W
    W -->|x-api-key + supported parameters| N
    P -->|researcher opens official link| M
    C -. no connection in 1.0 .- P
```

The frontend base path is `/opstalia/`. Hash-based navigation lets the static host serve every application view from one `index.html`.

## Runtime components

### Frontend

The frontend provides:

- the security acknowledgement and guided/quick target forms;
- deterministic search-plan generation and editing;
- concurrent per-source orchestration with partial results;
- normalized result filtering, ranking, version grouping, and review;
- comparison, text diff, and manual page alignment;
- exemption-code reference data;
- local project storage and private mode; and
- Markdown, CSV, JSON, and printable HTML exports.

Important implementation locations:

| Concern | Location |
|---|---|
| Application shell and navigation | `src/App.tsx` |
| Shared entities | `src/core/types.ts` |
| Runtime input validation | `src/core/validation.ts` |
| Query expansion | `src/search/query-expansion.ts` |
| Federated orchestration | `src/search/client.ts` |
| Local index adapters | `src/search/local-adapters.ts` |
| Ranking and grouping | `src/analysis/` |
| Official-domain policy | `src/security/url-policy.ts` |
| Persistence | `src/persistence/database.ts` |
| Reports | `src/reporting/exports.ts` |

### Cloudflare Worker

The Worker exposes:

- `GET /api/health`
- `POST /api/search/nara`

It:

- stores `NARA_API_KEY` only as a Worker secret;
- parses the request through a Zod schema;
- rejects request bodies larger than 16 KB;
- accepts JSON only;
- restricts CORS to configured frontend origins;
- allows only the fixed HTTPS NARA Catalog host for outbound requests;
- caps the API limit at 50 records;
- applies a 15-second request timeout;
- retries a transient upstream failure once with exponential backoff;
- uses an in-isolate, hashed-IP rate limiter of 30 requests per minute;
- sets `Cache-Control: no-store`;
- disables Cloudflare fetch caching for NARA; and
- does not log request bodies, full query strings, keys, authorization data, or IP addresses in application code.

The in-memory rate limiter is a best-effort abuse control, not a globally durable quota system. `RATE_LIMIT_SALT` should be installed as a production secret so the hash material is not the checked-in fallback.

No KV, D1, Durable Object, R2 bucket, analytics service, or response cache is used.

## Search execution

1. The browser validates an unclassified `SearchTarget`.
2. Deterministic expansion produces at most 16 editable `SearchQuery` objects.
3. The researcher chooses registry sources.
4. Sources run concurrently. Queries within each source run sequentially.
5. NARA is capped at the first three enabled plan queries, with 20 requested results per query, to protect quota.
6. Local FRUS, ISCAP, and NDC adapters may evaluate every enabled query targeted to that source.
7. Manual sources generate a local handoff worksheet. State FOIA receives a query-aware official URL; unavailable CIA receives copyable retry terms and official status/publication links.
8. Nothing opens automatically. The researcher must initiate navigation to an official manual source.
9. A source failure is normalized into that source’s run status; other sources continue.
10. Partial normalized results render as they arrive.
11. Per-source and cross-source deduplication runs deterministically.
12. Version candidates are grouped with explicit signals and researcher review remains authoritative.

Manual adapters never manufacture normalized results. They return a `manual_available` or `temporarily_unavailable` source run, prepared unclassified terms, and registered official URLs. A researcher can separately record a locator found on the official site only after confirming its public, unclassified status. The locator must use HTTPS on the selected source's approved official domain and satisfy that adapter's direct record-page or record-file path rules; passing the domain allowlist alone is insufficient. Generic search-results, status, home, publications, collection, and other navigation pages remain research leads and are not admitted as primary evidence. Opstalia does not fetch the document.

## Data flow and privacy

### Information that remains in the browser

- the structured target and generated plan;
- browser-local index searches and results;
- saved records, comparison sets, annotations, audit events, and reports;
- all private-mode project state; and
- researcher corrections and judgments.

### Information that leaves the browser

- ordinary requests for GitHub Pages assets;
- a validated `NormalizedSearchQuery` sent by POST to the Worker for each selected NARA plan query: the structured target with its local notes field explicitly removed, the one generated query, result limit, optional cursor, and private-mode flag;
- only the supported search parameters constructed by the Worker and sent to the NARA Catalog API: query text and, when supplied and applicable, NAID, start/end dates, exact title, creator, geographic reference, and material type; the local notes field is not forwarded to NARA; and
- ordinary navigation requests when a researcher opens a manual adapter or official record; for a prefilled handoff, the official URL contains the prepared terms and supported filters but never the local research-notes field.

The application includes no third-party analytics, advertising, user accounts, or remote font dependency.

The notes field remains browser-local, is persisted only in non-private projects, and is excluded from Worker requests and shareable search links. The unclassified-only warning nevertheless applies to every field because the public application is not authorized for restricted information.

Private mode disables Opstalia persistence and share-link creation for the active project. It does not make a NARA query anonymous and cannot suppress infrastructure logging operated independently by GitHub, Cloudflare, or the official source.

## NARA no-storage rule

NARA API results exist in memory only. The Worker does not cache them and returns no `RawSourceRecord`. Before a project is saved or any Markdown, CSV, JSON, or printable HTML export is generated, the browser:

- removes NARA raw records; and
- replaces each NARA result with an Opstalia-generated locator containing the NAID, official URL, cautious `not_determined` release status, and researcher-created review state;
- removes API-derived metadata, digital objects, exemption detections, extracted identifiers other than the NAID, score, and match explanation; and
- removes automatic NARA-derived version-group labels, scores, and reasons while retaining an explicitly recorded researcher decision.

FRUS, ISCAP, and NDC static-index records may be retained because they are checked-in public source snapshots with build provenance.

## Official-source enforcement

`data/sources.json` is the policy registry. Each source declares its official domains. A record is eligible for primary results only when:

1. the source exists in the registry;
2. the record’s provenance adapter ID matches that source;
3. the official URL uses HTTPS and matches a registered domain; and
4. provenance contains an official record or file URL; and
5. for a researcher-entered locator from a manual source, the URL also matches
   that adapter's direct record-page or record-file path policy.

An approved hostname is necessary but not sufficient for a manual-source
locator. Generic search-results, status, home, publications, collection, and
other navigation pages are handoff or research-lead URLs, not primary release
evidence.

The Worker separately applies an outbound SSRF allowlist. NARA requests cannot choose an arbitrary upstream URL.

## Build-time source indexes

The repository ships three static indexes under `public/data/indexes/`:

| Index | Records | Build provenance |
|---|---:|---|
| FRUS | 752 documents / 3 volumes | `HistoryAtState/frus-unbound` at commit `56d9b6899758c7de95de58b48b20507a1edb9f9f` |
| ISCAP | 529 objects | Official ISCAP releases HTML plus a recorded SHA-256 |
| NDC | 121 rows | Official FY2026 Q3 XLSX plus a recorded SHA-256 |

These are deployment assets, not claims of complete repository coverage. Refresh scripts fetch official sources during a controlled development build; end-user searches do not scrape those sites at runtime.

## Release and analysis design

Release status uses a controlled vocabulary. `released_in_full` requires explicit official full-release language or a recorded researcher determination. A public digital object with no visible redaction is otherwise `not_determined`.

Ranking and version matching are deterministic. Every result score exposes positive or negative factors, and every version relationship exposes its signals. The system does not use opaque AI classification.

Redaction analysis in 1.0 consists of:

- deterministic recognition of documented exemption and release markings in available text;
- researcher correction of false detections; and
- a limited dark-region image primitive that is not represented as comprehensive image analysis.

The original official image or PDF is never altered.

## Deployment boundaries

- GitHub Pages publishes only static frontend assets and indexes.
- Cloudflare Workers publishes only the NARA proxy and health endpoint.
- `VITE_API_BASE` is public build configuration.
- `NARA_API_KEY` and `RATE_LIMIT_SALT` are Cloudflare secrets.
- `FRONTEND_ORIGIN` and `APP_ENV` are non-secret Worker variables.

The frontend can deploy without a Worker secret. NARA then reports setup/unavailable status and provides a manual Catalog link; local-index and manual-source workflows continue.

## Rejected alternatives

### Put the NARA key in Vite

Rejected because every `VITE_` value is public in the browser bundle.

### Store all projects on a public backend

Rejected because 1.0 does not require accounts or collaboration, and server persistence would create unnecessary privacy and security obligations.

### Scrape every reading room at runtime

Rejected because interfaces, robots guidance, terms, and HTML structures vary. An honest manual adapter is preferable to a brittle or impermissible integration.

### Cache NARA responses

Rejected. The 1.0 Worker explicitly disables source-response caching and the persistence layer reduces saved NARA records to generated locators.

### Connect the public build to Opstalia-c

Rejected for 1.0. No such connection is implemented or implied.
