# Redaction and release-marking analysis

Status: Opstalia 1.0 behavior and safeguards
Last reviewed: 2026-07-29

## Scope and security boundary

Opstalia 1.0 analyzes only text already exposed by a supported official source
or included in a checked-in public official-source fixture/index. It is a
purely unclassified application on the regular Internet.

The public build:

- has no PDF, image, or source-document upload control;
- has no document-upload API route;
- does not accept classified, CUI, PII, or restricted material;
- does not run a browser or server OCR engine on a user document;
- does not download or parse PDFs in the Worker;
- has no connection or synchronization with Opstalia-c; and
- does not use an external AI provider.

Classification is not removed by scanning, OCR, transcription, paraphrase,
summarization, translation, metadata extraction, or marking detection.
Opstalia cannot determine whether information is classified.

## What 1.0 actually detects

The 1.0 module is deliberately narrow. It performs deterministic pattern
matching against source-provided text.

For a NARA record, the adapter combines, when present:

- the Catalog scope-and-content note;
- the Catalog title; and
- OCR/extracted text returned with an official digital-object description.

It then compares that text with the versioned dictionary in
[`../data/exemption-codes.json`](../data/exemption-codes.json) and with a small
set of generic phrases.

Dictionary aliases include FOIA, PRA, E.O. 13526, RD/FRD, and common processing
or release markings. Generic patterns currently include:

- `declassified in part` and `released in part`;
- `sanitized copy`;
- `page denied`;
- `referral` and `consultation`;
- `excision`; and
- bracketed phrases beginning with terms such as `deleted`, `not declassified`,
  `text omitted`, or `classification`.

For each text hit, Opstalia records:

- an internal marking ID;
- the exact matched text;
- a canonical dictionary code when recognized;
- the system or an ambiguous-marking label;
- a page number only if the caller supplied one;
- span length as unknown in the current text detector;
- a confidence score; and
- the deterministic `pattern_match` extraction method.

A recognized dictionary alias currently receives 0.95 confidence. A
non-dictionary code candidate receives 0.70. A generic phrase receives 0.80.
These are pattern-confidence values, not confidence that the legal
interpretation, classification, or whole-document release status is correct.

## What 1.0 does not detect automatically

The deployed application does not claim automated detection of:

- every black or white redaction;
- redaction geometry or the amount of removed text;
- substituted pages, missing attachments, or changed marginalia;
- referral/consultation disposition beyond a visible phrase;
- stamps that are present only in page pixels;
- handwriting or degraded typewriting;
- invisible text layers or OCR coordinate alignment;
- agency-specific code meanings absent from an official legend;
- malicious modifications to a PDF;
- authenticity or completeness; or
- classification or declassification status.

The utility `assessDarkRegion` is a low-level experimental primitive, not a
page-redaction detector. Given an already decoded RGBA region, it reports that
entire supplied region only when more than 75 percent of its pixels are nearly
black and opaque. It does not segment a page, distinguish a redaction from a
border/photograph/stamp, parse a PDF, or drive a production overlay by itself.

White-space detection and image-similarity matching are not implemented in the
public 1.0 analysis path.

## Human review

Detected codes appear as visible chips with dictionary tooltips. The researcher
review panel shows detections and lets a user mark a hit as a false positive.
The record preserves the original detection and the correction flag rather
than silently deleting the evidence.

A reviewer should:

1. open the official record and public copy;
2. verify the exact page, stamp, legend, and surrounding text;
3. distinguish a withholding authority from a classification category,
   processing label, or editorial omission;
4. determine whether the code applies to a span, page, attachment, or the whole
   record;
5. compare all available official versions;
6. record a judgment basis and unresolved questions; and
7. preserve an ambiguous marking as ambiguous when the evidence does not
   support a definition.

The required display label for an unresolved code is:

> Unrecognized or ambiguous release marking

## Redaction context

When source text includes a marking, a useful review view should preserve:

- the source-provided text before and after the hit;
- the exact token and original capitalization;
- official source and record URL;
- page number when source metadata supports one;
- whether the span length is known, estimated, or unknown;
- source OCR versus Opstalia extraction provenance;
- detector version and confidence; and
- any researcher correction.

Opstalia 1.0 stores the marking and record snippet but does not promise
coordinate-accurate before/after display for every source. Source-provided OCR
can omit a visual redaction, misread a code, combine page headers, or include
hidden text inconsistent with the image. The image controls.

## Relationship to release status

A marking hit and a release-status determination are separate facts.

- `released_in_full` requires explicit official full-release language or a
  recorded researcher determination.
- Explicit official `released in part` language can support
  `released_in_part`.
- A public copy plus a detected redaction indicator, without a controlled
  official status, supports only
  `released_with_redactions_status_unclear`.
- A public digital object with no detected marking remains `not_determined`
  unless a stronger official basis exists.
- A withdrawal sheet, finding aid, notification, or metadata record is not the
  released underlying document.

No black box is required for an agency to withhold text, and no visible black
box proves that every other portion was released or declassified.

## FRUS editorial text is not automatically a redaction

FRUS is an official edited publication. Bracketed omissions, editorial
insertions, source notes, and editorial annotations can describe the published
text without representing the geometry or release markings of an archival
facsimile.

The FRUS build normalizes TEI gaps as editorial omissions for discovery. Those
tokens must not automatically be converted to FOIA redactions, exemption
determinations, page coordinates, or evidence that an archival original was
released in the same form.

## Version comparison

The comparison workspace:

- preserves each version's repository and official URL;
- displays source-reported page count, OCR availability, release date,
  authority, codes, and digital-object count when present;
- calculates a deterministic word-level difference for available snippets;
- offers two sandboxed official-file frames;
- lets the researcher align page numbers; and
- records a human version-relationship decision.

The textual difference is capped to the first 1,500 whitespace-delimited words
per side. It is a research aid, not a forensic PDF diff. Source OCR quality,
line order, headers, stamps, and scanning can create differences unrelated to
withheld content.

More text, more pages, fewer visible boxes, or a later release date does not
establish authenticity, completeness, or a full release. Provenance and the
official agency determination control.

## Official image/PDF viewer

The comparison frame points the browser at an approved official HTTPS URL and
uses a sandbox. The Worker does not retrieve the file. The application does not
alter the source image.

An official domain is necessary provenance but not a file-safety guarantee.
PDFs can contain malformed structures, JavaScript, actions, attachments,
external references, oversized streams, or parser exploits. Users should:

- keep the browser and built-in PDF viewer patched;
- use the official record page before opening a file;
- not bypass a browser or endpoint-security warning;
- avoid opening downloaded files in a privileged editor; and
- preserve the original URL and checksum if a file is used as evidence.

## Required malicious-PDF strategy before processing is added

No public document-processing feature may ship until a review approves all of
the following:

### Admission

- Accept only a researcher-attested unclassified, publicly released copy.
- Require a registered official provenance URL or a separately documented
  manual provenance record.
- Never interpret the attestation as proof of classification status.
- Enforce an allowlist of file types and sniff magic bytes.
- Reject encrypted, password-protected, malformed, polyglot, and unsupported
  documents.

### Resource limits

- Apply strict compressed-byte, expanded-byte, object-count, page-count,
  dimension, memory, CPU, and wall-clock limits.
- Detect nested archives and decompression bombs.
- Reject external resources, incremental-update chains beyond a safe limit,
  oversized images, and pathological font/object graphs.

### Isolation

- Parse and rasterize in an isolated, unprivileged process or browser worker
  with no ambient credentials.
- Default-deny network, filesystem, clipboard, process, and device access.
- Disable document JavaScript, launch actions, forms, multimedia, embedded
  files, URLs, callbacks, and post-processing hooks.
- Use maintained libraries and treat parser/rasterizer CVEs as urgent.
- Never send source bytes, OCR, thumbnails, embeddings, or snippets to an
  external API.

### Output

- Generate separate, non-destructive overlays; never rewrite the evidence file.
- Bind every region to source file hash, page, coordinates, detector version,
  and confidence.
- Mark inferred redaction size as estimated unless source geometry establishes
  it.
- Preserve manual corrections and never conceal the original detector result.
- Keep processing memory-only by default and securely dispose of temporary
  files under the authorized environment's policy.

### Testing

- Include malformed xref tables, object streams, fonts, images, annotations,
  forms, actions, attachments, JavaScript, external links, polyglots, bombs,
  huge dimensions, OCR corruption, RTL/Unicode controls, and parser timeouts.
- Test that a parser crash or timeout cannot affect another source run.
- Test that no bytes or derivatives leave the approved processing boundary.

## Future local analyst mode

Only an authorized local or enclave module could safely add source-document
OCR and page analysis. That module is not deployed and may never call an
external OCR or AI service. Its proposed boundary, review gates, and separation
from Opstalia-c synchronization are in
[`FUTURE_LOCAL_ANALYST.md`](FUTURE_LOCAL_ANALYST.md).

## Validation checklist

For each release:

- verify the dictionary version and official citations;
- test every canonical code and alias;
- test mixed case, punctuation, OCR spacing, duplicates, and overlapping
  aliases;
- test HTML/script strings as inert text;
- test an unknown marking's label;
- test false-positive correction persistence;
- test that a detection alone never produces `released_in_full`;
- test that FRUS editorial omissions are not labeled as FOIA redactions;
- verify no public document-upload input or route exists; and
- verify no source content is sent to an external OCR or AI provider.
