## Summary

Describe the user-visible or maintenance outcome and why it is needed.

## Security and provenance boundary

- [ ] This change keeps Opstalia 1.0 entirely on the public, unclassified Internet and does not add Opstalia-c synchronization.
- [ ] It does not request, transmit, log, cache, commit, or expose classified information, CUI, PII, restricted material, credentials, or API keys.
- [ ] New release evidence is limited to allowlisted official U.S. Government domains and has adapter provenance plus an official record or file URL.
- [ ] Source-reported facts, Opstalia extraction, algorithmic inference, researcher decisions, and unknown values remain visibly distinct.
- [ ] Release-status logic remains cautious and does not infer “released in full” from appearance alone.

## Source-adapter review

Complete when source coverage changes:

- Official repository and documentation:
- Authentication and secret handling:
- Rate limits, terms, and robots review:
- CORS and implementation method:
- Returned fields and normalization:
- Known limitations and manual fallback:
- Registry validation date:

## Verification

- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run test:unit`
- [ ] `npm run test:integration`
- [ ] `npm run test:security`
- [ ] `npm run secret:scan`
- [ ] `npm run build`
- [ ] Keyboard, focus, contrast, and screen-reader behavior reviewed when UI changes
- [ ] No NARA or other API secret appears in source, fixtures, logs, screenshots, artifacts, or frontend bundles

## Documentation and screenshots

List documentation changes. For visual changes, attach only sanitized screenshots containing public, unclassified fixture data.

## Remaining limitations

State any partial implementation, unavailable source, manual step, or inference that still requires human review.
