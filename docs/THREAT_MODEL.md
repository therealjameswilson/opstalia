# Opstalia 1.0 threat model

Status: public Internet release
Last reviewed: 2026-08-03

## Scope

This threat model covers:

- the React/Vite frontend served from GitHub Pages;
- browser-local IndexedDB and in-memory state;
- checked-in FRUS, ISCAP, NDC, and NARA JFK release-file indexes and their build scripts;
- the Cloudflare Worker fixed adapter registry and signed-session NARA
  presidential-library bounded full-file relay;
- NARA Catalog, GovInfo, NASA NTRS, and OSTI.GOV upstream requests;
- registered manual links, official-file viewers, PDF.js local parsing and
  embedded-text scan, and the beta `pdf-lib` browser-worker derivative path;
- project JSON import and report/project exports; and
- the release and dependency supply chain.

It does not treat a possible Opstalia-c system as present. Opstalia 1.0 has no
connection or synchronization with a closed network.

## Security assumptions

- Users follow the prominent instruction to submit unclassified, unrestricted
  information only.
- GitHub, Cloudflare, NARA, and other official sources may process ordinary
  infrastructure telemetry under their own controls.
- Official repositories can be incomplete, unavailable, compromised, or serve
  malformed content; "official" is a provenance category, not a malware
  guarantee.
- The browser and operating system are supported and patched, but extensions,
  local malware, enterprise monitoring, and shared-device access remain
  possible.
- Maintainers protect their GitHub and Cloudflare accounts with strong
  authentication and review deployment changes.
- Source registry facts, robots rules, API terms, URLs, and release-code
  definitions can change and require revalidation.

## Assets

| Asset | Desired property |
| --- | --- |
| `NARA_API_KEY`, `GOVINFO_API_KEY`, and deployment credentials | Confidentiality and prompt revocation if exposed |
| Search terms and researcher notes | No application logging; local retention only when chosen |
| Saved projects and annotations | Integrity, local availability, explicit deletion/export |
| PDF packet manifests and researcher page decisions | Integrity, local availability, separation from transient PDF bytes/text/tokens |
| PDF relay token and `RATE_LIMIT_SALT` | Signature integrity, short lifetime, no application logging, secret confidentiality |
| Official-source registry | Integrity and reviewable change history |
| Normalized record provenance | Integrity and non-repudiation of source/extraction method |
| Pinned indexes | Integrity, reproducibility, bounded coverage, freshness metadata |
| Release-status and exemption interpretations | Accuracy, cautious defaults, visible uncertainty |
| Public build and Worker | Integrity and correspondence to a reviewed release commit |
| Source availability and quota | Bounded use and graceful partial failure |

## Adversaries and hazardous actors

- an Internet user attempting to exhaust the Worker or an upstream quota;
- a malicious user entering markup, formula payloads, oversized JSON, or a
  crafted URL;
- an attacker controlling a dependency, upstream index source, official page,
  DNS path, maintainer credential, or build/deployment token;
- a browser extension or local process reading page state or IndexedDB;
- an honest researcher accidentally entering restricted information;
- an honest researcher over-trusting a match, redaction detection, source
  status, or more-complete-looking version;
- a source that changes HTML, API schema, robots policy, terms, or domain;
- a forged imported project containing false provenance or manipulated
  researcher decisions; and
- an official server unintentionally serving a malformed or hostile PDF.

## Trust boundaries

1. **Researcher to browser:** all input is untrusted and may also be
   inappropriately sensitive.
2. **Static host to browser:** application code and indexes cross a supply-chain
   boundary.
3. **Browser to IndexedDB:** local persistence is accessible to the origin and
   device environment.
4. **Browser to Worker:** unclassified query text or an acknowledged public
   NARA packet locator, short-lived token, bounded full-stream requests, and network metadata
   cross the public Internet and Cloudflare edge.
5. **Worker to official API:** source-specific requests cross to NARA, GovInfo, NASA NTRS, or OSTI.GOV. NARA and GovInfo requests carry their respective server-side source key; NTRS and OSTI requests do not.
6. **Browser to manual source or file:** the user leaves Opstalia's runtime
   control and interacts with the official host. A displayed prefilled handoff
   transmits its prepared terms and filters when the user opens it.
7. **Import/export boundary:** user-controlled files enter or leave browser
   storage.
8. **Build pipeline to release:** dependencies and upstream source artifacts
   become executable code or searchable data.
9. **PDF relay to browser parser:** after a prefix-only admission read is
   cancelled, one complete official PDF crosses from the strict NARA media path
   through Cloudflare into browser memory for PDF.js. A derivative request makes
   a second complete NARA → Cloudflare → browser transfer and then passes those
   bytes into an isolated browser Web Worker. Both streams have a hard 100 MiB cap.

## Threat and control register

| Threat | Existing 1.0 controls | Residual risk / required practice |
| --- | --- | --- |
| Classified, CUI, PII, or restricted data entered as search text or packet notes | Prominent notice, affirmative acknowledgement, unclassified-only labels, no document upload, Packet Lab restricted to an already-public official NARA locator | A public app cannot inspect or reliably classify inputs. Public availability of a file does not authorize restricted annotations. User and organization remain responsible; stop and follow incident procedure if entered |
| Misbelief that Opstalia synchronizes with Opstalia-c | Repeated public-build boundary; no connector, route, datastore, or protocol | Future marketing or code could create ambiguity; any integration requires a new review and authorization |
| NARA or GovInfo key leaked into frontend or repository | Worker secrets, placeholder environment file, ignore rules, health Booleans only, secret scanner, error redaction | Maintainer credential/build compromise or manual copy remains possible; inspect Git history and built source maps and rotate on suspicion |
| Cross-origin abuse of Worker | Exact origin allowlist and CORS rejection; separate session/content limits; signed-session PDF content | CORS is not authentication and non-browser clients can send requests. A leaked relay token can be replayed until expiry. Rate limiting and quota monitoring remain necessary |
| Upstream quota exhaustion or denial of service | 30/minute per ephemeral derived key, at most three Worker-backed plan variants per source, source timeout, bounded retries where implemented, partial failure | Per-isolate limiter is neither global nor durable; distributed abuse can evade it. Source-specific limits and Cloudflare-level rate rules may be needed |
| SSRF or secret forwarding through source URL, source ID, query input, token, or redirect | Fixed adapter-ID registry; fixed per-adapter endpoints; strict Packet Lab hostname and `/medialz/presidential-libraries/` path; researcher-supplied canonical `/id/<NAID>` URL whose numeric component must repeat the submitted NAID; credentials/ports/query/fragment/traversal rejected; redirects rejected; content route takes only a signed token, never a new URL | URL-form consistency does not prove that the Catalog record lists the PDF. A future adapter or Packet Lab expansion that accepts another host, redirect, or arbitrary URL could reopen SSRF. Revalidate every hop and DNS behavior before adding one |
| Malformed or oversized upstream result reaches the browser | Worker and browser runtime-validate responses; streamed upstream JSON is capped at 12,000,000 bytes for NARA and 5,000,000 bytes for GovInfo/NTRS/OSTI; admission checks source identity, provenance, every result/file URL, and GovInfo/NTRS/OSTI record-ID binding; NARA also caps reported objects/OCR and exposes only recognized direct files on approved `archives.gov` hosts | A schema-valid source payload can still be misleading or expensive. Keep per-adapter bounds, rendering limits, and regression tests under review |
| Unofficial source or generic official-site page presented as primary evidence | Registry-based domains, adapter/provenance match, and HTTPS are required; researcher locators from manual sources must also match adapter-specific direct record-page or record-file paths, so generic search-results, status, home, publications, collection, and navigation pages are rejected. NARA JFK results require an exact release-file path plus filename-RIF binding; Doctly/GitHub content is excluded | An allowlisted direct record or file can still be unrelated, mislabeled, incomplete, or compromised. Researcher confirmation and human source-page review remain required |
| Subdomain confusion or malformed URL | Parsed URL and label-boundary subdomain comparison; HTTPS only | Registry changes can approve an overly broad parent domain. Review every domain addition and test deceptive suffixes |
| Source failure triggers leak/mirror fallback | Per-source isolation and honest manual official links; no unofficial fallback | Users can independently leave the tool; reports must not treat those materials as primary official evidence |
| Stored NARA API content violates current terms | Worker/browser `no-store`, upstream cache disabled, no raw NARA record return, locator-only IndexedDB and export sanitizer for general and RG-profile results | A future persistence or export path could omit the shared sanitizer; regression tests remain required |
| Full queries, addresses, relay tokens, stream-purpose headers, or PDF bytes appear in logs | Worker observability disabled; no body/query/header/PDF logging in application code; address used only for an in-memory hash; relay responses are passed through; manual handoffs show exactly which terms will be sent and open only on user action | The signed token is carried in the content URL, and GitHub, Cloudflare, NARA, GovInfo, NTRS, OSTI, a manually selected official source, browser, proxy, or enterprise infrastructure may log independently. Private mode is not anonymity; do not share a relay URL |
| Publication or STI result mistaken for declassification evidence | Separate GovInfo/NTRS/OSTI source identities, `not_determined` or `metadata_only` defaults, warnings, and documented corpus limits | An official public record can still be overread. Researchers must verify release mechanism and agency determination at the controlling official source |
| NARA RG profile mistaken for native CIA/State FOIA coverage | Separate source IDs and provenance, fixed record-group filters, visible warnings, native adapters retained as manual/unavailable | NARA holdings are incomplete and users may ignore labels. Reports must not merge profile and native source-run claims |
| XSS or active content through title, embedded PDF text, source metadata, or imported data | React text rendering, no source HTML injection, printable HTML escaping, CSP, no plugin objects; PDF.js script evaluation and XFA disabled; annotations omitted from packet page rendering | Future rich HTML, markdown, OCR highlighting, PDF annotations/actions, or parser changes can bypass current assumptions; sanitize and test before use |
| Spreadsheet formula injection in CSV | Values beginning with `=`, `+`, `-`, or `@` are prefixed | Spreadsheet behaviors vary; open exports in protected mode and preserve source text |
| Malicious imported project | 20 MB byte cap, deep runtime schema and collection bounds, official-domain checks, React escaping, fixture claims cleared | Imported provenance and researcher judgments remain portable assertions rather than live source authentication; the UI marks them as not revalidated |
| Malicious, malformed, encrypted, or resource-exhausting official PDF | No upload; exact NARA host/path admission; no redirects; HEAD plus prefix-only signature inspection; accepted content type; hard 100 MiB streaming cap even without Worker-visible length; Worker only passes bytes through; browser verifies the signature, computes SHA-256, and then invokes PDF.js with XFA, script evaluation, and annotations disabled; bounded canvas/image work; embedded-text scan capped at 50,000 characters per page, 32 Mi characters total, and 5,000 pages; parser errors fail closed; beta `pdf-lib` work isolated to a cancellable two-minute browser worker | The complete source occupies browser memory, so mobile or low-memory devices may fail below 100 MiB. PDF.js, `pdf-lib`, the browser, and official host remain attack surfaces. Crafted page structures can still consume CPU/memory or exploit an unpatched parser. Keep dependencies/browser patched, cancel slow scans, and do not bypass warnings |
| Relay token theft, tampering, or replay | HMAC-SHA-256 signature over canonical source, NAID, any available size/validators, and expiry; constant-time signature comparison; two-hour lifetime; content path cannot change upstream URL; no application logging; rate limits | The token is signed but not encrypted or user-bound and can be replayed by a holder until expiry. CORS is not authentication. Avoid sharing the content URL and rotate `RATE_LIMIT_SALT` if compromise is suspected |
| Full-stream relay abuse or response amplification | Byte ranges are rejected; exactly one view or derivative purpose is required; every response is terminated above 100 MiB; six view and three derivative streams per minute per ephemeral derived key; 20-second relay timeout; no cache/storage | Per-isolate limiting is not global. A legitimate open plus derivative can transfer the complete source twice, and repeated bounded streams can still consume NARA/Cloudflare bandwidth. Apply platform-level controls if operational evidence warrants them |
| PDF bytes, text, images, token, or stale decisions silently retained | IndexedDB schema stores packet manifest/decisions only; private mode bypasses persistence; source bytes, PDF.js text, and pages remain in memory; relay and browser requests use no-store; no backend storage; reopening recomputes the full source hash and preserves reviewed decisions only when received length and SHA-256 match | Browser memory, downloads, cache implementation, extensions, screenshots, swap, crash reports, provider telemetry, or device monitoring remain outside complete application control. The browser-computed hash detects a changed byte sequence but does not establish archival authenticity |
| Withdrawal-sheet description mistaken for released content pages | Separate `described_item` lane forbids start/end content pages and derivative export; a manual item defaults to `not_determined`; only a visible embedded-text withdrawal/redaction-sheet pattern supports a `withdrawal_notice_only` proposal; human review remains required | A source sheet itself may be incomplete or misunderstood. Described extent is not proof that the underlying pages are present or released |
| Research derivative mistaken for an official release or byte-identical extract | Derivatives require a reviewed physical page range; output and manifests say “Research derivative”; source/derivative hashes and canonical source links preserved; `/AA` actions and `/Annots` annotations removed; two-minute cancellable worker; described-only items cannot export | The file is rebuilt and intentionally not byte-identical. Downloaded filenames and later copies can lose context. Preserve the manifest and cite the official packet; the official source controls |
| Researcher-supplied Catalog association mistaken for verified provenance | UI and exports label the NAID/record association researcher supplied; only URL form and numeric consistency are validated; derivative provenance states that Opstalia did not verify the association | Researchers may overlook the caveat. Confirm on the controlling Catalog page that the record actually lists the PDF before relying on the association |
| Official PDF changes during or between sessions | The session binds any available ETag or Last-Modified value; the browser computes source SHA-256 during every open; derivative export computes SHA-256 over its second copy and requires a match; reopened saved work retains review state only when actual length and SHA-256 agree | Worker-visible validators and length can be absent, weak, or incorrectly maintained. SHA-256 detects byte changes between received copies but does not prove archival authenticity or the researcher-supplied record association |
| Clickjacking or cross-site embedding | CSP declares `frame-ancestors 'none'`; Worker CSP uses a response header | `frame-ancestors` in a meta CSP is not a substitute for a host response header. GitHub Pages header control is limited |
| Data loss from local-only storage | Explicit JSON/report export and import; clear/delete controls | Browser eviction, user clearing, profile loss, or device failure can destroy projects. Exports create new copies with separate privacy risk |
| Private-mode data unexpectedly retained | No project persistence, no share fragment, in-memory workspace, Worker no-store | Static assets/indexes may cache; screenshots, downloads, copied text, browser/extension state, provider logs, and previously saved projects remain |
| Cross-project access on GitHub Pages origin | Namespaced IndexedDB and no secrets in browser storage | Same-origin scripts under the GitHub Pages host are a broad trust boundary. Do not store restricted data; dedicated origin would reduce exposure |
| Pinned index tampering or staleness | FRUS commit pin; ISCAP/NDC/NARA-JFK source SHA-256; official URLs, generation dates, schema/minimum-size checks, known limitations; JFK declared-total and URL/RIF validation | Hash records what was fetched but is not an independent signature. Maintainer/build compromise, mutable official tables, stale source data, and incorrect official metadata remain possible |
| Dependency or Actions supply-chain compromise | Lockfile, minimal runtime dependencies, audit/scan scripts, intended CI checks | Lockfiles are not signatures. Pin Actions, review lockfile changes, use least-privilege tokens, and verify release artifacts |
| Incorrect "released in full" inference | Controlled status vocabulary; full requires explicit official language or recorded researcher decision | Source metadata may be ambiguous or wrong. Official determination and document-level review control |
| Redaction or exemption false positive | Deterministic patterns, confidence, source code dictionary, false-positive control, "ambiguous" label | OCR corruption and agency-specific legends can mislead. Detection is a lead, not a legal or classification determination |
| More-text-is-authentic inference | Version relationship reasons and explicit comparison caveat | Human confirmation can still be mistaken. Preserve provenance, page/stamp evidence, and uncertainty |
| Share-link privacy loss | Notes excluded; URL fragment not sent in HTTP request; private mode disables link creation | Fragment remains visible to page code, extensions, history sync, copied URLs, and shoulder surfing |
| Stale exemption dictionary | Version and last-verified fields; official citation per entry; agency-variation flag | Statutes, executive orders, agency legends, and URLs can change. Revalidate before each release |

## Misuse cases

### A researcher pastes classified text

This is prohibited. The application cannot reliably detect it. The security
notice and acknowledgement reduce accidental misuse but are not a technical
classification guard. The correct response is to stop, avoid redisclosure, and
follow the controlling organization's incident procedure. No maintainer should
request the text for debugging.

### A researcher enters a sensitive note in a live search

Search notes are local research annotations. The client explicitly strips the
field before serializing any Worker request, so it reaches neither the Worker
nor the selected official API. Notes can still be saved to IndexedDB and included in researcher-created
project/report exports. They must remain unclassified and unrestricted, and a
regression test should continue to prove the live-request exclusion.

### A malicious record title contains HTML

The title remains a string and React escapes it. Printable exports escape
markup. No adapter may return source HTML for direct insertion. Any future rich
rendering must use a strict sanitizer and test event handlers, SVG, URLs, CSS,
Unicode controls, and template breakouts.

### An attacker supplies `https://catalog.archives.gov.evil.example/`

Hostname comparison uses exact or dot-delimited subdomain matching, so this
suffix is rejected. New adapters must use the same parsed-URL policy and must
not implement string-prefix checks.

### An official site serves a dangerous PDF

The comparison workspace may display it in a sandboxed frame or navigate to it.
The Packet Lab Worker can fetch and full-stream it only from the exact admitted
NARA presidential-library path, but never parses or transforms it. The complete
source is held transiently in browser memory under a hard 100 MiB cap; PDF.js
parses it locally with active features disabled. Beta page extraction downloads
a second complete copy, requires matching source SHA-256, and is isolated in a
browser Web Worker. The embedded-text scan is bounded to 50,000 characters per
page, 32 Mi characters total, and 5,000 pages. Derivative processing is
cancellable, terminates after two minutes, and strips copied-page `/AA` and
`/Annots` entries. These controls reduce, but do not eliminate, parser and
resource-exhaustion risk. The user should keep the browser and application
dependencies patched, stop a slow or suspicious scan, and not bypass warnings.

### A forged project import claims official provenance

Import is a portability feature, not source authentication. An imported
provenance object can be altered outside Opstalia. The importer deeply
validates the structure and official URLs, clears fixture status, and applies a
visible "Imported · source not revalidated" state. The user must still revisit
the official link and run a live or controlled source check before treating
the imported provenance as current.

## Privacy and classification consequences

Search query confidentiality is limited by design: live queries must traverse
GitHub/Cloudflare and the selected official API, or a manually selected official site. Private mode
changes local Opstalia retention; it does not change the classification
boundary or provide anonymity.

The public build must never imply that:

- a query was anonymous;
- no infrastructure records exist;
- absence of a hit means no release exists;
- an OCR or metadata derivative is unclassified;
- a detected code establishes the status of the whole document; or
- a local or AI process can determine classification.

## Risk-acceptance boundaries

The following risks are accepted for the 1.0 unclassified research use case:

- local-project loss without user export;
- incomplete and stale source coverage, when clearly labeled;
- ordinary provider infrastructure telemetry;
- manual-source workflows where automation is not reliable or permitted;
- probabilistic redaction leads requiring human review; and
- per-isolate rather than globally durable application rate limiting.

The following are not accepted without a new design and review:

- any classified/CUI processing;
- public document upload or backend PDF parsing/transformation;
- a general-purpose PDF proxy, broader Packet Lab host/path, or redirect-following relay;
- frontend secrets;
- unofficial evidence admitted to the primary index;
- silent query, note, result, or response persistence;
- an external AI provider receiving document content;
- public multi-user project storage; or
- any Opstalia-c synchronization or cross-domain connection.

## Review triggers

Re-run the threat model when:

- the deployment origin, Worker domain, or provider changes;
- a new automated source or official domain is added;
- an adapter follows redirects or fetches a new record/file URL;
- the Packet Lab host/path, token contents/lifetime, full-stream limits,
  PDF.js or `pdf-lib` options, persisted manifest fields, or derivative behavior changes;
- document/image upload, OCR, server-side PDF parsing, PDF active-content support,
  or rich HTML is proposed;
- an AI provider is introduced;
- accounts, collaboration, analytics, or backend storage are introduced;
- NARA or another source changes terms;
- the exemption dictionary gains a new legal system;
- project import schema or export content changes;
- a dependency or build system changes materially;
- security findings show a failed assumption; or
- anyone proposes a connection to Opstalia-c.

## Verification evidence

A release review should retain:

- the source registry version and validation date;
- exemption dictionary version and verification date;
- FRUS commit and ISCAP/NDC/NARA-JFK source hashes;
- test, accessibility, dependency-audit, and secret-scan results;
- the release commit and deployed frontend/Worker identities;
- confirmation that NARA and GovInfo keys are absent from repository history, source
  maps, and frontend bundles;
- CORS, SSRF, no-store, timeout, and unofficial-domain rejection tests;
- Packet Lab host/path/NAID admission, redirect rejection, prefix-only content
  probe and cancellation, unverified-association labeling, HMAC tamper/expiry,
  optional source-validator changes, rejection of range requests, six/minute
  view and three/minute derivative scopes, hard 100 MiB full-stream ceiling,
  browser source hashing, matching derivative-source hash,
  50,000-character/32-Mi-character/5,000-page scan
  limits, two-minute derivative cancellation, `/AA`/`/Annots` stripping,
  browser-only parse, and manifest-only persistence tests; and
- confirmation that the required unclassified-use acknowledgement remains
  visible and enforced.
