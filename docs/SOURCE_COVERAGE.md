# Source coverage

## Coverage statement

**Opstalia searches its current registry of supported official repositories.**

It does not search all U.S. Government websites, and it does not claim that the absence of a result establishes non-release.

Registry version: **1.2.0**
Last source-interface validation: **2026-07-30**
Registered sources: **35**

## Status summary

| Registry status | Count | Meaning |
|---|---:|---|
| Integrated | 2 | Working automated adapter with declared coverage |
| Beta | 8 | Working automated adapter whose source structure or interpretation needs continued monitoring |
| Manual | 20 | Official user-initiated handoff or manual-search link; Opstalia does not fetch or normalize results |
| Temporarily unavailable | 1 | The upstream search was not usable at validation; prepared terms and official status/publications/retry links remain |
| Planned | 4 | Discovery entry and official link; no automated or complete manual workflow claim |
| Retired | 0 | No retired sources |

“Automated” includes live API execution and searches over reproducibly built, checked-in official-source indexes. The interface shows the method for each source.

## Automated coverage

| Source | Status | Runtime method | Exact current coverage | Important limit |
|---|---|---|---|---|
| National Archives Catalog | Integrated | Live Catalog API v2 through Cloudflare Worker | Query-time NARA results, up to 20 requested per plan query; first three NARA-targeted query variants | Requires server-side `NARA_API_KEY`; API responses are neither cached nor stored |
| CIA records held by NARA — RG 263 | Beta | Optional NARA Catalog API profile through Cloudflare Worker | Available-online textual request with `recordGroupNumber=263`; returned hierarchy is checked before the RG label is used | Requires `NARA_API_KEY`; does not search the native CIA FOIA Electronic Reading Room; RG 263 is not every CIA-related record |
| Department of State records held by NARA — RG 59 | Beta | Optional NARA Catalog API profile through Cloudflare Worker | Available-online textual request with `recordGroupNumber=59`; returned hierarchy is checked before the RG label is used | Requires `NARA_API_KEY`; does not search native State FOIA or RG 84 Foreign Service Post records |
| NARA JFK assassination records — 2025 release page | Beta | Optional browser-local pinned official-table index | 2,709 distinct official PDF rows on the current page snapshot; RIF and filename metadata only | The page now includes a 2026 batch and reports March 18, 2025 for every row; not full-text search, the entire JFK Collection, or proof of full release |
| GovInfo | Beta | Documented Search Service through Cloudflare Worker | Query-time official publication/package discovery | Requires server-side `GOVINFO_API_KEY`; official publication is not automatically declassification or full-release evidence |
| NASA Technical Reports Server | Beta | Documented NTRS citations API through Cloudflare Worker | Query-time public NASA scientific and technical information | Not a unified NASA FOIA reading room; public availability does not establish declassification or release in full |
| OSTI.GOV scientific and technical information | Beta | Documented OSTI API v1 through Cloudflare Worker | Query-time public DOE-funded scientific and technical information | Separate from DOE OpenNet; public availability does not establish declassification or release in full |
| Office of the Historian / FRUS | Integrated | Browser-local pinned TEI index | 752 documents across `frus1981-88v03`, `frus1981-88v05`, and `frus1981-88v06` | Not the full FRUS series; edited publication, not necessarily a facsimile |
| ISCAP releases | Beta | Browser-local pinned official-table index | 529 release-table objects | A linked PDF is not automatically a full release; some entries are notifications |
| National Declassification Center release lists | Beta | Browser-local pinned official-workbook index | 133 entries from FY2026 Q3 | Generally series-level finding-aid/availability data, not item-level online copies |

### Static-index provenance

| Index | Provenance |
|---|---|
| FRUS | `HistoryAtState/frus-unbound`, commit `56d9b6899758c7de95de58b48b20507a1edb9f9f`; official evidence links resolve to `history.state.gov` |
| ISCAP | Official `archives.gov/declassification/iscap/releases` HTML; checked-in index records the source SHA-256 |
| NDC | Official FY2026 Q3 `archives.gov` workbook; checked-in index records the source SHA-256 |
| NARA JFK release page | Official `archives.gov/research/jfk/release-2025` HTML; guarded parser records response metadata and source SHA-256; every result remains an official `archives.gov` PDF link |

These counts describe the checked-in build, not a promise that an upstream source still has the same count.

The NARA record-group profiles and native reading-room entries are deliberately separate source IDs. A hit from `nara-cia-rg263` or `nara-state-rg59` is a NARA Catalog result, not evidence that Opstalia searched or found the record in CIA's or State's native FOIA systems.

## Temporarily unavailable

| Source | Reason | Official fallback |
|---|---|---|
| CIA FOIA Electronic Reading Room | No documented public search API; on 2026-07-29 the official Reading Room self-redirected and CIA.gov reported search unavailable | [CIA search service notice](https://www.cia.gov/redirects/search-unavailable/); [official publications](https://www.cia.gov/resources/publications/publications-list/); [retry Reading Room](https://www.cia.gov/readingroom/advanced-search-view/) |

Opstalia prepares copyable CIA search terms and keeps the retry link available, but it does not bypass the Reading Room's robots restrictions or claim to have searched CIA. The resources and publications pages are useful official fallbacks, not substitutes for Reading Room corpus coverage.

## Manual-search sources

These entries open official systems but produce no normalized Opstalia results until a researcher separately records official-source evidence.

The Department of State entry is a first-class manual handoff: Opstalia maps the researcher's applicable search terms, date range, sender, recipient, case number, and document type into a user-initiated, prefilled request to the official released-document search. The user's browser then navigates directly to `foia.state.gov`; Opstalia makes no backend request, does not scrape the returned page, and does not claim that the handoff produced a result. This boundary is required because the site's `robots.txt` disallows automated access to the entire site and no documented public search API was validated.

| Source | Agency | Official access |
|---|---|---|
| Department of State FOIA Virtual Reading Room | Department of State | <https://foia.state.gov/FOIALIBRARY/SearchResults.aspx> |
| NARA Presidential Libraries | National Archives | <https://www.archives.gov/presidential-libraries/visit/websites.html> |
| FBI Vault | Federal Bureau of Investigation | <https://vault.fbi.gov/search_form> |
| NSA FOIA Reading Room | National Security Agency | <https://www.nsa.gov/Helpful-Links/NSA-FOIA/Reading-Room/> |
| DIA FOIA Electronic Reading Room | Defense Intelligence Agency | <https://www.dia.mil/FOIA/FOIA-Electronic-Reading-Room/s/34/> |
| Department of Defense FOIA | Department of Defense | <https://pclt.defense.gov/DIRECTORATES/FOIA/Find-An-Office/> |
| DOE OpenNet | Department of Energy | <https://www.osti.gov/opennet/> |
| DOJ FOIA Library | Department of Justice | <https://www.justice.gov/oip/foia-library> |
| National Security Council Records | NSC / National Archives | <https://www.archives.gov/presidential-records/research/archival-collections> |
| ODNI FOIA Reading Room | Office of the Director of National Intelligence | <https://www.dni.gov/index.php/what-we-do/foia-reading-room> |
| DHS FOIA Library | Department of Homeland Security | <https://www.dhs.gov/publications-library/collections/foia-library> |
| NRO FOIA Reading Room | National Reconnaissance Office | <https://www.nro.gov/foia-home/foia-resources-reading-room/> |
| Treasury Electronic Reading Room | Department of the Treasury | <https://home.treasury.gov/footer/freedom-of-information-act/electronic-reading-room> |
| Commerce Electronic FOIA Library | Department of Commerce | <https://www.commerce.gov/opog/foia/electronic-foia-library> |
| Army FOIA Library | Department of the Army | <https://foia.army.mil/home> |
| Navy FOIA Reading Room | Department of the Navy | <https://www.secnav.navy.mil/foia/readingroom/SitePages/Home.aspx> |
| Department of the Air Force FOIA | Department of the Air Force | <https://efoia.cce.af.mil/app/ReadingRoom.aspx> |
| FOIA.gov Agency Search | Department of Justice | <https://www.foia.gov/search.html> |
| DTIC FOIA Reading Room | Defense Technical Information Center | <https://discover.dtic.mil/FOIA/> |
| GAO Reports and Testimonies | Government Accountability Office | <https://www.gao.gov/reports-testimonies> |

Manual discovery does not establish release status. Researchers must open and
evaluate the official record. Opstalia permits a researcher to record a
manually found official URL only after an explicit confirmation that the
material is unclassified and publicly released. The URL must pass both the
source registry's approved-domain validation and a record-locator path rule.
CIA accepts Reading Room document pages/files, State accepts direct
`/DOCUMENTS/…` PDFs, FBI accepts Vault downloads, and other manual adapters
currently accept direct public record files. A homepage, search, status, or
general publications page is not official release evidence.

Research reports keep three states distinct: automated searches run by Opstalia, user-initiated manual handoffs, and sources that were unavailable. A handoff is never counted as an automated search or as a result found.

## Planned registry entries

| Source | Reason it remains planned |
|---|---|
| EPA FOIA | No adapter validated for 1.0 |
| Interior FOIA Libraries | No adapter validated for 1.0 |
| HHS FOIA Library | No adapter validated for 1.0 |
| NASA FOIA | Center libraries are decentralized; no adapter validated for 1.0 |

## Source-specific interpretive limits

- NARA Catalog indexing and metadata may be incomplete. Digitized does not mean declassified or fully released.
- RG 263 and RG 59 profiles are opt-in, fixed-filter NARA requests. Explicitly conflicting returned hierarchy is rejected; a returned hit that exposes no group number remains generic NARA evidence requiring review. They do not search native agency FOIA repositories or establish complete agency coverage.
- FRUS is an official documentary publication. Bracketed omissions, source notes, and editorial interventions must be read as editorial evidence, not automatically as archival redaction markings.
- ISCAP release-table entries can link to released documents or decision notifications. Presence in the table does not prove full release.
- NDC release lists may describe series that completed declassification processing while other access restrictions or FOIA screening remain.
- The NARA JFK index searches only the current official release-page filenames, RIFs, source-reported table dates, and PDF links. It does not index PDF text, assign true per-file release batches from the inconsistent table, or establish that an absent record was never released.
- The unofficial Doctly JFK Markdown conversion is not an Opstalia evidence source. Opstalia does not search its text or use it for citations, metadata, release status, or redaction findings.
- GovInfo is official publication discovery; NTRS and OSTI are official scientific-and-technical-information discovery. None of those corpus labels alone establishes declassification, FOIA release, or release in full.
- Agency reading rooms vary in OCR quality, indexing, date fields, and availability.
- Presidential-library holdings are not completely represented by one unified search API.
- A record can be publicly accessible without being discoverable through an API.
- Different agencies may release different versions of the same underlying record.

## Validation method

A source-validation review should record:

1. official ownership or government authentication of the domain;
2. current official URL and redirect behavior;
3. API documentation or absence of an API;
4. authentication and rate limits;
5. terms and robots guidance;
6. supported filters and returned fields;
7. whether runtime automation is stable and permissible;
8. manual fallback;
9. known interpretive limits; and
10. validation date.

Automated status should be downgraded when an interface cannot be validated. A manual fallback is a valid product capability, but it must remain visibly distinct from automated search.

## Updating this document

The machine-readable registry is authoritative for UI counts:

```text
data/sources.json
```

When changing a source:

- update the registry;
- update or add adapter tests;
- verify official-domain enforcement;
- update this coverage snapshot;
- record the exact validation date; and
- avoid claiming broader historical coverage than the adapter actually searches.
