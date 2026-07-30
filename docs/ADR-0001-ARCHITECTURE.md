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

### 2. Use a narrow fixed-adapter Cloudflare Worker

The Cloudflare Worker exposes a health route and `/api/search/:sourceId` only for IDs in a checked-in adapter registry. It serves NARA Catalog, two NARA record-group profiles, GovInfo, NASA NTRS, and OSTI.GOV. `NARA_API_KEY` and `GOVINFO_API_KEY` are installed through Wrangler secrets when needed and are never returned, logged by application code, placed in a `VITE_` variable, or committed. NTRS and OSTI require no application source key but still use the Worker for fixed-upstream validation, CORS mediation, bounded execution, and consistent normalization.

The Worker:

- accepts bounded, runtime-validated JSON;
- dispatches only registered source IDs and sends requests only to each adapter's fixed approved official API host;
- restricts CORS to the production frontend and explicit development origins;
- streams request bodies with a 16 KiB limit and upstream JSON responses with a
  12,000,000-byte NARA limit or 5,000,000-byte GovInfo/NTRS/OSTI limit;
- applies a timeout and best-effort rate limit; NARA alone retries one transient
  upstream failure once;
- normalizes errors and redacts common secret forms; and
- sends no-store response headers.

The Worker is not a general URL fetcher or scraping proxy.

The browser does not trust normalized Worker output merely because it crossed
that boundary. It runtime-validates the complete response and re-applies the
selected source's source-identity, official-domain, result/file-URL,
adapter-provenance, and source-specific record-ID binding rules before records
enter the primary index. The Worker applies the same result admission rules
before returning the response.

### 3. Apply NARA's no-cache/no-storage rule structurally

NARA's [Catalog API terms](https://www.archives.gov/research/catalog/help/api) currently direct API users not to cache or store returned content and impose a default 10,000-query monthly limit per key.

Therefore:

- the Worker does not cache NARA responses;
- the NARA adapter produces no persistent raw-response record;
- live NARA results remain memory-only;
- browser persistence converts a NARA result into a generated NAID/official-URL locator plus researcher-created review state; and
- later metadata refresh requires another live NARA request.

This is an intentional exception to the general model in which raw source records are stored separately from normalized records.

The same rule applies to the opt-in `nara-cia-rg263` and `nara-state-rg59` profiles because they are NARA Catalog API searches. Their separate source IDs prevent NARA-held records from being reported as native CIA or State FOIA results. Explicit returned hierarchy is checked before an RG-specific repository label is used: a conflict is rejected, while absent group data remains generic NARA evidence. NARA normalization examines at most 200 reported digital objects, 100,000 OCR characters per object, and 500,000 OCR characters total; it exposes only recognized direct public files on approved `archives.gov` hosts. These resource and file-path limits may truncate upstream content.

### 4. Search appropriate official datasets in the browser

FRUS, ISCAP, NDC, and the opt-in NARA JFK release-file manifest use checked-in static indexes generated during controlled source-refresh operations. Runtime search occurs in the browser, avoiding brittle runtime scraping and allowing ordinary application CI and deployment to remain independent of government-site availability.

The 1.0 FRUS index is explicitly partial: 752 documents from `frus1981-88v03`, `frus1981-88v05`, and `frus1981-88v06`, generated at pinned commit `56d9b6899758c7de95de58b48b20507a1edb9f9f`. No architecture or UI text may imply complete FRUS-series coverage.

ISCAP and NDC indexes are labeled beta because their upstream table and workbook structures can change and because their entries do not necessarily represent item-level full releases. The current NDC schema-version-2 index contains 133 FY2026 Q3 entries; its builder identifies the canonical workbook header row rather than inferring a header from a data row.

The NARA JFK index is also beta. Its guarded builder reads only the official
NARA table and emits filename/RIF metadata plus official NARA PDF links. The
current page includes a 2026 batch while reporting the same March 18, 2025
value for every row, so the adapter retains that value only in raw index
records and does not expose it as a normalized file release date or infer
actual per-file batch membership. Unofficial Doctly conversions are excluded
from build inputs and evidence.

### 5. Add documented public APIs only with corpus-specific caveats

GovInfo, NASA NTRS, and OSTI.GOV are beta automated adapters with fixed official upstreams and recorded fixtures:

- GovInfo requires server-side `GOVINFO_API_KEY` and provides official-publication discovery.
- NTRS requires no application key and provides NASA scientific-and-technical-information discovery, not unified NASA FOIA coverage.
- OSTI.GOV requires no application key and provides DOE-funded scientific-and-technical-information discovery, not DOE OpenNet coverage.

None of these source types automatically establishes declassification, FOIA release, authenticity, completeness, or release in full.

Their public file paths are admitted only when bound to the official record
identifier: GovInfo package/granule, NTRS citation, or OSTI record ID.

### 6. Prefer manual adapters to undocumented or prohibited automation

Every source lives in a data-driven registry containing official domains, capability, terms and robots notes, method, filters, limitations, manual URL, status, and validation date.

When a source lacks a stable permissible interface, Opstalia presents a first-class official manual-search link and accurately reports that no normalized automated results were returned. The native CIA Reading Room remains temporarily unavailable, and native State FOIA remains manual. NARA RG 263 and RG 59 profiles are separate NARA Catalog sources and do not change those native statuses.

### 7. Enforce official provenance before indexing evidence

Primary evidence is admitted only when:

1. its HTTPS hostname matches the source's configured official-domain allowlist;
2. provenance identifies the matching registered adapter; and
3. an official record or file URL exists.

Outbound Worker URLs use a separate fixed-host SSRF allowlist. Unofficial mirrors, leaked or hacked material, media caches, personal sites, commercial or crowdsourced repositories, social-media uploads, and anonymous file hosts are excluded from primary evidence.

### 8. Preserve data layers and researcher authority

The normalized TypeScript model records field values with source, extraction method, confidence, and optional researcher override. Raw permissible source records are kept separately from normalized records.

The UI and exports distinguish:

- source-reported facts;
- Opstalia-extracted or normalized data;
- deterministic algorithmic inference;
- researcher confirmation or correction; and
- unknown or unavailable information.

Researcher overrides supplement rather than erase source provenance.

### 9. Use deterministic, explainable analysis

Query expansion, result scoring, deduplication, version relationships, textual diffs, release-status rules, and release-marking detection are deterministic. The application exposes score factors and relationship reasons. No paid AI API is required, and no model is permitted to claim that it can determine classification.

Release status uses a controlled vocabulary. `released_in_full` is assigned only from explicit official full-release language, official full-release metadata, or a documented researcher decision. A public object with no visible black box defaults to a cautious status.

### 10. Keep ordinary CI offline and isolate source refresh

Lint, type, unit, integration, security, build, and browser tests use checked-in public fixtures and indexes. Ordinary pull-request CI does not require source API keys or live government sources.

Index refreshes are explicit manual or scheduled operations. They validate upstream structure and minimum counts, record hashes or pinned commits, and produce reviewable generated-file diffs. Government-source downtime or schema drift must fail the refresh visibly without breaking unrelated builds or silently replacing a known-good index.

Frontend deployment is independent of Worker and source-secret readiness. Without a Worker URL, Worker-backed sources report setup status while static and manual workflows remain available. A deployed Worker is useful without source API keys because NTRS and OSTI require none; NARA and GovInfo report their respective missing-key states until configured.

### 11. Do not connect to Opstalia-c

Opstalia 1.0 contains no synchronization code, connector, bridge, shared storage, automated transfer, or network route to **Opstalia-c**. Documentation of a possible future local analyst mode is design-only and disabled in the public build.

Any future closed-network relationship requires a new ADR, separate deployment and authorization boundaries, explicit information-security approval, a data-transfer policy, and testing inside the authorized environment. It is not an incremental feature flag for this architecture.

## Consequences

### Benefits

- Static hosting keeps the public application inexpensive, inspectable, and resilient.
- NARA and GovInfo keys remain server-side without creating a general-purpose backend.
- The fixed Worker registry supports documented public APIs without becoming a user-directed fetch proxy.
- Browser-local indexes allow fast federated searching without runtime scraping.
- Manual adapters make coverage honest when automation is not supportable.
- Registry-based allowlists and provenance make official-source admission auditable.
- IndexedDB supports personal research without user accounts or server-side notes.
- Deterministic analysis is explainable and correctable.
- The Opstalia-c boundary is explicit in code, deployment, and documentation.

### Tradeoffs

- Worker-backed search is unavailable until a Worker URL is configured.
- NARA and GovInfo are independently unavailable until their respective source keys are configured; NTRS and OSTI do not require source keys.
- NARA results cannot be cached or fully restored from a saved project under current terms.
- Static indexes become stale and require controlled refreshes.
- The partial FRUS index and beta ISCAP/NDC/NARA-JFK/API adapters provide useful but non-exhaustive coverage.
- Manual sources require researchers to leave Opstalia and record findings themselves.
- Browser storage provides no cross-device synchronization, collaboration, or managed backup.
- Deterministic matching and marking detection miss relationships that a human may recognize.
- Best-effort Worker rate limiting is not a durable global quota system.

## Alternatives considered

### Put source API keys in the frontend

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
