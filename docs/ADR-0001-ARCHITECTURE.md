# ADR-0001: Public Static Frontend, Narrow Secret-Bearing Worker, and Registry-Based Source Adapters

- **Status:** Accepted
- **Date:** 2026-07-29
- **Decision scope:** Opstalia 1.0

## Context

Opstalia must search multiple official U.S. Government repositories while remaining an independent, privacy-minimizing, open-source application suitable for GitHub Pages. The NARA Catalog API requires a key that cannot be exposed in browser JavaScript. Other repositories differ widely: some have stable public data, some publish tables or workbooks, and some prohibit automated search paths or provide no documented API.

The product must also preserve a strict security boundary. Opstalia 1.0 is purely unclassified and operates on the regular public Internet. It is not authorized for classified, controlled unclassified, personally identifiable, or otherwise restricted information. It must not create an apparent route into a future closed-network system.

Finally, a government-hosted digital object is not automatically evidence of release in full. The architecture must preserve source provenance, separate extraction from inference, and support human review instead of hiding judgments behind an opaque model.

## Decision

### 1. Deploy a static public research application

The frontend is a React and TypeScript single-page application built with Vite and deployed on GitHub Pages. It uses accessible semantic HTML, local static data, and IndexedDB. Version 1.0 has no user accounts, third-party analytics, or public multi-user database.

This application is expressly an unclassified public-Internet system. The UI requires acknowledgment of the unclassified-use notice before search-plan generation or execution.

### 2. Use a narrow Cloudflare Worker only where a server secret is required

The Cloudflare Worker exposes a health route and the NARA search route. `NARA_API_KEY` is installed through Wrangler secrets and is never returned, logged by application code, placed in a `VITE_` variable, or committed.

The Worker:

- accepts bounded, runtime-validated JSON;
- sends requests only to a fixed approved NARA host;
- restricts CORS to the production frontend and explicit development origins;
- applies a request-size limit, timeout, bounded retry, and best-effort rate limit;
- normalizes errors and redacts common secret forms; and
- sends no-store response headers.

The Worker is not a general URL fetcher or scraping proxy.

### 3. Apply NARA's no-cache/no-storage rule structurally

NARA's [Catalog API terms](https://www.archives.gov/research/catalog/help/api) currently direct API users not to cache or store returned content and impose a default 10,000-query monthly limit per key.

Therefore:

- the Worker does not cache NARA responses;
- the NARA adapter produces no persistent raw-response record;
- live NARA results remain memory-only;
- browser persistence converts a NARA result into a generated NAID/official-URL locator plus researcher-created review state; and
- later metadata refresh requires another live NARA request.

This is an intentional exception to the general model in which raw source records are stored separately from normalized records.

### 4. Search appropriate official datasets in the browser

FRUS, ISCAP, and NDC use checked-in static indexes generated during controlled source-refresh operations. Runtime search occurs in the browser, avoiding brittle runtime scraping and allowing ordinary application CI and deployment to remain independent of government-site availability.

The 1.0 FRUS index is explicitly partial: 752 documents from `frus1981-88v03`, `frus1981-88v05`, and `frus1981-88v06`, generated at pinned commit `56d9b6899758c7de95de58b48b20507a1edb9f9f`. No architecture or UI text may imply complete FRUS-series coverage.

ISCAP and NDC indexes are labeled beta because their upstream table and workbook structures can change and because their entries do not necessarily represent item-level full releases.

### 5. Prefer manual adapters to undocumented or prohibited automation

Every source lives in a data-driven registry containing official domains, capability, terms and robots notes, method, filters, limitations, manual URL, status, and validation date.

When a source lacks a stable permissible interface, Opstalia presents a first-class official manual-search link and accurately reports that no normalized automated results were returned. CIA is temporarily unavailable for automation in 1.0; many other sources are manual.

### 6. Enforce official provenance before indexing evidence

Primary evidence is admitted only when:

1. its HTTPS hostname matches the source's configured official-domain allowlist;
2. provenance identifies the matching registered adapter; and
3. an official record or file URL exists.

Outbound Worker URLs use a separate fixed-host SSRF allowlist. Unofficial mirrors, leaked or hacked material, media caches, personal sites, commercial or crowdsourced repositories, social-media uploads, and anonymous file hosts are excluded from primary evidence.

### 7. Preserve data layers and researcher authority

The normalized TypeScript model records field values with source, extraction method, confidence, and optional researcher override. Raw permissible source records are kept separately from normalized records.

The UI and exports distinguish:

- source-reported facts;
- Opstalia-extracted or normalized data;
- deterministic algorithmic inference;
- researcher confirmation or correction; and
- unknown or unavailable information.

Researcher overrides supplement rather than erase source provenance.

### 8. Use deterministic, explainable analysis

Query expansion, result scoring, deduplication, version relationships, textual diffs, release-status rules, and release-marking detection are deterministic. The application exposes score factors and relationship reasons. No paid AI API is required, and no model is permitted to claim that it can determine classification.

Release status uses a controlled vocabulary. `released_in_full` is assigned only from explicit official full-release language, official full-release metadata, or a documented researcher decision. A public object with no visible black box defaults to a cautious status.

### 9. Keep ordinary CI offline and isolate source refresh

Lint, type, unit, integration, security, build, and browser tests use checked-in public fixtures and indexes. Ordinary pull-request CI does not require a NARA key or live government source.

Index refreshes are explicit manual or scheduled operations. They validate upstream structure and minimum counts, record hashes or pinned commits, and produce reviewable generated-file diffs. Government-source downtime or schema drift must fail the refresh visibly without breaking unrelated builds or silently replacing a known-good index.

Frontend deployment is independent of backend-secret readiness. A frontend build without `NARA_API_KEY` remains deployable and reports NARA as temporarily unavailable with a manual link; backend deployment occurs only after required secrets are installed.

### 10. Do not connect to Opstalia-c

Opstalia 1.0 contains no synchronization code, connector, bridge, shared storage, automated transfer, or network route to **Opstalia-c**. Documentation of a possible future local analyst mode is design-only and disabled in the public build.

Any future closed-network relationship requires a new ADR, separate deployment and authorization boundaries, explicit information-security approval, a data-transfer policy, and testing inside the authorized environment. It is not an incremental feature flag for this architecture.

## Consequences

### Benefits

- Static hosting keeps the public application inexpensive, inspectable, and resilient.
- The NARA key remains server-side without creating a general-purpose backend.
- Browser-local indexes allow fast federated searching without runtime scraping.
- Manual adapters make coverage honest when automation is not supportable.
- Registry-based allowlists and provenance make official-source admission auditable.
- IndexedDB supports personal research without user accounts or server-side notes.
- Deterministic analysis is explainable and correctable.
- The Opstalia-c boundary is explicit in code, deployment, and documentation.

### Tradeoffs

- NARA search is unavailable until the Worker and secret are configured.
- NARA results cannot be cached or fully restored from a saved project under current terms.
- Static indexes become stale and require controlled refreshes.
- The partial FRUS index and beta ISCAP/NDC indexes provide useful but non-exhaustive coverage.
- Manual sources require researchers to leave Opstalia and record findings themselves.
- Browser storage provides no cross-device synchronization, collaboration, or managed backup.
- Deterministic matching and marking detection miss relationships that a human may recognize.
- Best-effort Worker rate limiting is not a durable global quota system.

## Alternatives considered

### Put the NARA key in the frontend

Rejected because every Vite frontend variable is recoverable by the public and network requests would expose the key.

### Build a centralized scraper and persistent search database

Rejected for version 1.0 because it would increase privacy exposure, operational cost, terms and robots risk, stale-data risk, and attack surface. It would also encourage the false impression of exhaustive government coverage.

### Clone and rename NARA Scout

Rejected because Opstalia requires a broader normalized data model, modular source registry, version comparison, release-status analysis, and an explicit official-evidence gate. NARA Scout remains a separate specialized project.

### Use an AI API for query generation, matching, or classification

Rejected as a default because deterministic rules are sufficient for the baseline, easier to audit, require no paid service or additional secret, and do not suggest that a model can determine classification.

### Add accounts and cloud project storage

Rejected because personal browser-local projects meet the version 1.0 need with less privacy and security risk.

### Synchronize with Opstalia-c

Rejected for version 1.0 because a public-Internet application must not imply or create a route to a future closed-network environment. Such a system requires a separate authorization and security design.
