# Known Limitations

This document describes the boundaries of Opstalia 1.0 as implemented on July 29, 2026. These are product constraints, not promises of future access.

## Security and network boundary

Opstalia 1.0 is an **unclassified application on the regular public Internet**. It is not authorized to receive or process classified information, controlled unclassified information, personally identifiable information, or other restricted material.

The public build has no source-document upload workflow. It cannot determine whether information is classified, and classification is not removed by OCR, transcription, paraphrase, summarization, or metadata extraction.

There is no synchronization, connector, bridge, shared database, or network route between Opstalia 1.0 and **Opstalia-c**. A possible future closed-network system is outside the version 1.0 authorization and deployment boundary.

## Coverage is not exhaustive

Opstalia searches its current registry of supported official repositories. It does not search every government website, every archival description, every digitized object, every FOIA release, or every physical holding.

An absent result does not establish that a record was never released. Official search systems may be incomplete, unindexed, temporarily unavailable, metadata-only, or divided among agency components and presidential libraries. A document may be declassified but not digitized or publicly available online.

Registry status reflects validation performed on 2026-07-29; it is not continuous monitoring. Agency URLs, schemas, terms, robots directives, and search behavior can change after that date.

## Automated source coverage

### National Archives Catalog

NARA search requires a deployed Cloudflare Worker with `NARA_API_KEY`. Without that secret and a configured public Worker URL, the application provides an official manual Catalog link but cannot run normalized live NARA searches.

NARA's [Catalog API terms](https://www.archives.gov/research/catalog/help/api) currently say not to cache or store returned content and set a default limit of 10,000 queries per month per API key. Consequently:

- live NARA responses and metadata remain transient in memory;
- no raw NARA source response is stored in a project;
- a saved NARA result is reduced to a generated NAID/official-URL locator plus researcher-created review data; and
- reopening a saved locator does not reproduce the earlier API metadata without a new live search.

The orchestrator runs at most three generated NARA queries per source run, with up to 20 results per query in the current UI. This bounds API use but can omit lower-ranked or differently phrased Catalog hits. Catalog digitization metadata is not proof of declassification or full release.

The Worker's rate limiter is best-effort and isolate-local; it is not a globally durable quota service. NARA's own per-key limit remains controlling.

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

The checked-in beta index contains 121 rows from the FY2026 Q3 NDC release list. These are generally project-, series-, or finding-aid-level descriptions, not item-level document releases. Completion of declassification processing does not establish online availability, unrestricted access, digitization, or release in full.

## Manual and unavailable sources

CIA is marked temporarily unavailable. At validation, the official Reading Room self-redirected and CIA.gov reported that search was unavailable. Opstalia can prepare copyable terms and provide official CIA resources/status, publications, and retry links, but those actions do not search the Reading Room and are not equivalent to CIA FOIA corpus coverage.

State FOIA, presidential libraries, FBI Vault, NSA, DIA, DoD, DOE OpenNet, DOJ, ODNI, DHS, NRO, Treasury, Commerce, the military departments, and many other registered sources are manual adapters in 1.0. For State FOIA, Opstalia generates a user-initiated, prefilled official search handoff using applicable terms, dates, sender, recipient, case number, and document type. It does not call State from the backend or scrape the results because `foia.state.gov/robots.txt` disallows automated access to the entire site and no documented public search API was validated.

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

GitHub Pages project sites share their origin. Local browser storage is a convenience, not an approved repository for restricted data.

Private mode prevents Opstalia project persistence and keeps current project state in memory, but it is not anonymity. NARA queries still pass through Cloudflare to NARA, manual source visits create ordinary browser requests, and GitHub and Cloudflare may retain infrastructure logs under their own policies.

## Reports and fixtures

Exports reflect the data and inferences present at generation time. They do not freeze later changes on official websites. Printable HTML can be printed to PDF by the browser; Opstalia does not generate an archival-quality server-side PDF.

Demonstration projects are checked-in fixtures with official links and a fixed retrieval date. They exercise workflows; they are not live search results and must be rechecked at the official source before substantive use.
