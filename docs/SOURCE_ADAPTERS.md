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

`AdapterContext` supplies an abort signal and retrieval timestamp. A `SourceSearchResponse` contains the source run, raw records where storage is permitted, normalized records, and warnings. The Worker and browser runtime-validate this response, retain the selected route/source identity, and recheck each normalized record through official-domain, result/file-URL, adapter-provenance, and source-specific record-ID binding rules before primary-index admission.

Worker adapters are registered in `worker/src/adapters/registry.ts`. The route `/api/search/:sourceId` accepts only the fixed IDs `nara`, `nara-cia-rg263`, `nara-state-rg59`, `govinfo`, `nasa-ntrs`, and `osti-sti`; it is not an arbitrary URL proxy. The four static-index adapters are isolated client functions with the same `SourceSearchResponse` boundary and are dispatched by source ID in `src/search/client.ts`.

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
- **Upstream response cap:** 12,000,000 streamed JSON bytes
- **Payload bounds:** at most 200 digital objects per normalized record, 100,000 OCR characters per object, and 500,000 OCR characters across the record
- **Caching/storage:** none

Supported target filters in the current adapter include exact NAID, dates, exact-title variant, creator, geography, and material type. The registry documents additional Catalog filters that remain candidates for later adapter expansion.

The adapter normalizes title, dates, creators, level, subjects, collection ancestry, digital objects, OCR presence, NAID, identifiers, snippets, and cautious release status where present. It exposes a digital-object link only for a recognized direct public file on an approved `archives.gov` host; other reported storage locators are omitted. It never assumes that digitization equals declassification. Payload caps and file-path rules can omit additional objects, locators, or OCR, so normalized content is not a completeness guarantee.

Required attribution:

> This product uses the National Archives Catalog API but is not endorsed or certified by the National Archives and Records Administration.

#### NARA record-group discovery profiles

The same adapter has two separate beta profiles:

- `nara-cia-rg263` fixes `recordGroupNumber=263`, `availableOnline=true`, and `typeOfMaterials=Textual Records`.
- `nara-state-rg59` fixes `recordGroupNumber=59`, `availableOnline=true`, and `typeOfMaterials=Textual Records`.

Both profiles are explicit opt-ins. They require `NARA_API_KEY`, use NARA Catalog provenance and URLs, and follow the same transient locator-only persistence policy as the general NARA adapter. An explicit matching record-group value in the returned hierarchy permits the scoped repository label; an explicit conflict rejects the hit; and a hit with no exposed group number remains labeled generic National Archives Catalog evidence with a review warning. The profiles do not search the native CIA FOIA Electronic Reading Room or Department of State FOIA Virtual Reading Room. RG 59 also omits separate Foreign Service Post holdings in RG 84. These profiles must remain separate source IDs from native `cia` and `state-foia`.

### GovInfo

- **Status:** Beta
- **Execution:** live, through the Cloudflare Worker
- **Endpoint:** documented GovInfo Search Service
- **Authentication:** server-side `GOVINFO_API_KEY`
- **Upstream response cap:** 5,000,000 streamed JSON bytes
- **Caching:** no Worker response cache

The adapter returns official package or granule metadata and a public GovInfo PDF only when its path binds to that package/granule ID. It is an official-publication discovery adapter. A result does not automatically establish that an originating agency declassified the underlying record, released it under FOIA, or released it in full.

### NASA Technical Reports Server

- **Status:** Beta
- **Execution:** live, through the Cloudflare Worker
- **Endpoint:** documented NTRS citations API
- **Authentication:** none
- **Upstream response cap:** 5,000,000 streamed JSON bytes

The adapter returns official public NASA scientific-and-technical-information metadata and only NTRS download paths bound to the official citation ID. It is separate from the planned NASA FOIA registry entry and decentralized NASA FOIA e-libraries. Public NTRS availability is not a declassification or full-release determination.

### OSTI.GOV scientific and technical information

- **Status:** Beta
- **Execution:** live, through the Cloudflare Worker
- **Endpoint:** documented OSTI.GOV API v1
- **Authentication:** none
- **Upstream response cap:** 5,000,000 streamed JSON bytes

The adapter returns official public DOE-funded scientific-and-technical-information metadata and only the full-text path bound to the official OSTI record ID. It is a separate source from manual DOE OpenNet. Opstalia does not call OpenNet's robots-disallowed search or document paths, and an OSTI result is not evidence that an OpenNet record was found or that a document was declassified or released in full.

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
- **Coverage:** exactly 133 entries
- **Build source:** official FY2026 Q3 NDC XLSX

The schema-version-2 builder locates the canonical workbook header row, retains the first data entry, and returns the official row fields, release quarter, workbook URL, page URL, and a cautious `finding_aid_only` or `described_but_not_digitized` status. These are generally series-level descriptions; completion of declassification processing does not prove online availability or the absence of other access review.

### NARA JFK assassination records — 2025 release page

- **Status:** Beta, explicit opt-in
- **Execution:** client-side, same-origin static index
- **Coverage:** 2,709 distinct official PDF rows in the current release-page snapshot
- **Build source:** `https://www.archives.gov/research/jfk/release-2025`
- **Search fields:** exact RIF, official filename, and filename suffix/variant
- **PDF content:** not fetched, mirrored, OCRed, or indexed

The guarded builder fetches the single official server-rendered page, locates
the table by its normalized headers, validates every direct PDF link, records
the source hash and response metadata, and checks the parsed row count against
NARA's declared batch total. Distinct URLs are preserved even when they share a
base RIF; a RIF alone is not a safe deduplication key.

NARA's current page contains a January 30, 2026 batch even though its title and
file paths refer to 2025. Every current row reports `03/18/2025`, so Opstalia
retains that table value only in the raw index record for audit. It is not
searched, normalized as a file release date, used for sorting or ranking, or
used to infer a true per-file batch. A filename containing `redacted` is not a
visible-redaction finding; every listed PDF remains `not_determined` until
human review.

The unofficial Doctly JFK Markdown corpus prompted a coverage comparison, but
it is not an adapter, build source, runtime dependency, text source, or release
evidence. Opstalia searches only the official NARA manifest and cites only
NARA URLs for these results.

## Manual adapters

A manual adapter returns:

- a `SourceRun` with `manual_available` or `temporarily_unavailable`;
- zero normalized records;
- the official manual-search or fallback URLs;
- prepared, copyable search terms when supported; and
- registry limitations.

### Department of State FOIA handoff

State FOIA remains `manual`. Opstalia can construct a user-initiated URL for the official `foia.state.gov/FOIALIBRARY/SearchResults.aspx` interface by mapping applicable search-plan values to the site's search terms, document-date range, sender, recipient, case number, and document-type fields.

This is navigation, not an automated source query:

- the user explicitly opens the generated official URL;
- no Opstalia backend calls the State system;
- no State results page is scraped, parsed, cached, or normalized; and
- the source run remains `manual_available` with zero records.

This design respects the site's `robots.txt`, which disallows automated access to the entire site, and the absence of a validated documented public API.

### CIA unavailable-state assistance

CIA remains `temporarily_unavailable`. During 2026-07-29 validation, the official Reading Room self-redirected and CIA.gov reported search unavailable. Opstalia therefore prepares copyable terms and exposes working official CIA resources/status and publications links along with a Reading Room retry link. It does not bypass robots restrictions, retrieve Reading Room results, or describe these fallbacks as equivalent CIA FOIA coverage.

### Recording evidence found manually

A researcher can record an official record or file URL found after a manual
handoff only after confirming that the material is unclassified and publicly
released. An approved domain is necessary but not sufficient. Version 1.2.0
accepts CIA Reading Room `/readingroom/document/…` pages or direct Reading Room
files, State FOIA `/DOCUMENTS/…` PDFs, FBI Vault `/at_download/file` locators,
and direct public record files for other manual adapters. Home, search, status,
and general publications pages cannot enter the primary evidence set. Accepted
locators carry researcher-recorded provenance and remain visibly distinct from
adapter-normalized results.

Exports and reports distinguish automated source searches, manual handoffs, and unavailable sources. A generated or opened handoff does not count as an automated search or a result found.

Native State FOIA and CIA remain manual/unavailable and are not represented as automated. Separate NARA RG 59/RG 263 profiles do not change those native-source statuses. See `SOURCE_COVERAGE.md` for the complete list.

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

Local adapters filter every complete record, page, download, thumbnail, and digital-object URL through this policy. The NARA JFK adapter additionally binds the decoded PDF filename RIF and exact release-file path to the normalized document number and official release page. Each Worker adapter separately constructs its upstream URL from a fixed constant, and the Worker route accepts only registered adapter IDs. Redirect, credential, host, port, protocol, and result-URL checks remain source-specific.

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
npm run indexes:jfk-2025
```

Or refresh all:

```bash
npm run indexes:refresh
```

The combined command waits ten seconds between `archives.gov` acquisitions to
honor NARA's published crawl-delay guidance. It never fetches each linked JFK
PDF.

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
