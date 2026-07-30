# Opstalia 1.0 data model

## Design goals

The model preserves four distinctions:

1. what an official source reported;
2. what Opstalia extracted or normalized;
3. what Opstalia inferred; and
4. what a researcher confirmed or corrected.

Unknown data remains unknown. Optional fields are not backfilled with guesses.

The authoritative TypeScript definitions are in `src/core/types.ts`. Zod schemas in `src/core/validation.ts` validate untrusted search and import boundaries.

## Provenance-bearing values

Most normalized fields use:

```ts
interface SourcedValue<T> {
  value: T;
  source: string;
  extractionMethod:
    | "source_reported"
    | "source_structured"
    | "ocr"
    | "pattern_match"
    | "algorithmic_inference"
    | "researcher_confirmed"
    | "researcher_corrected";
  confidence: number;
  researcherOverride?: {
    value: T;
    basis: string;
    timestamp: string;
  };
}
```

The original normalized value remains available when a researcher supplies an override. Display helpers choose the override without silently erasing the source-derived value.

## Core entities

### `SearchTarget`

The researcher’s structured description of the sought record. It supports guided and quick modes and includes title or subject, exact phrase, keywords, dates, agency, office, sender, recipient, document type, identifiers, geography, and local notes.

Each input field is capped at 500 characters at the validation boundary. Date ranges are checked for order.

### `SearchQuery`

One editable query variant:

- query kind;
- label and text;
- enabled state;
- target source IDs; and
- an explanation of why the variant exists.

Kinds include exact phrase, broad keyword, name variant, acronym expansion, date variant, identifier, agency variant, OCR-tolerant variant, and spelling variant.

### `SearchPlan`

Contains the target, generated queries, creation time, and an editable source-selection strategy. Deterministic generation is capped at 16 query variants.

### `Source`

Represented by `SourceDefinition` and loaded from `data/sources.json`. It records official domains, capability, API and authentication notes, rate limits, robots/terms notes, adapter status, implementation, filters, returned fields, limitations, manual fallback, optional labeled official access links, validation date, and default-selection state.

### `SourceRun`

Records one source’s operational state:

- `waiting`
- `searching`
- `complete`
- `no_results`
- `temporarily_unavailable`
- `blocked`
- `manual_available`
- `cancelled`

It also carries timestamps, result count, a human-readable message, and an optional manual-search URL. A manual run may carry a `ManualSearchHandoff` containing the prepared query text, official destination URL, applied filters, warnings, opened/completed timestamps, and researcher-recorded locator count. Its status distinguishes a prepared, opened, legacy completed, or upstream-unavailable handoff. Recording one locator does not by itself mark a source search complete.

The handoff is a browser-navigation aid, not an adapter result. State FOIA handoffs encode supported fields into the official search URL only after the researcher chooses to open it. CIA handoffs retain copyable retry terms while the official service is unavailable. Research notes are never included.

A researcher may add a manually found official locator to the normalized
project only after confirming that it is unclassified and publicly released.
The URL must match the selected source's registered HTTPS domains and a
source/path rule: CIA Reading Room document pages/files, State FOIA
`/DOCUMENTS/…` PDFs, FBI Vault downloads, or a direct public record file for
other manual adapters. Generic navigation, search, status, and publications
pages are rejected. Its field provenance is `researcher_confirmed`, its release
status begins as `not_determined`, and no document contents are fetched.

A source failure is a data point in the report, not a reason to discard other sources.

### `RawSourceRecord`

Preserves a public source payload independently from normalization when source policy permits. This permits future normalization improvements without losing build-time source evidence.

NARA is the deliberate exception: live NARA API responses are not cached, stored, or returned as raw records. Saved NARA results are reduced to generated NAID/official-URL locators.

### `NormalizedRecord`

The common result schema includes:

- internal ID;
- title and date precision;
- agency, office, sender, recipient, type, and subjects;
- source repository and collection;
- official, record-page, file, and thumbnail URLs;
- NAID, archival citation, case number, and document number;
- page count, digitization, and OCR state;
- release date, mechanism, and authority;
- controlled release status;
- visible exemption codes and release markings;
- extracted identifiers and text snippet;
- digital objects;
- provenance and retrieval time;
- deterministic match score and factors; and
- researcher review state.

Every field not supported by a source is optional. The schema does not treat missing metadata as a negative historical fact.

Imported records are structurally validated and checked against the registered official-domain allowlist, but their source provenance is not re-fetched during import. Opstalia therefore clears fixture status, marks imported provenance as not revalidated, and displays that state until a fresh source search re-creates the record.

### `DigitalObject`

An official public file or page object with URL and optional download URL, thumbnail, media type, page number, OCR text, and byte size.

Digital objects do not imply declassification or full release.

### `ReleaseEvent` and `ReleaseDetermination`

A release determination contains:

```ts
interface ReleaseDetermination {
  status: ReleaseStatus;
  determinationBasis: string;
  source: string;
  confidence: number;
  humanReview: boolean;
}
```

The controlled statuses are:

- `released_in_full`
- `released_in_part`
- `released_with_redactions_status_unclear`
- `metadata_only`
- `described_but_not_digitized`
- `withdrawal_notice_only`
- `finding_aid_only`
- `not_determined`

`released_in_full` requires explicit official full-release language or a researcher determination recorded with a basis. The mere absence of visible redactions produces `not_determined`, not full release.

### `ReleaseMarking`

Stores the visible text, optional canonical code and system, page, whether span length is known, confidence, detection method, false-positive state, and researcher note.

An unmatched marking remains “Unrecognized or ambiguous release marking.”

### `ExemptionCode`

Loaded from the versioned `data/exemption-codes.json` dictionary. Each entry includes aliases, system, short and detailed definitions, authority, official citation URL, verification date, notes, and an agency-variation flag.

### `VersionRelationship`

Connects two records with:

- a controlled label;
- a 0–100 relationship score;
- explicit reasons; and
- an optional researcher override with basis and timestamp.

Labels are:

- `confirmed_same_document`
- `probable_version`
- `possible_version`
- `related_record`
- `insufficient_evidence`

Only a strong identifier plus a high deterministic score can produce an automatic `confirmed_same_document` label. Researchers can override the relationship in the comparison workspace.

### `VersionGroup`

Contains record IDs, pairwise relationships, review state, optional best-public-copy ID, and notes. The review states are awaiting review, confirmed, and split.

### `Comparison`

Stores selected record IDs, manual page alignment, notes, and timestamps. Actual official files remain at their source URLs.

### `ResearchNote`

A browser-local note optionally attached to a record or version group.

### `AuditEvent`

Records an Opstalia or researcher action, timestamp, affected ID, and basis. This is a local research audit trail, not a security log or agency record.

### `SearchProject`

The aggregate root:

```text
SearchProject
├── SearchTarget
├── SearchPlan
│   └── SearchQuery[]
├── SourceRun[]
├── RawSourceRecord[]
├── NormalizedRecord[]
│   ├── DigitalObject[]
│   ├── ReleaseMarking[]
│   └── ResearchReview
├── VersionGroup[]
│   └── VersionRelationship[]
├── Comparison[]
├── ResearchNote[]
└── AuditEvent[]
```

It also stores saved-record IDs, private-mode state, and an optional fixture flag.

## Record provenance

Every normalized record has:

```ts
interface ProvenanceRecord {
  adapterId: string;
  sourceId: string;
  officialDomain: string;
  officialRecordUrl: string;
  retrievalTimestamp: string;
  rawRecordId?: string;
  normalizationVersion: string;
  fixture?: boolean;
}
```

Primary-result admission verifies that:

- the source is registered;
- `adapterId` matches the source;
- the official URL uses a registered HTTPS domain; and
- the provenance contains an official record or file URL.

Fixture provenance is visibly labeled and still must pass the same source-domain policy.

## Raw and normalized separation

For the static indexes, a `RawSourceRecord` retains the exact indexed object used during that search and the normalized record points back through `rawRecordId`.

Normalization is intentionally lossy only at the display layer; the checked-in source index remains available for reprocessing. A normalization version identifies the transformation.

For NARA:

- the Worker returns normalized transient results and no raw payload;
- the project sanitizer removes any NARA raw record before IndexedDB storage;
- all report and project exporters call the same sanitizer before creating a download or copyable report;
- the durable result is an Opstalia-generated locator with no API-derived metadata, score, or match explanation, not cached NARA content; and
- a later live search is required to rehydrate current metadata.

## Persistence

The IndexedDB database is `opstalia-v1-research`, version 1:

| Store | Key | Purpose |
|---|---|---|
| `projects` | project ID | Non-private projects, indexes by `updatedAt` |
| `preferences` | preference key | Browser-local UI preferences |

Private-mode projects are never written. Closing or reloading the tab discards their in-memory state.

“Clear all local data” clears both namespaced stores. Researchers should export JSON before clearing browser storage.

## Import and export

Project JSON is labeled `opstalia-project-1.0`. Import:

- rejects files larger than 20 MB;
- parses JSON;
- deeply validates nested record, provenance, relationship, review, and project
  structures as well as collection-size bounds;
- creates a new imported project ID;
- checks source identifiers and all result/file URLs against the registry;
- clears fixture claims and marks imported provenance as not revalidated;
- rejects a mismatch between the displayed target and the search-plan target;
- regenerates manual handoff terms, filters, URLs, and current availability from
  the validated plan and source registry instead of trusting imported links;
- reconciles source counts against imported normalized records;
- preserves private-mode state and opens private imports in memory without
  persistence; and
- does not fetch arbitrary URLs during import.

The importer does not authenticate provenance or re-fetch source records.
Treat imported files as untrusted research data even after structural and
official-domain validation, and retain the visible import warning until a
fresh source run re-creates the record.

Markdown reports separate source facts, extraction, inference, unknown information, and researcher judgment through an evidence legend. CSV export neutralizes spreadsheet formula prefixes. Printable HTML escapes source text before embedding it.

## Runtime validation

Zod validates:

- guided and quick search targets;
- Worker NARA request bodies; and
- imported project envelopes and collection limits.

The Worker also enforces content type, a 16 KB request-body limit, query length, source-ID count, cursor length, and result limit.

TypeScript strict mode protects internal compile-time contracts. Runtime schemas remain the authority at trust boundaries.
