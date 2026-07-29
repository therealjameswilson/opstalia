# Contributing to Opstalia

Thank you for helping improve Opstalia. Contributions must preserve its research integrity, official-source policy, and public-system security boundary.

## Non-negotiable security boundary

Opstalia 1.0 is an unclassified application on the regular public Internet. Do not put classified information, controlled unclassified information, personally identifiable information, export-controlled information, or other restricted material in:

- issues, discussions, pull requests, commit messages, screenshots, or test fixtures;
- search fields, sample projects, logs, telemetry, or error reports;
- source indexes, documentation, or generated artifacts; or
- any service used by the public build.

Never add a workflow inviting a user to upload, paste, summarize, transcribe, OCR, or otherwise process classified or restricted source material. Classification is not removed by transcription, paraphrase, OCR, summarization, or metadata extraction.

There is no connection to **Opstalia-c** in version 1.0. Do not add synchronization code, network routes, bridge services, shared storage, automated exports, or claims of interoperability with a closed-network system. Any future connection requires a separate architecture decision, authorization boundary, threat model, and explicit security review.

If a proposed change could weaken this boundary, stop and open a security-design issue containing only unclassified information.

## Official-source-only policy

Primary release evidence may enter the unified result set only when all three conditions are true:

1. the record URL uses HTTPS and its hostname matches the source's configured official-domain allowlist;
2. the record carries provenance from the matching registered adapter; and
3. the record has an official record-page or file URL.

Do not add leaked-document sites, mirrors, media caches, personal sites, commercial repositories, crowdsourced archives, social-media uploads, anonymous file hosts, or unofficial GitHub copies as release evidence. A scholarly or secondary source may someday help formulate a search, but it is not official release evidence in Opstalia 1.0.

When reliable automation is unavailable, prohibited, or dependent on an undocumented endpoint, contribute a useful manual-search adapter. Do not replace an honest manual adapter with brittle scraping.

## Development setup

Requirements:

- Node.js 22.13 or newer
- npm
- Wrangler only when developing or deploying the Cloudflare Worker

Install and run the application:

```sh
npm ci
npm run dev
```

Run the Worker separately when testing the live NARA route:

```sh
npm run worker:dev
```

`VITE_API_BASE` is public frontend configuration. It is safe only for the Worker URL; no secret may be placed in any `VITE_` variable.

Install the NARA key through Wrangler, never through a checked-in file:

```sh
npm run worker:secret
```

This invokes `wrangler secret put NARA_API_KEY --config worker/wrangler.toml`. Never print, copy into documentation, commit, screenshot, or expose the value.

## Before opening a pull request

Run:

```sh
npm run lint
npm run typecheck
npm run test
npm run build
npm run secret:scan
npm run audit
```

Run the relevant Playwright suites when a user workflow, accessibility behavior, security header, or deployment path changes:

```sh
npm run test:e2e
npm run test:a11y
```

Tests in normal continuous integration must be deterministic and must not require a live government source, a production API key, or a deploy token. Use checked-in, public, non-sensitive fixtures. A source refresh is a separate reviewed operation, not an implicit part of `npm test` or `npm run build`.

## Source-adapter contributions

Every source change must begin with the registry in `data/sources.json`. Record:

- source ID, display name, agency, and official domains;
- current API or search capability;
- authentication and rate-limit information;
- robots and terms constraints;
- implementation method and adapter status;
- supported filters and returned fields;
- known limitations and an official manual-search URL; and
- the date on which those claims were actually validated.

Adapters must implement the common `SourceAdapter` contract or use the browser-local adapter pattern. Keep source-specific parsing out of the federated orchestrator. Preserve source failures as source-specific status; one failure must not discard results from other sources.

An automated adapter must also:

- construct outbound URLs from fixed official endpoints, not user-provided hosts;
- validate inputs and upstream response shapes;
- normalize into the shared TypeScript model without discarding provenance;
- preserve raw source data separately when source terms permit;
- pass every primary result through the official-domain and provenance policy;
- provide timeouts, bounded retries, and normalized errors; and
- include a manual official-source fallback.

Never label an adapter `integrated` or `beta` without a real, tested search path. A source that only opens an official website is `manual`, not an automated integration.

## NARA API terms

NARA's current Catalog API terms say not to cache or store content returned by the API and set a default limit of 10,000 queries per month per key. See the [official NARA Catalog API page](https://www.archives.gov/research/catalog/help/api).

That constraint is part of the architecture:

- NARA responses remain transient in memory.
- The Worker sends `Cache-Control: no-store` and does not cache source responses.
- The NARA adapter returns no persisted raw-response records.
- Browser persistence reduces a NARA result to a generated NAID/official-URL locator plus researcher-created review data.
- A later search must rehydrate current NARA metadata from the official API.

Do not commit captured NARA API responses, add a NARA response cache, persist returned metadata in IndexedDB, or copy API content into test fixtures. Use synthetic minimal response shapes for parser tests, or independently verify public fixture facts on the official record page. If NARA changes its terms, update the implementation, registry, tests, and documentation together before changing this rule.

## Refreshing checked-in source indexes

The FRUS, ISCAP, and NDC adapters search checked-in indexes in the browser. They do not scrape official sites at runtime.

Run a refresh intentionally:

```sh
npm run indexes:frus
npm run indexes:iscap
npm run indexes:ndc
```

Or refresh all three:

```sh
npm run indexes:refresh
```

For every refresh:

1. re-check the official interface, terms, and robots directives;
2. verify the generator's official source URL or pinned source commit;
3. inspect record counts, source hashes, coverage metadata, and official-domain URLs;
4. review a representative sample against the official pages;
5. explain material additions, removals, or schema changes in the pull request;
6. update the registry validation date and limitations only when they were revalidated; and
7. commit the generator and generated index together when either changes.

Do not hand-edit generated JSON. Do not silently broaden an index's claimed coverage. In particular, the version 1.0 FRUS index is partial: it contains 752 documents from `frus1981-88v03`, `frus1981-88v05`, and `frus1981-88v06` at pinned commit `56d9b6899758c7de95de58b48b20507a1edb9f9f`. It is not a series-wide FRUS index.

Source-refresh automation should be manual or scheduled, isolated from ordinary pull-request CI, and opened for human review. A government-site outage or layout change must not make unrelated CI fail or silently replace a known-good index.

## Provenance and interpretation

Retain the distinction among:

- facts reported directly by an official source;
- values extracted or normalized by Opstalia;
- algorithmic inferences;
- researcher confirmations or corrections; and
- unknown or unavailable information.

Every normalized field should retain its source, extraction method, confidence, and any researcher override. Do not overwrite a source-reported value with an inference.

Release status must use the controlled vocabulary in `src/core/types.ts`. In particular, never infer `released_in_full` merely because a copy appears complete or has no obvious black boxes. That status requires explicit official full-release language, official status metadata, or a documented researcher determination. FRUS is an official edited publication, not necessarily a facsimile of the full underlying record; bracketed editorial omissions are not automatically archival redactions.

Scores and version labels must remain deterministic and explainable. They are research leads, not probabilities, authentication findings, legal judgments, or classification determinations.

## Pull-request expectations

A focused pull request should:

- describe the user-visible change and its evidence basis;
- identify affected sources and any changed network data flow;
- include tests for normalization, allowlist enforcement, failure isolation, and cautious status logic as applicable;
- document new limitations rather than hiding them;
- contain no secrets or restricted information; and
- avoid unrelated generated-file or formatting churn.

By contributing, you agree that your contribution is licensed under the repository's MIT License.
