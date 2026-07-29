# Exemption and release-marking dictionary

Dictionary: [`../data/exemption-codes.json`](../data/exemption-codes.json)
Version: 1.0.0
Last verified in data: 2026-07-29

## Purpose

The local dictionary gives researchers an authoritative starting point for
interpreting visible codes and release-processing phrases on official public
copies. It does not determine:

- whether information is classified;
- whether a withholding is legally valid;
- whether a record is released in full or in part;
- whether a code applies to a span, page, attachment, or whole record; or
- whether a copied or OCR-read marking is accurate.

A code identifies a stated category, authority, or process. The exact source
image, page legend, agency, date, case history, and official determination
control.

## Data contract

Each entry contains:

| Field | Meaning |
| --- | --- |
| `code` | Stable Opstalia display token |
| `aliases` | Text forms accepted by deterministic matching |
| `system` | FOIA, PRA, E.O. 13526, Atomic Energy Act, or release/processing context |
| `shortDefinition` | Tooltip-sized official-source-based summary |
| `detailedDefinition` | Longer plain-language description |
| `authority` | Statute, Executive Order section, or official source category |
| `officialCitationUrl` | HTTPS U.S. Government source supporting the entry |
| `lastVerified` | Date the entry and link were reviewed |
| `notes` | Interpretation limits or collection-specific cautions |
| `interpretationVariesByAgency` | Whether the source legend/context commonly controls meaning |

The file also contains:

- a semantic `version`;
- a dictionary-level `lastVerified`; and
- an `interpretationWarning` displayed in the application.

## Current coverage

The 1.0.0 file contains 45 entries:

- FOIA exemptions `b1` through `b9`, including `b7A` through `b7F`;
- Presidential Records Act categories `P1` through `P6`;
- E.O. 13526 classification categories `1.4(a)` through `1.4(h)`;
- E.O. 13526 automatic-declassification exemptions `3.3(b)(1)` through
  `3.3(b)(9)`;
- Restricted Data (`RD`) and Formerly Restricted Data (`FRD`);
- `RELEASED IN PART`;
- `SANITIZED COPY`;
- `REFERRAL`;
- `CONSULTATION`; and
- `WITHDRAWAL SHEET`.

Coverage does not imply that these are all codes used by every agency or in
every historical period. Legacy notations and collection legends vary.

## Official authorities used in 1.0

The authoritative link is stored on each entry. Principal official references
in the current file are:

- Department of Justice, [Freedom of Information Act, 5 U.S.C.
  § 552](https://www.justice.gov/oip/freedom-information-act-5-usc-552);
- National Archives, [Presidential Records Act of
  1978](https://www.archives.gov/presidential-libraries/laws/1978-act.html);
- National Archives/ISCAP, [redaction codes and E.O. 13526
  categories](https://www.archives.gov/declassification/iscap/redaction-codes.html);
- National Archives/ISCAP, [mandatory declassification review
  appeals](https://www.archives.gov/declassification/iscap/mdr-appeals.html);
  and
- Obama Presidential Library, [electronic records research
  guide](https://obamalibrary.archives.gov/research/electronic-records-guide)
  for the withdrawal-sheet caution in the current entry.

The dictionary must not replace an official definition with a blog, vendor
guide, crowdsourced list, or unofficial copy.

## Interpretation rules

### FOIA

The codes in the dictionary summarize statutory exemption categories in
5 U.S.C. § 552(b).

- A bare `b3` is incomplete research evidence. Record the qualifying withholding
  statute when visible.
- A bare `b7` omits the harm category. Record the lettered subcode when visible.
- The presence of an exemption code does not state how much of the record was
  reviewed, what else is absent, or whether another authority applies.
- A later version may use fewer or different FOIA codes without proving that
  the versions are otherwise identical.

### Presidential Records Act

`P1` through `P6` correspond to the categories in 44 U.S.C. § 2204(a). The
specific presidential-library or collection withdrawal-sheet legend controls.
The same-looking shorthand can be formatted differently across collections,
and a withdrawal sheet is not the withdrawn record.

### E.O. 13526 categories

Sections `1.4(a)` through `1.4(h)` identify subject categories eligible for
classification under the Order. A category code is not:

- proof that the current public copy remains classified in the same way;
- an independent release-completeness finding; or
- a statement of the omitted span's length.

Sections `3.3(b)(1)` through `3.3(b)(9)` concern exemptions from automatic
declassification. Historical `25X`-style notation must be interpreted with the
document's date and legend; do not assume a one-to-one mapping without official
context.

### RD and FRD

Restricted Data and Formerly Restricted Data arise under the Atomic Energy Act,
not ordinary E.O. 13526 classification alone. Do not infer that declassification
under an executive order removes RD/FRD controls.

### Processing and release phrases

- `RELEASED IN PART` is relevant official language but does not establish the
  status of missing attachments or other versions.
- `SANITIZED COPY` supports a cautious partial/unclear assessment unless
  authoritative metadata supplies a controlled status.
- `REFERRAL` and `CONSULTATION` describe processing and are not release
  determinations.
- `WITHDRAWAL SHEET` describes an access record or placeholder, not the
  underlying document.

## Matching behavior

The detector compares source-provided text with the canonical code and aliases
case-insensitively. It preserves the exact matched token and maps it to the
canonical entry when possible.

The application:

- displays recognized codes as chips;
- exposes the short definition as a tooltip;
- provides the full definition, authority, notes, variation flag, and official
  link in the Exemption Guide;
- stores pattern-match confidence and provenance; and
- allows a researcher to mark a detection false.

An unmatched token must be labeled:

> Unrecognized or ambiguous release marking

The detector must not guess the nearest legal code, ask an external model to
interpret the source document, or silently add an unsupported definition.

## Dictionary maintenance

Every change should:

1. start from an official government source;
2. preserve the source's legal distinction between a statute, restriction,
   classification category, processing term, and release marking;
3. record an exact HTTPS official citation;
4. use a concise definition that does not add unsupported meaning;
5. add agency/collection variation notes when needed;
6. update the entry and file verification dates;
7. increment the semantic dictionary version when behavior or meaning changes;
8. add aliases only when an official example or reviewed public record supports
   them;
9. test canonical forms, aliases, punctuation, OCR spacing, overlap, and false
   positives; and
10. review the in-application guide and exported reports for consistent
    language.

Do not delete a historical code merely because a current source no longer uses
it. If an authority is superseded, preserve the historical entry with dated
notes and add the successor separately.

## Review checklist for a visible marking

Record:

- exact marking and capitalization;
- page and location;
- surrounding text;
- official record/file URL;
- agency and collection;
- release or review date;
- page legend or withdrawal-sheet legend;
- cited statute, executive-order section, or case number;
- whether the marking is source-reported or OCR-extracted;
- confidence and any correction; and
- the effect, if any, on the controlled release-status determination.

If any of these are unavailable, preserve that fact as unknown. Do not infer a
whole-document conclusion from the code alone.

## Security boundary

The dictionary contains public definitions only. It is not permission to enter
a source document into Opstalia. The public application remains unclassified
and Internet-connected, has no document upload, and is not connected to
Opstalia-c.

See [`REDACTION_ANALYSIS.md`](REDACTION_ANALYSIS.md) for detector limitations
and [`SECURITY_MODEL.md`](SECURITY_MODEL.md) for the full data boundary.
