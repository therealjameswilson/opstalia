# Security policy

## The security boundary

**Opstalia 1.0 is a purely unclassified application on the regular Internet.**
It is not an authorized system for classified records, controlled unclassified
information (CUI), personally identifiable information (PII), or other
restricted material.

Do not enter, upload, paste, transmit, or attach restricted material. Use only
unclassified, unrestricted metadata and sanitized search terms.

Opstalia 1.0 has no connection to, synchronization with, bridge to, or network
route into **Opstalia-c** or any closed network. A future connection would be a
separate system requiring an explicit security review and authorization. No
such capability is present or approved now.

Classification is not removed by transcription, paraphrase, OCR, summarization,
translation, metadata extraction, or entry into a search form. Opstalia and its
maintainers cannot determine whether information is classified.

## Supported versions

| Version | Security support |
| --- | --- |
| 1.x public release | Supported |
| Pre-release branches and forks | Best effort; not production-authorized |

The repository's published release and deployed URLs should be compared before
assuming that a fix is live.

## Reporting a vulnerability

Use GitHub's private vulnerability-reporting flow for
[`therealjameswilson/opstalia`](https://github.com/therealjameswilson/opstalia/security)
when it is available. Include:

- the affected commit, URL, route, or component;
- a minimal, unclassified reproduction;
- the security impact and preconditions;
- whether the issue could expose a secret, query text, local project, or
  unofficial URL as official evidence; and
- a safe way to confirm the fix.

Do not open a public issue containing an exploit, credential, private query,
PII, CUI, or classified information. If private reporting is unavailable, use
the repository owner's GitHub profile to request a private contact channel
without disclosing the vulnerability details.

Never send suspected classified information to the maintainer as evidence. If
an incident involves information governed by your employer or agency, stop
using Opstalia and follow that organization's security-incident procedures.

The maintainer will aim to acknowledge a complete, safely submitted report
within seven calendar days. Remediation timing depends on severity,
reproducibility, and deployment control. This is a response target, not a
service-level agreement.

## Deployed security design

The public build uses a static React application on GitHub Pages and a
Cloudflare Worker with six fixed search-adapter IDs: `nara`,
`nara-cia-rg263`, `nara-state-rg59`, `govinfo`, `nasa-ntrs`, and `osti-sti`.
The same Worker exposes a narrowly validated Packet Lab session route and a
bounded NARA presidential-library full-file relay; those routes are not search
adapters or a general fetch proxy.

### Secrets

- `NARA_API_KEY`, `GOVINFO_API_KEY`, and `RATE_LIMIT_SALT` are Worker secrets.
  They must never be `VITE_` variables, checked-in environment values,
  frontend constants, screenshots, build artifacts, log entries, or client
  responses.
- The health route reports public service/version metadata, registered adapter
  IDs, policy summaries, and only Boolean readiness for the NARA, GovInfo, and
  Packet Lab relay secrets. It never returns a secret value.
- `.env.example` contains placeholders only; `.env*`, `.dev.vars`, Wrangler
  state, logs, and local files are ignored.
- Worker errors pass through secret-redaction logic before a response is
  returned.
- Install only the secrets required by the enabled adapters and deployment:

  ```sh
  npm run worker:secret:nara
  npm run worker:secret:govinfo
  npm run worker:secret:rate-limit
  ```

  NARA and the two opt-in NARA record-group profiles share `NARA_API_KEY`.
  GovInfo uses `GOVINFO_API_KEY`. NTRS and OSTI require no Opstalia source API
  key.

### Request and network controls

- The Worker accepts the production GitHub Pages origin plus the explicitly
  configured `FRONTEND_ORIGIN`; local origins are added only outside
  production.
- Every Worker search request must be JSON, is streamed with a 16 KiB limit,
  and undergoes runtime schema validation.
- Upstream responses must be JSON and valid UTF-8. Streamed response bodies are
  capped at 12,000,000 bytes for NARA and 5,000,000 bytes each for GovInfo,
  NTRS, and OSTI, whether or not `Content-Length` is present.
- The Worker limits requests per ephemeral, salted IP-derived key and enforces
  a source timeout.
- Every adapter uses a fixed HTTPS endpoint. Outbound URL checks reject
  non-HTTPS schemes, unapproved hosts, user information, and explicit ports.
- NARA retries one transient upstream failure once. GovInfo, NTRS, and OSTI
  make one timeout-bounded upstream attempt.
- The frontend and Worker use `no-store`; the Worker disables Cloudflare
  response caching for every upstream call.
- Packet Lab admission sends `HEAD`, then starts a full `GET`, reads only the
  five-byte PDF signature prefix, and cancels the admission body. Opening and
  derivative routes reject ranges, pass one complete response through without
  application buffering, and terminate a stream above 100 MiB.
- Source failures are isolated. A failure does not broaden the source set or
  trigger a fallback to unofficial repositories.

### Official-source admission

A primary result must pass all applicable admission checks:

1. the adapter is registered in [`data/sources.json`](data/sources.json);
2. the Worker route, source run, raw records, normalized record, and adapter
   provenance retain the selected source ID;
3. its official record or file URL uses HTTPS and matches that source's
   configured official-domain allowlist;
4. every returned record-page, download, thumbnail, and digital-object URL is
   on that source's approved HTTPS domains; and
5. source-specific file binding passes: GovInfo PDFs match the package/granule
   IDs, NTRS downloads match the citation ID, and OSTI full text matches the
   OSTI ID.

NARA exposes a digital-object link only when it is a direct recognized public
file on an approved `archives.gov` host. Other reported NARA storage locators
are omitted.

The public build does not treat leaks, mirrors, media caches, personal sites,
commercial repositories, crowdsourced archives, social uploads, anonymous
hosts, or unofficial GitHub copies as official release evidence.

### Data minimization and NARA terms

Current [NARA Catalog API
terms](https://www.archives.gov/research/catalog/help/api) are implemented as a
no-cache/no-storage rule for API-returned content:

- the Worker has no KV, D1, Durable Object, or response-cache persistence;
- application code does not log request bodies or full queries;
- raw NARA responses are not returned as `RawSourceRecord` objects;
- NARA results remain transient in the active browser workspace; and
- IndexedDB persistence reduces a saved NARA result to a generated NAID and
  official-URL locator plus researcher-created review information.

NARA-derived exports must follow the same locator-only rule. See
[`PRIVACY.md`](PRIVACY.md) for the complete data-flow and retention statement.

### Browser-side controls

- React renders search and OCR text as text rather than executable markup.
- Printable HTML escapes generated report content.
- CSV export prefixes formula-like cell values to reduce spreadsheet formula
  injection.
- External links use `noopener noreferrer`.
- The frontend policy blocks plugins and base-URL changes and limits scripts,
  connections, images, and frames. A response-header CSP remains preferable to
  a meta-delivered CSP where hosting permits it.
- Imported project JSON is limited to 20 MB, receives deep runtime structural
  validation, and has every result/file URL checked against its registered
  official-source allowlist. It is data, not executable code. Imported fixture
  claims are cleared and imported provenance is visibly marked as not
  revalidated.

## Document and PDF handling

Opstalia 1.0 has **no document-upload control or upload endpoint**. The only
local file input is an Opstalia project JSON import.

Official public PDFs may be linked or displayed in a sandboxed browser frame.
They remain untrusted active content even when hosted on an official domain.

The PDF Packet Lab is a narrow exception to direct browser retrieval. It accepts
no file upload and only an acknowledged public, unclassified locator on the exact
NARA presidential-library media path plus a researcher-supplied canonical NAID
record URL. URL and numeric consistency checks do not prove that the record
lists the PDF; the researcher must confirm that association on the official
record page.

During admission the Worker sends `HEAD`, then starts a full `GET`, reads only
the five-byte `%PDF-` prefix, and cancels the body. A Worker-visible length or
ETag may be absent. Opening makes a separate full-file request and passes one
copy through to browser memory under a hard 100 MiB streaming cap. The browser
computes actual received length and SHA-256 before PDF.js parses and slices the
completed bytes locally. Derivative export makes a disclosed second full-source
transfer and proceeds only when its newly computed source SHA-256 matches the
opening hash.

The Worker does not parse, rasterize, OCR, transform, cache, or store a PDF. It
uses no R2, KV, D1, Durable Object, PDF cache, or response cache. Relay responses
are `no-store`; application code does not log their bodies. PDF.js disables
script evaluation and XFA, omits annotations from page rendering, and bounds
image, scan, and derivative work. Sources above 100 MiB are unsupported. Do not
bypass browser warnings or use a file whose provenance cannot be verified.

See [`docs/REDACTION_ANALYSIS.md`](docs/REDACTION_ANALYSIS.md).

## Private search mode is not anonymity

Private mode prevents Opstalia from writing the active project or search history
to its IndexedDB database and prevents creation of a shareable search fragment.
The workspace exists in page memory and is discarded on reload or tab close.

It does not hide traffic from GitHub, Cloudflare, NARA, an official site opened
manually, the browser, installed extensions, the operating system, a network
operator, or an organization's monitoring systems. Queries still leave the
browser when a live source requires them. Static application assets and pinned
public indexes may still use normal browser caching.

## If restricted information is entered

1. Stop the search and do not copy the material into an issue or vulnerability
   report.
2. Close the tab. If it was a non-private project, use **Clear all local data**
   and remove any downloaded exports and share-link history under your
   organization's procedures.
3. Do not assume that clearing browser state removes provider, proxy, endpoint,
   backup, or organizational records.
4. Notify the appropriate security authority for the system and information
   involved.

Opstalia cannot sanitize or downgrade the information and is not an incident
reporting system.

## Security limitations

- A public Internet application cannot enforce a user's classification or
  handling judgment.
- GitHub and Cloudflare may retain infrastructure telemetry under their own
  policies even though Opstalia application code disables analytics and body
  logging.
- Browser storage on a shared GitHub Pages origin should not be treated as a
  secure enclave.
- Pinned public indexes can become stale or be affected by an upstream or build
  compromise; their provenance, commit/hash, and validation date require
  review.
- Official hosting does not prove a PDF is safe, complete, authentic, or a full
  release.
- Visible absence of redaction blocks does not establish release in full.
- Human review is required for match, version, release-status, and marking
  conclusions.

The fuller control description is in
[`docs/SECURITY_MODEL.md`](docs/SECURITY_MODEL.md), and the risk register is in
[`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md).
