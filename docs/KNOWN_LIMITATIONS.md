# Known Limitations

This document describes the boundaries of Opstalia 1.0 as implemented on August 3, 2026. These are product constraints, not promises of future access.

## Security and network boundary

Opstalia 1.0 is an **unclassified application on the regular public Internet**. It is not authorized to receive or process classified information, controlled unclassified information, personally identifiable information, or other restricted material.

The public build has no source-document upload workflow. The beta PDF Packet Lab retrieves only an acknowledged, already-public NARA Catalog presidential-library PDF from one exact official path; this does not authorize the use of a document or annotation whose handling status is uncertain. Opstalia cannot determine whether information is classified, and classification is not removed by OCR, transcription, paraphrase, summarization, or metadata extraction.

There is no synchronization, connector, bridge, shared database, or network route between Opstalia 1.0 and **Opstalia-c**. A possible future closed-network system is outside the version 1.0 authorization and deployment boundary.

## Coverage is not exhaustive

Opstalia searches its current registry of supported official repositories. It does not search every government website, every archival description, every digitized object, every FOIA release, or every physical holding.

An absent result does not establish that a record was never released. Official search systems may be incomplete, unindexed, temporarily unavailable, metadata-only, or divided among agency components and presidential libraries. A document may be declassified but not digitized or publicly available online.

Registry status reflects validation performed through 2026-07-30; it is not continuous monitoring. Agency URLs, schemas, terms, robots directives, and search behavior can change after that date.

## Automated source coverage

### National Archives Catalog

NARA search requires a deployed Cloudflare Worker with `NARA_API_KEY`. Without that secret and a configured public Worker URL, the application provides an official manual Catalog link but cannot run normalized live NARA searches.

NARA's [Catalog API terms](https://www.archives.gov/research/catalog/help/api) currently say not to cache or store returned content and set a default limit of 10,000 queries per month per API key. Consequently:

- live NARA responses and metadata remain transient in memory;
- no raw NARA source response is stored in a project;
- a saved NARA result is reduced to a generated NAID/official-URL locator plus researcher-created review data; and
- reopening a saved locator does not reproduce the earlier API metadata without a new live search.

The orchestrator runs at most three generated NARA queries per source run, with up to 20 results per query in the current UI. NARA normalization also accepts at most 200 digital objects per record, 100,000 OCR characters per object, and 500,000 OCR characters across the record. These controls bound quota and payload work but can omit lower-ranked hits, additional objects, or OCR; they are not completeness claims. Catalog digitization metadata is not proof of declassification or full release.

The Worker's rate limiter is best-effort and isolate-local; it is not a globally durable quota service. NARA's own per-key limit remains controlling.

The optional `nara-cia-rg263` and `nara-state-rg59` beta profiles use this same API and persistence boundary. They send fixed available-online textual filters for RG 263 and RG 59 respectively. Explicit returned hierarchy must agree before Opstalia applies an RG-specific repository label; a hit with no returned group number remains generic NARA evidence and requires review. They do not search the native CIA or State FOIA reading rooms, do not include every agency-related record, and do not establish that a result was released through a particular mechanism. The RG 59 profile also excludes separate RG 84 Foreign Service Post holdings.

### PDF Packet Lab (beta)

The Packet Lab is not a presidential-library search engine, a scraper, a PDF upload tool, or a general official-file proxy. Version 1.0 accepts only:

- a numeric NARA NAID;
- a researcher-supplied canonical `https://catalog.archives.gov/id/<NAID>` record URL whose numeric path repeats the submitted NAID; and
- a direct PDF under `https://catalog.archives.gov/medialz/presidential-libraries/`.

The session validator does not independently query or fetch the Catalog record to prove that the media object is listed there. It validates the canonical URL/NAID form, restricts the PDF to the exact official path family, probes the live PDF, and signs the submitted values together against tampering. The signature is not association evidence. Researchers must verify the researcher-supplied relationship on the controlling NARA record page.

Admission requires an accepted PDF content type and a valid `%PDF-` signature on the exact approved NARA path; redirects are rejected. The Worker sends `HEAD`, then starts a full `GET`, reads only the five-byte signature prefix, and cancels that admission response. NARA or Cloudflare may omit a Worker-visible length or ETag. A reported size above 100 MiB is rejected, and the later content stream is terminated if it crosses the hard 100 MiB limit. A NARA outage, changed path, inconsistent headers, a malformed PDF, or a browser/relay timeout can prevent access even when the file opens through ordinary navigation.

Opening a packet downloads the complete validated source through Cloudflare into browser memory before PDF.js can parse and slice it locally. The browser verifies the received signature, records actual byte length, and computes SHA-256. A large or structurally complex PDF can therefore be slow, exhaust device memory, fail in PDF.js, or make an all-page text scan impractical. Mobile browsers and low-memory devices may fail well below 100 MiB. The ceiling is an application safety limit, not a completeness promise or Cloudflare platform maximum.

The deterministic scan streams only text already embedded in the PDF. It retains no more than 50,000 characters per page, 32 Mi characters across one scan, or 5,000 pages; reaching a ceiling leaves later or truncated pages for manual review and records that the scan was limited. It does not perform OCR, handwriting recognition, image understanding, or AI analysis. Image-only pages, broken character maps, unusual encodings, columns, stamps, marginalia, and poor source text can yield empty, scrambled, or misleading output. Researchers must inspect page images and define or correct boundaries manually.

Pattern-detected boundaries are proposals. Common memcon, telcon, memorandum, subject, participant, date, end-marker, and withdrawal-sheet patterns can miss documents or divide a packet incorrectly. A `page_range` means only that the researcher located content pages in this PDF. A `described_item` means that a sheet or finding aid describes an item whose content pages have not been identified; the stated extent is not an inferred page range and no derivative PDF is available for it. A manually created described item defaults to `not_determined`; only a visible embedded-text withdrawal/redaction-sheet pattern supports an automatic `withdrawal_notice_only` proposal. Rejected proposals remain part of the local review record.

Beta derivative export downloads the complete admitted source a second time under a separate three-requests-per-minute rate scope. A cancellable `pdf-lib` Web Worker computes SHA-256 over that second copy and refuses export unless it matches the source hash computed during opening; it is terminated after two minutes. It rebuilds the reviewed page range into a new PDF and removes each copied page's `/AA` additional-action dictionary and `/Annots` annotation array. Encrypted, malformed, very complex, or memory-intensive files can fail. Sources above 100 MiB are unsupported by the Packet Lab, including viewing, text search, manifests, and derivative generation.

A derivative changes the file structure and metadata, strips page actions and annotations, and is intentionally not byte-identical. It is not an official source file, certified copy, preservation object, authenticity determination, or new agency release. A page range does not prove that it is an official standalone document, that attachments are complete, that pagination is original, or that the material was released in full. Preserve and cite the official PDF and the separately researcher-supplied Catalog locator; first confirm their association on the Catalog page. Official source records and agency determinations control.

Saved packet registers are browser-local manifests only. They can contain locators, any available source validators, received size, browser-computed source SHA-256, page and scan counts, researcher decisions and notes, and derivative hashes. Opstalia does not persist source PDF bytes, rendered pages, thumbnails, embedded page text, or transport tokens. Reopening requires a new live session and a new full-source transfer. The saved source hash and reviewed decisions are retained only when actual received length and newly computed SHA-256 agree; otherwise every non-rejected decision becomes a proposal requiring re-review, while an earlier rejection remains recorded. A matching hash proves only that the received byte sequence matches the saved one, not that the file is authentic, complete, or correctly associated with the supplied Catalog record.

### GovInfo

GovInfo search requires a configured Worker and server-side `GOVINFO_API_KEY`. The Search Service is a documented public-preview interface and can change. GovInfo supplies official publications and reproduced government documents, but publication there is not automatically evidence that an originating agency declassified the underlying record, released it under FOIA, or released it in full.

### NASA Technical Reports Server and OSTI.GOV

NTRS and OSTI use documented public APIs and need no application source key, but they still require the configured Worker because the frontend does not call their upstreams directly. These are official scientific-and-technical-information discovery sources:

- NTRS is not a unified NASA FOIA reading room or a substitute for decentralized NASA FOIA e-libraries.
- OSTI.GOV public STI is not DOE OpenNet, and the adapter does not automate OpenNet's robots-disallowed search or document paths.

Public availability in either corpus does not establish declassification, FOIA release, completeness, authenticity, or release in full.

### Office of the Historian / FRUS

The checked-in FRUS index is deliberately partial. It contains **752 documents in three volumes**:

- `frus1981-88v03`
- `frus1981-88v05`
- `frus1981-88v06`

The index was generated from the Office of the Historian's `HistoryAtState/frus-unbound` project at pinned commit `56d9b6899758c7de95de58b48b20507a1edb9f9f`. Official result links point to `history.state.gov`. The GitHub source is build provenance, not the primary release-evidence URL.

This index is not a complete FRUS corpus and should never be described as such. Its local search uses deterministic token and phrase matching rather than the Office's full search engine or semantic retrieval.

FRUS is an official edited documentary publication. It is not necessarily a facsimile or a complete reproduction of the underlying archival record. Bracketed omissions, editorial notes, and source-note descriptions must not automatically be treated as archival redactions or proof of a particular release status.

### ISCAP

The checked-in beta index contains 529 objects parsed from the official ISCAP releases table. The table is an official discovery index, not an assertion that each linked object was released in full. Some entries are decision notifications or affirmed decisions without a released copy. Table layout changes can break a future refresh even while the current checked-in index continues to work.

### National Declassification Center

The checked-in schema-version-2 beta index contains 133 entries from the FY2026 Q3 NDC release list. Its corrected builder identifies the canonical workbook header row and retains the first data entries. These are generally project-, series-, or finding-aid-level descriptions, not item-level document releases. Completion of declassification processing does not establish online availability, unrestricted access, digitization, or release in full.

### NARA JFK assassination-records release page

The opt-in beta index contains 2,709 distinct PDF rows from NARA's current
“2025 Documents Release” page snapshot. It supports RIF and official-filename
discovery only. It is not full-text search, a mirror of the PDFs, or complete
coverage of the JFK Assassination Records Collection.

The current page also lists a January 30, 2026 batch. Nevertheless, every table
row reports March 18, 2025 and every file appears under the same 2025 path.
Opstalia therefore retains the row value only in the raw index record for
audit; it does not expose it as a normalized release date or use it for search,
sorting, ranking, or tranche inference. Multiple files can share one base RIF,
including multipart, DocID, `multirif`, and `redacted` filename variants.

The adapter does not read PDF text, identify document dates or titles beyond
the official filename, detect visible redactions, or infer `released_in_full`.
Every indexed file remains `not_determined` until human review.
NARA warns that the release may include living-person PII and copyrighted
material. Researchers must review the unaltered official PDF and applicable
access conditions.

The unofficial Doctly JFK Markdown corpus is not searched, indexed, cited, or
presented as official release evidence. Its converted text cannot supply
Opstalia metadata, snippets, release status, redaction findings, or provenance.

## Manual and unavailable sources

CIA is marked temporarily unavailable. At validation, the official Reading Room self-redirected and CIA.gov reported that search was unavailable. Opstalia can prepare copyable terms and provide official CIA resources/status, publications, and retry links, but those actions do not search the Reading Room and are not equivalent to CIA FOIA corpus coverage. The separate NARA RG 263 profile does not change this native-source status.

State FOIA, presidential-library discovery, FBI Vault, NSA, DIA, DoD, DOE OpenNet, DOJ, ODNI, DHS, NRO, Treasury, Commerce, the military departments, and many other registered sources remain manual adapters. The PDF Packet Lab adds narrow viewing and researcher packet analysis after an official NARA presidential-library PDF has been located; it does not automate presidential-library search or change source-coverage status. For State FOIA, Opstalia generates a user-initiated, prefilled official search handoff using applicable terms, dates, sender, recipient, case number, and document type. It does not call State from the backend or scrape the results because `foia.state.gov/robots.txt` disallows automated access to the entire site and no documented public search API was validated. The separate NARA RG 59 profile does not change this native-source status.

A manual adapter does not return normalized results. It opens the official search system and preserves the source in the research plan; the researcher must evaluate any relevant official record. A manually discovered locator can be recorded only after the researcher confirms that the material is unclassified and publicly released. The locator must use HTTPS on the source registry's approved official domain and match the adapter-specific direct record-page or record-file path policy. Domain approval alone is not enough: generic search-results, status, home, publications, collection, and other navigation pages are research leads and are rejected as primary evidence. Opstalia does not silently scrape a source whose interface, terms, or robots directives make automation unreliable.

Reports separately identify automated searches, manual handoffs, and unavailable sources. Opening or generating a manual handoff does not mean that Opstalia searched the repository or found a result.

## Search and ranking

Query expansion is deterministic and uses a bounded set of name, date, identifier, acronym, spelling, and OCR-tolerant variants. It does not use a paid AI service, understand historical context like a subject-matter expert, discover every name variant, or guarantee that a repository's preferred syntax is used.

The match score is an explainable heuristic, not a statistical probability. Missing metadata can lower a good match, while repeated names or terms can raise an unrelated record. Researchers must verify the official record page and document their basis.

## Deduplication and version grouping

Version relationships use identifiers, dates, titles, sender/recipient fields, page count, text snippets, and official URLs when available. Sparse, inconsistent, or OCR-corrupted metadata weakens those signals.

The labels “confirmed same document,” “probable version,” “possible version,” “related record,” and “insufficient evidence” are research classifications, not authenticity judgments. Automatic “confirmed” requires a strong shared identifier or official URL plus a high deterministic score, but still deserves human review.

Version grouping is heuristic and anchor-based. It does not prove transitive equivalence among every record in a group. There is no image-similarity model, handwriting comparison, seal or signature authentication, or cryptographic identity check.

## Comparison workspace

Text diffs operate only on the text snippets or OCR already available to the normalized records; they are not full-document diffs in many cases. Embedded official files may be blocked by an agency's browser or framing policy. Page selection and alignment are manual.

Version 1.0 does not provide reliable automatic attachment matching, substituted-page detection, image similarity, marginal-annotation comparison, or automatic page alignment. A copy containing more text is not presumed more authentic or more complete.

## Redaction and exemption analysis

Release-marking detection is pattern-based and depends primarily on source-provided text. It can miss redactions, interpret editorial brackets incorrectly, confuse legal citations with applied exemptions, or report false positives.

The code includes a basic dark-region assessment primitive, but version 1.0 does not provide a production-grade OCR pipeline, dependable white-space-redaction detection, robust page-image segmentation, or a complete automatic overlay workflow. Researchers must inspect the unaltered official copy.

Exemption definitions are a guide to cited official authorities. Agency practice and subcode meaning can vary. An absent visible code does not mean that nothing was withheld, and a detected code does not establish why a specific passage was withheld. Ambiguous markings remain “Unrecognized or ambiguous release marking.”

Opstalia does not make classification, declassification, legal, authenticity, or disclosure determinations.

## Release status

The status model is intentionally conservative. A digital object with no obvious black boxes defaults to `not_determined`, not `released_in_full`. Full release requires explicit official full-release language, official status metadata, or a researcher determination with a recorded basis.

Source metadata can be incomplete or inconsistent. “Released,” “declassified,” “digitized,” “available online,” and “published in FRUS” are not interchangeable. Researcher overrides are visually and structurally separate from the source-derived determination.

## Local storage and private mode

Projects are stored in the current browser's IndexedDB. There are no accounts, cloud backup, cross-browser synchronization, or collaborative editing. Clearing site data removes local projects unless the researcher exported them first.

PDF packet projects follow the same local-only model but persist a manifest, not the packet. Embedded text search must run again after reopening. The browser computes and retains source SHA-256 whenever a packet opens, but that hash establishes only byte continuity between received copies; it does not establish archival authenticity, completeness, release status, or the researcher-supplied record association.

GitHub Pages project sites share their origin. Local browser storage is a convenience, not an approved repository for restricted data.

Private mode prevents Opstalia project persistence and keeps current project state in memory, but it is not anonymity. Selected live queries still pass through Cloudflare to NARA, GovInfo, NTRS, or OSTI as applicable; manual source visits create ordinary browser requests; and providers may retain infrastructure logs under their own policies.

## Reports and fixtures

Exports reflect the data and inferences present at generation time. They do not freeze later changes on official websites. Printable HTML can be printed to PDF by the browser; Opstalia does not generate an archival-quality server-side PDF.

Demonstration projects are opt-in checked-in fixtures with official links and a fixed retrieval date. They are not preloaded into Saved Records or the browser-local workspace. Installing them from Search Projects exercises workflows; they are not live search results and must be rechecked at the official source before substantive use.
