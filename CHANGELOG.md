# Changelog

All notable changes to Opstalia are documented in this file. The project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

No unreleased changes are recorded.

## [1.0.1] - 2026-07-29

### Added

- Query-aware, user-initiated Department of State FOIA handoffs with safely encoded official search terms, dates, sender, recipient, case number, and supported document-type filters.
- CIA outage assistance with copyable retry terms, an official CIA service notice, official publications access, and a clearly labeled Reading Room retry.
- Researcher-confirmed capture of manually discovered official locators with HTTPS official-domain enforcement, cautious `not_determined` release status, local notes, and saved-record integration.
- Separate report sections for automated searches, manual official-source handoffs, and unavailable sources, including export support when a handoff returns no normalized records.

### Changed

- Moved source actions beside source names so CIA and State controls remain visible on narrow screens.
- Replaced misleading manual-source `0 results` labels with explicit handoff-only status.
- Made prepared handoff text and structured filters follow the researcher-edited, enabled search-plan queries.
- Preserved researcher-recorded locators across same-target reruns without re-saving intentionally unsaved records; retargeting now starts a separate project.
- Preserved private imports as memory-only workspaces and kept private records available to the in-memory saved/compare views without adding search history.
- Updated privacy, architecture, data-model, security, threat-model, source-coverage, and known-limitations documentation for the new data flow.

### Security

- Manual handoffs never open automatically and never include local research notes.
- Researcher-recorded locators reject unofficial domains, non-HTTPS URLs, credentials, nonstandard ports, and official-but-nonrecord home/search/status/publications pages.
- Imported handoffs are regenerated from the visible validated plan and current registry; imported counts, statuses, URL overrides, and private-mode behavior are normalized or rejected.
- Markdown, printable HTML, and CSV exports preserve import-verification caveats and neutralize report-content injection.
- CIA and State remain honestly labeled as unavailable and manual respectively; neither is represented as an automated integration.

## [1.0.0] - 2026-07-29

### Added

- Standalone React, TypeScript, and Vite application for unclassified research on the regular public Internet.
- Prominent unclassified-use notice and required acknowledgment before search-plan generation or source execution.
- Guided and quick search modes with editable, deterministic query expansion.
- Federated source orchestration with per-source progress, partial rendering, cancellation, failure isolation, and official manual-search fallbacks.
- Cloudflare Worker NARA Catalog API v2 adapter with a server-side `NARA_API_KEY`, request validation, fixed-host SSRF protection, CORS enforcement, bounded retries, timeout handling, and secret-safe errors.
- Browser-local FRUS search over a pinned, partial index of 752 documents in three volumes: `frus1981-88v03`, `frus1981-88v05`, and `frus1981-88v06`.
- Browser-local beta indexes for 529 ISCAP release-table objects and 121 National Declassification Center FY2026 Q3 release-list rows.
- Manual official-source adapters for CIA, State FOIA, presidential libraries, FBI, NSA, DIA, DoD, DOE OpenNet, DOJ, ODNI, DHS, NRO, Treasury, Commerce, the military departments, and other registered repositories where stable automation is unavailable or inappropriate.
- Configurable official-domain allowlists and a provenance gate requiring a registered adapter and official record or file URL.
- Shared normalized TypeScript model with runtime input validation and distinct source-reported, extracted, inferred, researcher-reviewed, and unknown evidence layers.
- Explainable 0–100 result ranking, deterministic deduplication, cautious version grouping, visible match factors, and researcher confirm/reject controls.
- Controlled release-status vocabulary that does not equate a public digital object or lack of visible redaction with release in full.
- Versioned exemption-code dictionary with official citation links, text-marking detection, ambiguity labels, confidence values, and false-positive review.
- Side-by-side official-document workspace with source links, metadata comparison, available-text diffing, synchronized manual page selection, and researcher version decisions.
- IndexedDB projects, saved records, notes and review state, project import/export, shareable search targets, and private-search mode.
- Markdown, CSV, JSON, and printable HTML research-report exports with caveats and an evidence legend.
- Source-coverage dashboard that distinguishes integrated, beta, manual, temporarily unavailable, planned, and retired sources.
- Public, official-link demonstration projects marked as fixtures.
- Privacy, security, architecture, threat-model, source-adapter, research-methodology, redaction, deployment, and future-local-analyst documentation.
- Automated linting, type checks, unit and integration tests, browser workflow tests, accessibility checks, dependency audit, and secret scanning.

### Security

- Prohibited submission of classified information, controlled unclassified information, personally identifiable information, and other restricted material.
- Kept the NARA key out of frontend code and repository files; startup health reports configuration state only.
- Applied NARA's no-cache/no-storage API constraint: live NARA content remains transient and saved records retain only a generated NAID/official-URL locator plus researcher-created data.
- Added no third-party analytics, user accounts, or public multi-user database.
- Prevented unofficial domains or mismatched adapter provenance from entering the primary evidence index.
- Documented that private mode is not anonymity and that selected live-source queries still leave the browser.
- Established that Opstalia 1.0 has no synchronization, bridge, connector, or network route to Opstalia-c.

### Known limitations

- Opstalia searches only its current registry of supported official repositories; it does not search all government sites.
- The FRUS index covers only the three named volumes, not the complete FRUS series.
- CIA and many other repositories are manual-search adapters, not working automated integrations.
- NDC rows are generally series-level release-list evidence, not item-level digital records.
- Redaction, version, and release-status analysis remains deterministic and requires human review.
