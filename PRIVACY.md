# Privacy statement

Effective: 2026-07-29

Opstalia 1.0 is designed to minimize data collection. It has no user accounts,
third-party analytics, advertising, behavioral tracking, or remote fonts.
This statement describes the public GitHub Pages frontend and Cloudflare Worker
implementation in this repository.

## First: use unclassified information only

Opstalia is a purely unclassified application on the regular Internet. Do not
enter, upload, paste, or transmit classified information, CUI, PII, or other
restricted material.

Opstalia 1.0 is not connected to **Opstalia-c** or any closed network. It has no
synchronization service, bridge, connector, shared database, or transfer
automation. A possible future closed-network system is documented only as a
design concept in
[`docs/FUTURE_LOCAL_ANALYST.md`](docs/FUTURE_LOCAL_ANALYST.md).

## Data flow at a glance

```text
                         public static assets and pinned indexes
Your browser  <------------------------------------------------ GitHub Pages
     |
     | selected unclassified NARA target + one plan query (HTTPS POST)
     v
Cloudflare Worker
     |
     | q, limit, API key, and supported NARA filters (HTTPS GET)
     v
NARA Catalog API

Your browser -- ordinary navigation/view request --> selected official website
```

FRUS, ISCAP, and NDC 1.0 searches run against checked-in public indexes delivered
with the frontend. They do not make a runtime search request to those upstream
sites. A manual adapter opens the relevant official site; the researcher
performs the search there.

## What leaves the browser

| Action | Recipient | Data sent |
| --- | --- | --- |
| Load Opstalia | GitHub Pages | Ordinary web-request data for HTML, JavaScript, CSS, and pinned public indexes, including network metadata made available to the host |
| Search FRUS, ISCAP, or NDC | No runtime search service | The query is evaluated in page memory against a static index already delivered by GitHub Pages |
| Search NARA | Cloudflare Worker | A validated search object containing the unclassified target metadata except research notes, one generated or edited query, limit/cursor if present, and the private-mode flag |
| Worker searches NARA | NARA Catalog API | Query text, limit, API credential, and supported filters such as NAID, dates, title, creator, geography, and material type |
| Use a manual adapter | Selected official repository | Normal browser request data; any search terms the user then enters on that official site |
| Open or compare an official file | Selected official repository | Normal navigation or embedded-view request data, including the requested official URL |
| Export a project/report | User-selected local destination | The generated file is created in the browser; subsequent cloud sync, email, or transfer is controlled by the user and their device |

The client explicitly removes the target's research-notes field before
serializing a live NARA request. The field therefore reaches neither the Worker
nor NARA. Research notes remain subject to the unclassified-only rule because
they can be stored locally and included in user-created project/report exports.

URL fragments used for shareable searches are not part of an HTTP request to
GitHub Pages, but they can remain in browser history, be read by code on the
page or extensions, and be exposed when the URL is copied or synchronized.
Research notes are omitted from share links. Private mode does not create a
share link.

## Local storage

For non-private projects, Opstalia stores the following in the browser's
namespaced IndexedDB database:

- search targets and editable search plans;
- source-run status and public indexed results;
- generated source locators;
- saved-record selections;
- comparison and version-group decisions;
- researcher annotations, corrections, and judgment bases;
- report and audit metadata; and
- browser-local preferences.

This data remains until the user deletes a project, selects **Clear all local
data**, clears site storage, or the browser removes it. Opstalia does not
replicate it to an application database.

GitHub Pages project sites under the same scheme and host share an origin.
Browser storage is not an authorized repository for sensitive material.

The **Clear all local data** control clears Opstalia's IndexedDB project and
preference stores. It does not remove:

- downloaded exports;
- browser or synchronized history containing a shared-search fragment;
- operating-system backups;
- extension, proxy, endpoint-monitoring, or network records;
- GitHub, Cloudflare, NARA, or other official-site infrastructure records; or
- information copied into another application.

## NARA Catalog data

The source registry and current [NARA Catalog API
terms](https://www.archives.gov/research/catalog/help/api) say API-returned
content must not be cached or stored. Opstalia applies that rule as follows:

- browser and Worker fetches use `no-store`;
- the Worker disables the Cloudflare cache for the upstream request;
- no KV, D1, Durable Object, or other backend persistence is configured;
- application code does not log NARA bodies or full queries;
- raw NARA records are not included in the Worker response;
- live normalized NARA data is held only in the active page's memory; and
- persistence reduces a NARA result to a generated NAID/official-URL locator
  plus researcher-created review information.

Project JSON, Markdown, CSV, printable HTML, and copied reports apply the same
locator sanitizer before output. An exported NARA hit therefore contains the
generated locator and researcher-created review data rather than the live API
metadata. The official record can always be revisited through the saved NARA
URL. The canonical technical policy is recorded in the `nara` entry of
[`data/sources.json`](data/sources.json).

## Cloudflare Worker processing

For a NARA search, Cloudflare receives the HTTPS request and its ordinary
network metadata. The Worker:

- validates the origin, content type, body size, and request schema;
- reads the client address supplied by Cloudflare only to derive a truncated,
  salted rate-limit key;
- keeps that key and minute counter in ephemeral Worker-isolate memory;
- does not write it to an Opstalia log or durable store;
- does not log the request body, full query, authorization data, or IP address;
- adds the secret API key only to the outbound NARA request; and
- returns a `no-store` response.

Cloudflare may process or retain infrastructure and security telemetry under
its own policies. Disabling Worker observability and application logging does
not make the request anonymous.

## Private search mode

Private mode:

- prevents the active project from being saved to IndexedDB;
- prevents Opstalia search-history persistence;
- avoids creating a shareable search fragment;
- uses `no-store` for live NARA requests; and
- keeps active project state in memory so reload or tab close discards it.

Private mode does **not**:

- anonymize a user or query;
- stop a selected live query from reaching Cloudflare and NARA;
- stop normal requests to GitHub Pages or a manually opened official site;
- prevent network, browser, extension, operating-system, or enterprise
  monitoring;
- erase copied text, screenshots, downloads, or previously saved projects; or
- disable normal caching of static application assets and pinned public
  indexes.

## Logs and service-provider data

Opstalia application code does not intentionally record full queries, request
bodies, API keys, authorization headers, or IP addresses. GitHub, Cloudflare,
NARA, and other official repositories are independent service operators and
may maintain access, security, or operational logs under their own policies.
Opstalia does not control their retention or legal obligations.

## Cookies and analytics

The application does not set an Opstalia account or analytics cookie. A hosting
provider, official site, browser extension, enterprise gateway, or embedded
viewer may act independently. Consult the relevant provider's notice before
using its service.

## Imports, exports, and screenshots

The only public-build upload control is local Opstalia project JSON import. The
file is read in the browser, limited to 20 MB by application code, and validated
before local persistence. It is not sent to the Worker.

Exports and screenshots can contain search terms, official-source locators, and
researcher notes. The user is responsible for choosing an appropriate storage
location and for applying organizational review before sharing them. Opstalia
1.0 does not transmit an export to Opstalia-c.

## Changes and questions

Material privacy changes should update this file, the in-application Privacy
page, and the security/data-flow documentation together. Report a privacy or
security defect through the private process in [`SECURITY.md`](SECURITY.md);
never include restricted information in a report.
