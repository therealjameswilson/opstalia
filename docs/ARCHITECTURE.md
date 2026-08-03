# Opstalia 1.0 architecture

## Decision record

**ADR-001 — Static research workspace plus a minimal secret-bearing proxy and bounded official-file relay**

- **Status:** Accepted for 1.0
- **Date:** 2026-07-30
- **Decision:** Host a React/Vite application on GitHub Pages; keep research projects and PDF packet manifests in browser-local IndexedDB; search reproducibly pinned FRUS, ISCAP, NDC, and official NARA JFK release-file indexes in the browser; and use a narrow Cloudflare Worker registry for documented fixed-upstream APIs plus one strictly validated NARA presidential-library bounded full-file relay. PDF parsing, rendering, text-layer scanning, and beta page extraction remain in the browser.
- **Reason:** GitHub Pages provides a low-cost, reviewable public frontend, while the Worker prevents NARA and GovInfo keys from entering browser JavaScript and mediates official APIs without supported browser CORS. Live validation showed that Cloudflare's upstream fetch did not preserve useful byte-range delivery from the approved NARA media host, and no R2 bucket is enabled. The 1.0 fallback therefore admits and full-streams only narrowly validated official PDFs, with a hard 100 MiB streaming cap, for local browser parsing. Local project storage avoids creating a public user database or account system. Pinned indexes avoid brittle runtime scraping where no suitable public search API exists. Keeping PDF interpretation out of the Worker avoids an upload service, a server-side parser, and public document storage.
- **Consequence:** Worker-backed search and the PDF Packet Lab require a separately deployed Worker. NARA and GovInfo search additionally require their own server-side keys; NTRS and OSTI do not. The Packet Lab instead requires `RATE_LIMIT_SALT` for short-lived session signatures and supports only the exact NARA Catalog presidential-library media path. Static-index coverage is bounded by checked-in snapshots; the NARA JFK snapshot is filename-level and opt-in. Manual adapters remain necessary for unsupported official systems.

## Security boundary

Opstalia 1.0 is a purely unclassified application on the regular Internet.

It does not accept uploaded source documents and must not receive classified information, CUI, PII, or other restricted material. The public PDF Packet Lab can retrieve only an acknowledged, already-public NARA presidential-library packet through a narrow official locator; it is not a general document-ingestion path. Opstalia has no synchronization, connector, bridge, or route to Opstalia-c or another closed network. Future closed-network work is a separate architecture and authorization question; it is not a dormant feature in this build.

## System topology

```mermaid
flowchart LR
    U[Researcher browser]
    P[GitHub Pages<br/>React, TypeScript, Vite]
    IDB[(IndexedDB<br/>local projects + packet manifests only)]
    IDX[Same-origin static indexes<br/>FRUS 752, ISCAP 529, NDC 133, NARA JFK 2,709]
    W[Cloudflare Worker<br/>fixed adapters + signed full-file relay]
    N[NARA Catalog API v2]
    NP[NARA Catalog media<br/>presidential-libraries PDF path]
    G[GovInfo Search Service]
    S[Public STI APIs<br/>NASA NTRS and OSTI.GOV]
    M[Official manual-search sites]
    C[Opstalia-c / closed network]

    U --> P
    P <--> IDB
    P <--> IDX
    P -->|selected unclassified Worker-source query| W
    P -->|researcher-supplied NAID + canonical<br/>record/PDF locators; then bounded full stream| W
    W -->|x-api-key + supported parameters| N
    W <-->|HEAD, prefix-only probe/cancel, bounded full streams;<br/>no redirects| NP
    W -->|api key + documented search payload| G
    W -->|documented public API query| S
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
- the PDF Packet Lab's local PDF.js in-memory viewer, embedded-text scan, deterministic boundary proposals, reviewed page-range/described-item register, and browser-worker derivative export;
- exemption-code reference data;
- local project and packet-manifest storage and private mode; and
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
| PDF Packet Lab | `src/pages/PdfPacketPage.tsx` |
| PDF.js viewer and browser-worker export | `src/pdf/` |

### Cloudflare Worker

The Worker exposes:

- `GET /api/health`
- `POST /api/search/:sourceId` for the fixed IDs `nara`, `nara-cia-rg263`, `nara-state-rg59`, `govinfo`, `nasa-ntrs`, and `osti-sti`
- `POST /api/pdf/session` for admission and a short-lived signed content session
- `GET /api/pdf/content?token=…` for the admitted packet's bounded byte stream

For search routes, it:

- stores `NARA_API_KEY` and `GOVINFO_API_KEY` only as Worker secrets when those adapters are enabled;
- parses the request through a Zod schema;
- streams request bodies and rejects them above 16 KB;
- accepts JSON only;
- restricts CORS to configured frontend origins;
- dispatches only source IDs registered in `worker/src/adapters/registry.ts`;
- allows only each adapter's fixed HTTPS official API host;
- requires JSON/UTF-8 upstream responses and streams them with a 12,000,000-byte
  NARA cap or a 5,000,000-byte GovInfo/NTRS/OSTI cap;
- validates route/source identity, returned official URLs, every returned file
  URL, and source-specific file-to-record identifier binding;
- caps the API limit at 50 records;
- applies a 15-second request timeout;
- retries one transient NARA failure once with exponential backoff; GovInfo,
  NTRS, and OSTI make one timeout-bounded attempt;
- uses an in-isolate, hashed-IP rate limiter of 30 requests per minute;
- sets `Cache-Control: no-store`;
- disables Cloudflare fetch caching for upstream API calls; and
- does not log request bodies, full query strings, keys, authorization data, or IP addresses in application code.

For the PDF Packet Lab, it:

- accepts a JSON session request only after the researcher affirms that the source is public and unclassified;
- requires source ID `presidential-libraries`, a numeric NAID, a researcher-supplied record URL in the exact form `https://catalog.archives.gov/id/<NAID>` whose path repeats that numeric value, and a direct `https://catalog.archives.gov/medialz/presidential-libraries/…pdf` URL with no credentials, port, query, fragment, traversal, nested encoding, or disallowed path characters; it does not query the Catalog record or prove that the record lists the PDF;
- never accepts a file upload and never selects an arbitrary outbound host or path;
- sends a no-redirect `HEAD`, then a no-redirect full `GET`, reads only the five-byte `%PDF-` prefix, and cancels the admission body immediately; a reported length above 100 MiB is rejected, while an absent Worker-visible length or ETag is permitted;
- creates a two-hour HMAC-SHA-256 token signed with `RATE_LIMIT_SALT`; the token signs the source ID, NAID, canonical record and PDF URLs, any available ETag/last-modified validators, and expiration together to prevent tampering, not to establish the archival association;
- rejects byte-range requests and accepts exactly one declared browser purpose: opening the packet or creating a derivative;
- for opening, starts a new no-redirect `GET` and passes one complete response through to the browser, terminating the stream if more than 100 MiB arrives even when no usable `Content-Length` was visible;
- for derivative export, starts a second complete stream under a distinct three-requests-per-minute rate scope; the browser must compute the same source SHA-256 that it recorded during opening before producing a derivative;
- validates upstream status and content type plus any available length, ETag, or Last-Modified consistency before streaming the body to the browser;
- allows only the configured frontend origin and rate-limits session, view, and derivative purposes separately;
- sets `Cache-Control: no-store, private, max-age=0`, uses no application response cache or durable storage, and does not parse, OCR, transform, index, or retain the PDF; and
- does not log session bodies, full URLs or tokens, stream-purpose headers, PDF bytes, or client addresses in application code. Cloudflare and network providers may still maintain independent infrastructure telemetry.

The in-memory rate limiter is a best-effort abuse control, not a globally durable quota system. `RATE_LIMIT_SALT` must be installed as a production secret so the relay can sign sessions and the rate-limit hash material is not the checked-in fallback.

No KV, D1, Durable Object, R2 bucket, analytics service, PDF store, or response cache is used.

The browser treats the Worker response as untrusted input. It runtime-validates
the full `SourceSearchResponse`, then re-applies the selected source's
source-identity, official-domain, result/file-URL, adapter-provenance, and
source-specific record-ID binding checks. A malformed response fails the source
run, and a record that fails admission is excluded from the primary index
without preventing other sources from completing.

## Search execution

1. The browser validates an unclassified `SearchTarget`.
2. Deterministic expansion produces at most 16 editable `SearchQuery` objects.
3. The researcher chooses registry sources.
4. Sources run concurrently. Queries within each source run sequentially.
5. Worker-backed sources are capped at the first three enabled plan queries explicitly targeting that source, with 20 requested results per query. A query is eligible only when its `sourceIds` includes the source; an empty list targets no source. This protects keyed quotas and bounds public-API load.
6. Local FRUS, ISCAP, NDC, and opt-in NARA JFK release-file adapters may evaluate every enabled query targeted to that source.
7. NARA RG 263/RG 59 profiles are opt-in separate NARA Catalog sources. The returned hierarchy is checked before an RG-specific label is used, and these profiles never change the native CIA or State FOIA status.
8. Manual sources generate a local handoff worksheet. State FOIA receives a query-aware official URL; unavailable CIA receives copyable retry terms and official status/publication links.
9. Nothing opens automatically. The researcher must initiate navigation to an official manual source.
10. A query failure is isolated within its source and preserves earlier successful query results; a source failure is isolated from every other source.
11. Partial normalized results render as they arrive.
12. Per-source and cross-source deduplication runs deterministically.
13. Version candidates are grouped with explicit signals and researcher review remains authoritative.

Manual adapters never manufacture normalized results. They return a `manual_available` or `temporarily_unavailable` source run, prepared unclassified terms, and registered official URLs. A researcher can separately record a locator found on the official site only after confirming its public, unclassified status. The locator must use HTTPS on the selected source's approved official domain and satisfy that adapter's direct record-page or record-file path rules; passing the domain allowlist alone is insufficient. Generic search-results, status, home, publications, collection, and other navigation pages remain research leads and are not admitted as primary evidence. The manual-handoff path does not fetch a document; the separately gated Packet Lab can full-stream only its one approved NARA path, up to 100 MiB.

## Data flow and privacy

### Information that remains in the browser

- the structured target and generated plan;
- browser-local index searches and results;
- saved records, comparison sets, annotations, audit events, and reports;
- packet source locators, reviewed range/described-item manifests, scan counts, notes, and hashes in non-private mode;
- PDF bytes, rendered pages, and embedded page text only in transient browser memory while a packet is open;
- all private-mode project state; and
- researcher corrections and judgments.

### Information that leaves the browser

- ordinary requests for GitHub Pages assets;
- a validated `NormalizedSearchQuery` sent by POST to the Worker for each selected Worker-backed plan query: the structured target with its local notes field explicitly removed, the one generated query, result limit, optional cursor, and private-mode flag;
- only the source-specific supported parameters constructed by the Worker and sent to the selected official API. NARA receives its documented Catalog parameters and API key; GovInfo receives its documented search payload and API key; NTRS and OSTI receive documented public-API query parameters without an Opstalia source key; and
- when the researcher opens a packet, the acknowledged NAID, canonical NARA record URL, and canonical presidential-library PDF URL sent to the Worker; the Worker sends `HEAD`, starts a full `GET`, reads only the five-byte signature prefix, and cancels that admission response;
- the short-lived signed token and a packet-view request sent to the Worker, followed by one complete official PDF stream into browser memory; a derivative request later causes a second complete stream, and both streams are hard-limited to 100 MiB; and
- ordinary navigation requests when a researcher opens a manual adapter or official record; for a prefilled handoff, the official URL contains the prepared terms and supported filters but never the local research-notes field.

The application includes no third-party analytics, advertising, user accounts, or remote font dependency.

The notes field remains browser-local, is persisted only in non-private projects, and is excluded from Worker requests and shareable search links. The unclassified-only warning nevertheless applies to every field because the public application is not authorized for restricted information.

Private mode disables Opstalia persistence and share-link creation for the active project. It does not make a live query anonymous and cannot suppress infrastructure logging operated independently by GitHub, Cloudflare, or the official source.

## NARA no-storage rule

NARA API results—including `nara-cia-rg263` and `nara-state-rg59` profile results—exist in memory only. The Worker does not cache them and returns no `RawSourceRecord`. NARA normalization examines at most 200 reported digital objects per record, 100,000 OCR characters per object, and 500,000 OCR characters across the record so an unexpectedly large upstream object cannot create unbounded browser work. It exposes a digital-object locator only for a recognized direct public file on an approved `archives.gov` host. These caps and file-path rules can omit additional objects, storage locators, or OCR and therefore are not completeness claims. Before a project is saved or any Markdown, CSV, JSON, or printable HTML export is generated, the browser:

- removes NARA raw records; and
- replaces each NARA result with an Opstalia-generated locator containing the NAID, official URL, cautious `not_determined` release status, and researcher-created review state;
- removes API-derived metadata, digital objects, exemption detections, extracted identifiers other than the NAID, score, and match explanation; and
- removes automatic NARA-derived version-group labels, scores, and reasons while retaining an explicitly recorded researcher decision.

FRUS, ISCAP, NDC, and NARA JFK static-index records may be retained because they are checked-in public source snapshots with build provenance. The JFK artifact contains only official filename/RIF table metadata and NARA PDF links, not PDF text or Doctly content. GovInfo, NTRS, and OSTI public response records may be retained in browser-local projects under their declared registry policies; the Worker itself does not persist them.

The PDF Packet Lab does not relax the Catalog API no-storage rule. It does not persist Catalog API metadata or raw responses. A saved packet register contains only the researcher-supplied canonical NARA locators, any available source validators, received byte length, browser-computed source SHA-256, PDF page count, scan counts, researcher decisions, notes, and derivative hashes. PDF bytes, page canvases, thumbnails, extracted page text, and relay tokens remain out of IndexedDB and project exports. Reopening a register downloads the official source again and preserves reviewed decisions only when both the received byte length and newly computed SHA-256 match the saved source. Otherwise every non-rejected decision returns to `proposed` for re-review; an earlier researcher rejection remains recorded.

## Official-source enforcement

`data/sources.json` is the policy registry. Each source declares its official domains. A record is eligible for primary results only when:

1. the source exists in the registry;
2. the record’s provenance adapter ID matches that source;
3. the official URL uses HTTPS and matches a registered domain; and
4. provenance contains an official record or file URL; and
5. for a researcher-entered locator from a manual source, the URL also matches
   that adapter's direct record-page or record-file path policy.

Every normalized result/file URL must pass the selected source's allowlist.
GovInfo PDFs must bind to the official package/granule IDs, NTRS downloads to
the official citation ID, and OSTI full text to the official OSTI ID. NARA JFK
PDFs must use the recognized release-file path and have a decoded filename RIF
matching the normalized document number.

An approved hostname is necessary but not sufficient for a manual-source
locator. Generic search-results, status, home, publications, collection, and
other navigation pages are handoff or research-lead URLs, not primary release
evidence.

The Worker separately applies source-specific outbound SSRF allowlists. Requests cannot choose an arbitrary upstream URL or adapter ID.

Packet admission is narrower than the general official-domain allowlist. It accepts only hostname `catalog.archives.gov`, an exact `/medialz/presidential-libraries/…pdf` file path, and a researcher-supplied canonical `/id/<NAID>` record URL whose path repeats the numeric NAID in the session request. The service does not fetch the record page or independently prove that it lists the PDF. The HMAC protects the submitted canonical values from later tampering, and the content route does not accept a new upstream URL; neither control establishes an archival relationship, presence of every described item, declassification, completeness, or separate release.

## Build-time source indexes

The repository ships four static indexes under `public/data/indexes/`:

| Index | Records | Build provenance |
|---|---:|---|
| FRUS | 752 documents / 3 volumes | `HistoryAtState/frus-unbound` at commit `56d9b6899758c7de95de58b48b20507a1edb9f9f` |
| ISCAP | 529 objects | Official ISCAP releases HTML plus a recorded SHA-256 |
| NDC | 133 entries | Official FY2026 Q3 XLSX plus a recorded SHA-256; schema-version-2 parser identifies the canonical header row |
| NARA JFK release page | 2,709 official PDF rows | Official release-page HTML plus response metadata and recorded SHA-256; guarded parser preserves distinct URL variants |

These are deployment assets, not claims of complete repository coverage. Refresh scripts fetch official sources during a controlled development build; end-user searches do not scrape those sites at runtime.

The NARA JFK page currently includes a January 2026 batch while reporting
March 18, 2025 for every row. The adapter retains that inconsistency only in
raw index records for audit; it does not normalize the value as a file release
date, search it, or infer actual per-file tranche membership. It does not
ingest the unofficial Doctly Markdown corpus.

## PDF Packet Lab design

The Packet Lab is not a fifth static index and is not an automated search adapter. It is a researcher-operated workspace over one approved, already-public NARA PDF. Opening downloads one complete source through the Worker into transient browser memory, subject to a hard 100 MiB streaming cap. The browser verifies the signature, records the received length, computes SHA-256, and then gives the in-memory bytes to PDF.js. PDF.js performs page access locally with script evaluation and XFA disabled, annotations omitted from page rendering, and image/canvas work bounded; it makes no page-range requests to NARA or Cloudflare.

The scan streams at most the text already embedded on each PDF page and keeps only bounded text in memory: 50,000 characters per page, 32 Mi characters across one scan, and 5,000 pages. It does not run OCR, submit bytes or text to AI, or call another analysis service. Hitting a ceiling produces a recorded limitation and leaves later or truncated pages for manual review. Deterministic patterns can propose starts and ends for memcons, telcons, memoranda, and withdrawal/redaction sheets, but every proposal retains its reasons, confidence, and review status. Researcher rejection is preserved rather than deleting the audit trail.

The packet register separates two evidence lanes:

1. `page_range` means the specified content pages are physically present in the PDF. It is a researcher-created locator, defaults to `not_determined`, and can be corrected, confirmed, or rejected.
2. `described_item` means a withdrawal sheet, finding aid, or similar page describes an underlying item whose content pages have not been located. A researcher-created item defaults to `not_determined`; the deterministic detector proposes `withdrawal_notice_only` only when visible embedded text matches a withdrawal/redaction-sheet heading. It may record stated extent and evidence-page numbers, but it cannot carry start/end content pages or produce a derivative PDF.

Derivative generation requests a second complete source stream under a separate three-requests-per-minute scope. The relay checks any available ETag or Last-Modified value and enforces the same hard 100 MiB streaming cap. In the isolated browser Web Worker, `pdf-lib` computes the second copy's source SHA-256 and refuses export unless it matches the hash computed when the packet was opened. It then rebuilds only the confirmed page range, removes every copied page's `/AA` additional-action dictionary and `/Annots` annotation array, adds provenance metadata, and computes derivative SHA-256. The processor is cancellable and is terminated after two minutes. Because it rebuilds the file and strips active structures, the output is deliberately not byte-identical and is labeled a research derivative, not an official source file. Sources above 100 MiB are unsupported by the Packet Lab.

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
- Cloudflare Workers publishes the fixed adapter registry, health endpoint, and one signed-session NARA presidential-library bounded full-file relay; it is not a general fetch proxy, upload service, OCR service, PDF processor, or document store.
- `VITE_API_BASE` is public build configuration.
- `NARA_API_KEY`, `GOVINFO_API_KEY`, and `RATE_LIMIT_SALT` are Cloudflare secrets when installed.
- `FRONTEND_ORIGIN` and `APP_ENV` are non-secret Worker variables.

The frontend can deploy without a Worker. Local-index and manual-source workflows continue, but the Packet Lab cannot open a PDF. A deployed Worker remains useful without source API secrets because the opt-in NTRS and OSTI adapters use documented public APIs. NARA reports its missing-key status; the opt-in NARA record-group profiles and GovInfo report theirs when selected, until their respective keys are installed. Packet admission does not use `NARA_API_KEY`, but the relay remains unavailable until a production `RATE_LIMIT_SALT` of at least 16 characters is installed.

## Rejected alternatives

### Put source API keys in Vite

Rejected because every `VITE_` value is public in the browser bundle.

### Store all projects on a public backend

Rejected because 1.0 does not require accounts or collaboration, and server persistence would create unnecessary privacy and security obligations.

### Scrape every reading room at runtime

Rejected because interfaces, robots guidance, terms, and HTML structures vary. An honest manual adapter is preferable to a brittle or impermissible integration.

### Cache NARA responses

Rejected. The 1.0 Worker explicitly disables source-response caching and the persistence layer reduces saved NARA records to generated locators.

### Accept arbitrary PDFs, uploads, redirects, or server-side OCR

Rejected. The public build admits only one exact official path family and canonical NAID record locator, follows no redirects, and keeps parsing and text-layer inspection in the browser. Broad URL proxying, uploads, server-side parsing, OCR, or AI analysis would create materially different provenance, privacy, malware, resource-exhaustion, and authorization risks.

### Connect the public build to Opstalia-c

Rejected for 1.0. No such connection is implemented or implied.
