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
Cloudflare Worker for the NARA Catalog adapter.

### Secrets

- `NARA_API_KEY` is a Worker secret. It must never be a `VITE_` variable,
  checked-in environment value, frontend constant, screenshot, build artifact,
  log entry, or client response.
- The health route reports only a Boolean readiness state.
- `.env.example` contains placeholders only; `.env*`, `.dev.vars`, Wrangler
  state, logs, and local files are ignored.
- Worker errors pass through secret-redaction logic before a response is
  returned.
- Install the key with:

  ```sh
  npm run worker:secret
  ```

  This invokes `wrangler secret put NARA_API_KEY --config
  worker/wrangler.toml`.

### Request and network controls

- The Worker accepts the production GitHub Pages origin plus the explicitly
  configured `FRONTEND_ORIGIN`; local origins are added only outside
  production.
- NARA search requests must be JSON, are limited to 16 KiB, and undergo runtime
  schema validation.
- The Worker limits requests per ephemeral, salted IP-derived key and enforces
  a source timeout.
- The NARA adapter uses a fixed HTTPS endpoint. Its outbound URL check rejects
  non-HTTPS schemes, unapproved hosts, user information, and explicit ports.
- The frontend and Worker request NARA data with `no-store`; the Worker disables
  Cloudflare response caching for the upstream call.
- Source failures are isolated. A failure does not broaden the source set or
  trigger a fallback to unofficial repositories.

### Official-source admission

A primary result is admitted only when all three conditions hold:

1. the adapter is registered in [`data/sources.json`](data/sources.json);
2. the result has matching adapter provenance; and
3. its official record or file URL uses HTTPS and matches that source's
   configured official-domain allowlist.

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
The 1.0 backend does not download, parse, rasterize, OCR, transform, or store
PDFs. Do not bypass browser warnings or download a file whose provenance cannot
be verified.

Any future PDF-processing feature must add, before deployment:

- strict source/provenance checks and an explicit unclassified-public-release
  attestation;
- byte, page, decompression, and processing-time limits;
- content sniffing rather than reliance on an extension or declared MIME type;
- isolation from the application and network;
- disabled JavaScript, actions, attachments, external references, and
  post-processing callbacks;
- a maintained parser/rasterizer and malware-scanning strategy;
- non-persistent processing by default; and
- dedicated malformed, polyglot, decompression-bomb, and parser-escape tests.

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
