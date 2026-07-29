# Source adapters

## Principle

An adapter may normalize a record only when it comes from an approved official U.S. Government domain and carries adapter provenance plus an official record or file URL.

When no stable, documented, and permissible automated interface exists, Opstalia uses a first-class manual adapter. It does not substitute brittle scraping or claim that opening a search page produced normalized results.

## Registry

`data/sources.json` is the canonical source registry and domain allowlist. Each entry contains:

- source ID and display name;
- agency;
- approved official domains;
- description;
- search capability;
- API availability;
- authentication requirements;
- rate-limit information;
- robots and terms notes;
- adapter status;
- implementation method;
- supported filters;
- fields returned;
- known limitations;
- official manual-search fallback;
- last validation date; and
- whether the source is selected by default.

Status and capability are separate:

- capability: `automated`, `manual`, or `planned`;
- status: `integrated`, `beta`, `manual`, `temporarily_unavailable`, `planned`, or `retired`.

The user interface derives coverage counts directly from the registry.

## Backend contract

The Worker contract is defined in `worker/src/adapters/types.ts`:

```ts
interface SourceAdapter<RawRecord = unknown> {
  id: string;
  name: string;
  search(
    query: NormalizedSearchQuery,
    context: AdapterContext
  ): Promise<SourceSearchResponse>;
  normalize(
    rawRecord: RawRecord,
    query: NormalizedSearchQuery,
    context: AdapterContext
  ): NormalizedRecord[];
  healthCheck(): Promise<SourceHealth>;
}
```

`AdapterContext` supplies an abort signal and retrieval timestamp. A `SourceSearchResponse` contains the source run, raw records where storage is permitted, normalized records, and warnings.

The NARA adapter implements this interface. The three static-index adapters are isolated client functions with the same `SourceSearchResponse` boundary; they are dispatched by source ID in `src/search/client.ts`.

## Implemented automated adapters

### National Archives Catalog

- **Status:** Integrated
- **Execution:** Live, through the Cloudflare Worker
- **Endpoint:** `https://catalog.archives.gov/api/v2/records/search`
- **Authentication:** server-side `NARA_API_KEY` sent as `x-api-key`
- **Outbound allowlist:** `catalog.archives.gov`
- **Runtime query limit:** 20 results requested by the client, maximum 50 accepted by the Worker
- **Plan cap:** first three enabled NARA-targeted query variants
- **Timeout:** 15 seconds
- **Retry:** one retry for 429 and selected 5xx responses
- **Caching/storage:** none

Supported target filters in the current adapter include exact NAID, dates, exact-title variant, creator, geography, and material type. The registry documents additional Catalog filters that remain candidates for later adapter expansion.

The adapter normalizes title, dates, creators, level, subjects, collection ancestry, digital objects, OCR presence, NAID, identifiers, snippets, and cautious release status where present. It never assumes that digitization equals declassification.

Required attribution:

> This product uses the National Archives Catalog API but is not endorsed or certified by the National Archives and Records Administration.

### Office of the Historian / FRUS

- **Status:** Integrated
- **Execution:** client-side, same-origin static index
- **Coverage:** exactly 752 documents in three volumes
- **Volumes:** `frus1981-88v03`, `frus1981-88v05`, `frus1981-88v06`
- **Build source:** official Office of the Historian `HistoryAtState/frus-unbound` project
- **Pinned commit:** `56d9b6899758c7de95de58b48b20507a1edb9f9f`

The adapter returns volume, document number, title, date, persons, repository, collection, archival identifier, document type, authors, recipients, source note, official URL, and a bounded text snippet when present.

FRUS is an official edited publication, not necessarily a facsimile of the underlying record. A TEI editorial omission is not automatically treated as an archival redaction.

### ISCAP releases

- **Status:** Beta
- **Execution:** client-side, same-origin static index
- **Coverage:** exactly 529 objects
- **Build source:** official NARA ISCAP releases table

The adapter returns title, document date, agency, archival location, appeal number, release date, official object URL, and releases-page URL. A linked PDF is not automatically classified as released in full. An affirmed decision may have a notification only.

### National Declassification Center release lists

- **Status:** Beta
- **Execution:** client-side, same-origin static index
- **Coverage:** exactly 121 rows
- **Build source:** official FY2026 Q3 NDC XLSX

The adapter returns the official row fields, release quarter, workbook URL, page URL, and a cautious `finding_aid_only` or `described_but_not_digitized` status. These are generally series-level descriptions; completion of declassification processing does not prove online availability or the absence of other access review.

## Manual adapters

A manual adapter returns:

- a `SourceRun` with `manual_available` or `temporarily_unavailable`;
- zero normalized records;
- the official manual-search URL; and
- registry limitations.

CIA is `temporarily_unavailable` because validation encountered an unreliable redirect loop. State FOIA and the other manual sources are not represented as automated. See `SOURCE_COVERAGE.md` for the complete list.

## Search orchestration

Sources execute concurrently. Query variants within each source execute sequentially. Each source reports progress independently, and task-level errors are converted into that source’s run status. A failure or abort in one source does not erase results already returned by another source.

Records are deduplicated by source, primary identifier or NAID, and official record URL. The highest-scoring duplicate survives.

Local index matching:

- lowercases and tokenizes source text;
- treats quoted or exact-phrase queries as substring searches; and
- otherwise requires at least 55 percent of query tokens, with a minimum of one match.

This is a discovery heuristic, not an assertion that the result is the sought document.

## Official-domain enforcement

`validatePrimaryEvidence` in `src/security/url-policy.ts` checks:

1. registry membership;
2. adapter/provenance agreement;
3. HTTPS;
4. exact or subdomain match against the source’s official domains; and
5. an official provenance URL.

Local adapters filter every result through this policy. The NARA Worker separately constructs its upstream URL from a fixed constant and rejects other hosts, credentials, ports, or protocols.

Do not add a broad domain merely to make a result pass. Add only domains controlled by or officially authenticated for the registered source.

## Adding an automated source

1. **Validate the interface.** Record the official endpoint, documentation, authentication, terms, robots guidance, rate limits, response fields, and a manual fallback.
2. **Add the registry entry.** Start as `beta` unless the interface and normalization have been exercised with representative fixtures.
3. **Choose execution location.**
   - Use the Worker when a secret, CORS mediation, strict upstream control, or rate limiting is required.
   - Use a checked-in index when an official source is suitable for controlled build-time acquisition but not stable runtime search.
   - Use a manual adapter when neither path is reliable and permissible.
4. **Preserve provenance.** Keep the raw public record separately when policy permits and assign a normalization version.
5. **Normalize cautiously.** Every supported field should identify its source, extraction method, and confidence.
6. **Apply the allowlist.** Reject non-HTTPS, unregistered, mismatched, or unofficial result URLs.
7. **Handle failures.** Return source-specific zero-result, unavailable, blocked, rate-limit, timeout, and manual-fallback states.
8. **Test recorded fixtures.** Do not make every CI run depend on a live upstream.
9. **Document coverage.** State exactly what is searched, what is not, snapshot date or commit, and known gaps.

Never mark an adapter “integrated” solely because a manual page opens.

## Refreshing static indexes

Run one builder:

```bash
npm run indexes:frus
npm run indexes:iscap
npm run indexes:ndc
```

Or refresh all:

```bash
npm run indexes:refresh
```

The builders require network access to official public sources. Review:

- record count;
- official-domain validity;
- source commit or SHA-256;
- schema changes;
- added and removed records;
- limitations; and
- generated diff size.

Do not silently accept a dramatic count change. Treat it as a potential upstream-schema or parser failure until investigated.

## Test expectations

An adapter should have recorded-fixture tests for:

- representative normalization;
- zero results;
- malformed upstream data;
- timeouts;
- 429 responses;
- partial federated failure;
- duplicate records;
- conflicting metadata;
- official-domain rejection;
- provenance preservation; and
- secret and error-message redaction.

Live smoke tests are useful before deployment but should not be the default CI dependency or consume quota on every pull request.
