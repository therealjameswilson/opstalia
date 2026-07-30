# Opstalia 1.0 threat model

Status: public Internet release
Last reviewed: 2026-07-29

## Scope

This threat model covers:

- the React/Vite frontend served from GitHub Pages;
- browser-local IndexedDB and in-memory state;
- checked-in FRUS, ISCAP, and NDC indexes and their build scripts;
- the Cloudflare Worker NARA proxy;
- the NARA Catalog upstream request;
- registered manual links and official-file viewers;
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
| `NARA_API_KEY` and deployment credentials | Confidentiality and prompt revocation if exposed |
| Search terms and researcher notes | No application logging; local retention only when chosen |
| Saved projects and annotations | Integrity, local availability, explicit deletion/export |
| Official-source registry | Integrity and reviewable change history |
| Normalized record provenance | Integrity and non-repudiation of source/extraction method |
| Pinned indexes | Integrity, reproducibility, bounded coverage, freshness metadata |
| Release-status and exemption interpretations | Accuracy, cautious defaults, visible uncertainty |
| Public build and Worker | Integrity and correspondence to a reviewed release commit |
| Source availability and quota | Bounded use and graceful partial failure |

## Adversaries and hazardous actors

- an Internet user attempting to exhaust the Worker or NARA quota;
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
4. **Browser to Worker:** unclassified query text and network metadata cross
   the public Internet and Cloudflare edge.
5. **Worker to NARA:** a secret-bearing request crosses to the official API.
6. **Browser to manual source or file:** the user leaves Opstalia's runtime
   control and interacts with the official host. A displayed prefilled handoff
   transmits its prepared terms and filters when the user opens it.
7. **Import/export boundary:** user-controlled files enter or leave browser
   storage.
8. **Build pipeline to release:** dependencies and upstream source artifacts
   become executable code or searchable data.

## Threat and control register

| Threat | Existing 1.0 controls | Residual risk / required practice |
| --- | --- | --- |
| Classified, CUI, PII, or restricted data entered as search text | Prominent notice, affirmative acknowledgement, unclassified-only labels, no document upload | A public app cannot inspect or reliably classify inputs. User and organization remain responsible; stop and follow incident procedure if entered |
| Misbelief that Opstalia synchronizes with Opstalia-c | Repeated public-build boundary; no connector, route, datastore, or protocol | Future marketing or code could create ambiguity; any integration requires a new review and authorization |
| NARA key leaked into frontend or repository | Worker secret, placeholder environment file, ignore rules, health Boolean only, secret scanner, error redaction | Maintainer credential/build compromise or manual copy remains possible; inspect Git history and built source maps and rotate on suspicion |
| Cross-origin abuse of Worker | Exact origin allowlist and CORS rejection | CORS is not authentication and non-browser clients can send requests. Rate limiting and quota monitoring remain necessary |
| NARA quota exhaustion or denial of service | 30/minute per ephemeral derived key, at most three NARA plan variants, source timeout, one bounded retry, partial failure | Per-isolate limiter is neither global nor durable; distributed abuse can evade it. Cloudflare-level rate rules may be needed |
| SSRF or secret forwarding through source URL, query input, or redirect | Fixed NARA endpoint, HTTPS/host/authority/port checks, redirects rejected, no user-selectable outbound URL | A future adapter that accepts redirects or URLs could reopen SSRF. Revalidate every hop and DNS behavior before adding one |
| Unofficial source or generic official-site page presented as primary evidence | Registry-based domains, adapter/provenance match, and HTTPS are required; researcher locators from manual sources must also match adapter-specific direct record-page or record-file paths, so generic search-results, status, home, publications, collection, and navigation pages are rejected | An allowlisted direct record or file can still be unrelated, mislabeled, incomplete, or compromised. Researcher confirmation and human source-page review remain required |
| Subdomain confusion or malformed URL | Parsed URL and label-boundary subdomain comparison; HTTPS only | Registry changes can approve an overly broad parent domain. Review every domain addition and test deceptive suffixes |
| Source failure triggers leak/mirror fallback | Per-source isolation and honest manual official links; no unofficial fallback | Users can independently leave the tool; reports must not treat those materials as primary official evidence |
| Stored NARA API content violates current terms | Worker/browser `no-store`, upstream cache disabled, no raw NARA record return, locator-only IndexedDB and export sanitizer | A future persistence or export path could omit the shared sanitizer; regression tests remain required |
| Full queries or addresses appear in logs | Worker observability disabled; no body/query/header logging; address used only for an in-memory hash; manual handoffs show exactly which terms will be sent and open only on user action | GitHub, Cloudflare, NARA, a manually selected official source, browser, proxy, or enterprise infrastructure may log independently. Private mode is not anonymity |
| XSS through title, OCR, source metadata, or imported data | React text rendering, no source HTML injection, printable HTML escaping, CSP, no plugin objects | Future rich HTML, markdown, OCR highlighting, or PDF.js integration can bypass current assumptions; sanitize and test before use |
| Spreadsheet formula injection in CSV | Values beginning with `=`, `+`, `-`, or `@` are prefixed | Spreadsheet behaviors vary; open exports in protected mode and preserve source text |
| Malicious imported project | 20 MB byte cap, deep runtime schema and collection bounds, official-domain checks, React escaping, fixture claims cleared | Imported provenance and researcher judgments remain portable assertions rather than live source authentication; the UI marks them as not revalidated |
| Malicious or malformed official PDF | No upload or Worker parsing; approved HTTPS provenance; sandboxed browser frame | Browser PDF engine and official host remain attack surfaces. Do not bypass warnings; stronger isolation/content controls are prerequisites to processing |
| Clickjacking or cross-site embedding | CSP declares `frame-ancestors 'none'`; Worker CSP uses a response header | `frame-ancestors` in a meta CSP is not a substitute for a host response header. GitHub Pages header control is limited |
| Data loss from local-only storage | Explicit JSON/report export and import; clear/delete controls | Browser eviction, user clearing, profile loss, or device failure can destroy projects. Exports create new copies with separate privacy risk |
| Private-mode data unexpectedly retained | No project persistence, no share fragment, in-memory workspace, NARA no-store | Static assets/indexes may cache; screenshots, downloads, copied text, browser/extension state, provider logs, and previously saved projects remain |
| Cross-project access on GitHub Pages origin | Namespaced IndexedDB and no secrets in browser storage | Same-origin scripts under the GitHub Pages host are a broad trust boundary. Do not store restricted data; dedicated origin would reduce exposure |
| Pinned index tampering or staleness | FRUS commit pin; ISCAP/NDC source SHA-256; official URLs, generation dates, schema/minimum-size checks, known limitations | Hash records what was fetched but is not an independent signature. Maintainer/build compromise and stale source data remain possible |
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

### A researcher enters a sensitive note in a NARA search

Search notes are local research annotations. The client explicitly strips the
field before serializing a NARA request, so it reaches neither the Worker nor
NARA. Notes can still be saved to IndexedDB and included in researcher-created
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

The 1.0 Worker does not fetch or parse it. The browser may display it in a
sandboxed frame or navigate to it. The user should keep the browser patched and
not bypass warnings. A future processor requires the isolation and limits in
[`REDACTION_ANALYSIS.md`](REDACTION_ANALYSIS.md).

### A forged project import claims official provenance

Import is a portability feature, not source authentication. An imported
provenance object can be altered outside Opstalia. The importer deeply
validates the structure and official URLs, clears fixture status, and applies a
visible "Imported · source not revalidated" state. The user must still revisit
the official link and run a live or controlled source check before treating
the imported provenance as current.

## Privacy and classification consequences

Search query confidentiality is limited by design: live queries must traverse
GitHub/Cloudflare/NARA or a manually selected official site. Private mode
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
- public document upload or backend PDF processing;
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
- an adapter follows redirects or fetches a record URL;
- document/image upload, OCR, PDF parsing, or rich HTML is proposed;
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
- FRUS commit and ISCAP/NDC source hashes;
- test, accessibility, dependency-audit, and secret-scan results;
- the release commit and deployed frontend/Worker identities;
- confirmation that the NARA key is absent from repository history, source
  maps, and frontend bundles;
- CORS, SSRF, no-store, timeout, and unofficial-domain rejection tests; and
- confirmation that the required unclassified-use acknowledgement remains
  visible and enforced.
