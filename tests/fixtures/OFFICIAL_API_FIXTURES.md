# Official API fixture provenance

These compact excerpts preserve real response shapes while avoiding a large,
fragile snapshot of each upstream response. They are used only in recorded
integration tests; CI does not call the live services.

| Fixture | Official endpoint queried | Recorded |
| --- | --- | --- |
| `govinfo-search-response.json` | `POST https://api.govinfo.gov/search?api_key=DEMO_KEY` with `collection:FR`, `pageSize: 1` | 2026-07-30 UTC |
| `ntrs-search-response.json` | `GET https://ntrs.nasa.gov/api/citations/search?q=Apollo&page.size=10&page.from=0` (record `20180008545`) | 2026-07-30 UTC |
| `osti-search-response.json` | `GET https://www.osti.gov/api/v1/records?q=Apollo&rows=1&page=1` | 2026-07-30 UTC |

Only fields exercised by the adapters are retained. The fixtures contain
official public metadata and no credentials; the GovInfo `DEMO_KEY` appears
only in this provenance note because it is the documented shared demonstration
value, not a user secret.
