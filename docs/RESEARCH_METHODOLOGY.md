# Research Methodology

## Purpose

Opstalia helps a researcher investigate whether a record described by **unclassified metadata** appears in supported official U.S. Government repositories, whether multiple official public versions may exist, and what the available official copies report about release status or visible withholding markings.

It is a discovery and review aid. It does not establish that a search is complete, authenticate a document, or make a classification, declassification, legal, or disclosure determination. Official source records and agency determinations control.

## Security prerequisite

Use only unclassified, unrestricted search information. Do not enter, upload, paste, or transmit classified information, controlled unclassified information, personally identifiable information, or other restricted material.

Opstalia 1.0 runs on the regular public Internet. It has no synchronization, connector, bridge, or network route to **Opstalia-c**. Classification is not removed by transcription, paraphrase, OCR, summarization, or metadata extraction.

## Method overview

The recommended workflow is:

1. define the target record using known unclassified metadata;
2. inspect and edit the deterministic search plan;
3. select appropriate registered official repositories;
4. run supported automated searches and follow manual-search links;
5. assess normalized results and their field-level provenance;
6. verify promising records on the official source;
7. review match, release-status, exemption, and version inferences;
8. record researcher judgments and unresolved questions; and
9. export a report that preserves sources, caveats, and the evidence legend.

The method is iterative. A source note, control number, archival citation, spelling variant, or correspondent found in one official result should inform a new, separately recorded search.

## 1. Define the target

Record what is known without importing the source document itself. Useful target fields include title or subject, exact phrases, sanitized keywords, date bounds, agency and office, author or sender, recipient, document type, identifiers, geographic focus, and research notes.

Distinguish exact observations from assumptions. For example:

- **Known:** an unclassified citation gives NAID 1234567.
- **Probable:** the drafter may have been Brent Scowcroft.
- **Unknown:** the exact memorandum title.

Do not convert an assumption into an exact phrase merely to produce a narrower result set.

## 2. Build and review the search plan

Opstalia expands the target deterministically into exact-phrase, broad-keyword, name-variant, acronym, date, identifier, agency, OCR-tolerant, and likely spelling variants. The plan is editable: remove weak variants, correct historical names, add repository-specific terminology, and choose which sources each query should target.

Deterministic expansion is intentionally transparent. It is not semantic AI search and does not claim to reconstruct missing context. Preserve the plan used for each run so that another researcher can reproduce the search logic.

## 3. Select sources according to evidence needs

Use the source-coverage dashboard, which records integration status, implementation method, filters, terms constraints, limitations, manual fallback, and validation date.

The current automated paths are:

- **NARA Catalog:** live API search through the secret-backed Worker;
- **NARA RG 263 and RG 59 profiles:** opt-in, fixed-filter NARA Catalog
  searches through the same Worker and NARA key;
- **GovInfo:** opt-in official-publication search through the Worker and a
  server-side GovInfo key;
- **NASA NTRS and OSTI.GOV:** opt-in public scientific-and-technical-information
  search through the Worker without an Opstalia source API key;
- **FRUS:** browser-local search of a pinned partial index;
- **ISCAP:** browser-local search of a pinned beta releases-table index; and
- **NDC:** browser-local search of a pinned beta release-list index.

Other registered repositories use manual links or remain planned unless their
coverage entry says otherwise. “Manual” means that Opstalia does not normalize
results from that system; it does not mean the source was searched
automatically.

The FRUS scope must be reported precisely. The checked-in 1.0 index contains 752 documents from `frus1981-88v03`, `frus1981-88v05`, and `frus1981-88v06`, built from pinned commit `56d9b6899758c7de95de58b48b20507a1edb9f9f`. It is not a search of the complete FRUS series.

## 4. Admit only official primary evidence

A result enters the primary index only when it has:

- an HTTPS URL on the configured official-domain allowlist for that source;
- provenance from the matching registered adapter; and
- an official record-page or file URL.

All returned record and file URLs must pass the source allowlist. GovInfo PDF,
NTRS download, and OSTI full-text paths must also bind to the package/granule,
citation, or OSTI identifier on the official record page. NARA exposes a
digital-object link only for a recognized direct public file on an approved
`archives.gov` host.

Opstalia 1.0 excludes leaked-document sites, unofficial mirrors, news-media caches, commercial or crowdsourced archives, personal sites, anonymous hosts, social-media uploads, and unofficial GitHub copies as release evidence.

The source registry, not scattered code, defines approved domains. A source repository's official GitHub project may provide build provenance for an index, but the result's release-evidence link must still point to the registered official government site.

## 5. Preserve evidence and provenance layers

Every conclusion should remain in one of five layers:

| Layer | Meaning | Examples |
| --- | --- | --- |
| Source-reported | Stated directly in official structured data, text, or a record page | NAID, official title, agency-reported release date |
| Opstalia-extracted | Mechanically parsed or normalized from official material | normalized date, extracted control number, detected text marking |
| Algorithmically inferred | Deterministic interpretation requiring review | match score, possible version relationship, cautious release-status inference |
| Researcher-reviewed | A documented human confirmation or correction | confirmed match, corrected title, manual full-release determination |
| Unknown or unavailable | Not supplied or not reliably derivable | missing page count, unknown release mechanism |

Normalized fields carry a value, source, extraction method, confidence, and optional researcher override. A correction does not erase the original source-reported value.

Raw source records remain separate from normalized records when source terms permit, so a future normalizer can be audited against the retrieved payload. NARA is the deliberate exception: its [Catalog API terms](https://www.archives.gov/research/catalog/help/api) say not to cache or store returned content. NARA raw responses remain in memory, and persistent projects retain only a generated NAID/official-URL locator plus researcher-created review data.

## 6. Interpret matching scores cautiously

The 0–100 search-match score is an explainable ranking aid. Current factors include exact identifier, title, and date matches; sender, recipient, agency, office, document type, geographic, exact-phrase, and keyword matches; plus a date-conflict penalty. OCR/text similarity and page-count similarity are separate version-relationship signals, not target-to-result ranking factors.

Read the “Why this matched” factors. The score is not a probability and is not comparable to a legal standard of proof. Sparse metadata can suppress a strong candidate; common names and terms can inflate a weak one.

Before confirming a match:

1. open the official record;
2. compare identifiers, dates, correspondents, title or subject, and archival context;
3. inspect the available file, page count, attachments, and source note;
4. record the basis for the judgment; and
5. retain unresolved discrepancies.

## 7. Group and compare versions

Version analysis uses deterministic signals: shared identifiers, official URLs, dates, titles, sender and recipient fields, page counts, and available text.

The current relationship thresholds are:

- `confirmed_same_document`: score at least 90 **and** a strong shared identifier or official URL;
- `probable_version`: score at least 72;
- `possible_version`: score at least 48;
- `related_record`: score at least 25; and
- `insufficient_evidence`: lower scores.

These labels are working hypotheses. A researcher should confirm, downgrade, or split a relationship after reviewing both official sources. An anchor-based automatic group does not prove that every pair in the group is equivalent.

In side-by-side review, compare provenance before content. Then review release dates, mechanisms, page counts, attachments, text differences, stamps, marginal annotations, missing pages, and visible codes. A version containing more text is not necessarily more authentic, authoritative, or complete.

## 8. Determine release status conservatively

Use only the controlled vocabulary:

- `released_in_full`
- `released_in_part`
- `released_with_redactions_status_unclear`
- `metadata_only`
- `described_but_not_digitized`
- `withdrawal_notice_only`
- `finding_aid_only`
- `not_determined`

`released_in_full` requires explicit official full-release language, official release metadata reporting full release, or a documented researcher determination. The absence of visible black boxes is not enough.

For each status, preserve the determination basis, source, confidence, and human-review flag. Keep researcher overrides separate from the source-derived status.

Do not conflate:

- declassified with publicly available online;
- digitized with declassified;
- a FOIA partial release with a complete declassification;
- an NDC processing entry with an item-level online release; or
- a FRUS publication with a facsimile of the complete underlying file.

FRUS bracketed omissions and editorial notes should be reported as publication features unless the official source explicitly identifies them as release or withholding markings.

## 9. Review redactions and exemption markings

Opstalia matches recognized codes and generic release phrases in available official text or OCR. Each detection has a method and confidence and can be marked false by the researcher.

Use the exemption dictionary as a linked reference, not as an automatic legal interpretation. Agency usage and subcodes may vary. When a marking is not recognized confidently, retain the label “Unrecognized or ambiguous release marking.”

Always inspect the unaltered official page image or PDF. Pattern detection can miss black or white redactions, stamps, handwritten notes, denied pages, and referrals; it can also mistake quoted statutory language for an applied exemption. Record the page and surrounding text when available.

## 10. Record negative and unavailable evidence

A useful report includes not only hits but also:

- every source selected;
- the exact plan queries sent or used locally;
- sources returning zero results;
- sources unavailable, rate-limited, blocked, or manual-only;
- the date and time of the run; and
- limitations of the relevant source index.

“No result” means only that the recorded search did not return a result under the conditions shown. It is not evidence that no release exists.

## 11. Researcher review and reporting

For important candidates, record:

- confirm or reject decision;
- judgment basis;
- metadata corrections;
- release-status override and basis;
- false-positive marking decisions;
- version merge or split decision;
- best available public copy designation; and
- unresolved questions.

Exports preserve the search target, queries, source runs, official links, version groups, release bases, visible codes, match factors, researcher judgments, and standard caveats when source policy permits. NARA is the explicit exception: its export sanitizer replaces a transient API result with a generated NAID/official-URL locator and researcher-created review data, clearing API-derived metadata, visible-code detections, scores, and match factors.

The report legend must distinguish official facts, extracted data, inference, researcher judgment, and unknown information. Recheck official URLs before publication because government metadata and files can change after retrieval.

## 12. Reproducibility checklist

Before treating a search as complete enough for the immediate research purpose:

- verify that only unclassified, unrestricted terms were used;
- save or export the exact search target and plan;
- record the registry validation date and partial-index scope;
- identify which sources were automated, manual, or unavailable;
- open the leading candidates on their official pages;
- explain every confirmed match, version relationship, and status override;
- preserve contradictory metadata and unknowns;
- include the standard caveats; and
- schedule a later rerun when coverage or official indexes may have changed.
