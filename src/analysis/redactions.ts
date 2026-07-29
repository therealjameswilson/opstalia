import { makeId } from "../core/id";
import type { ExemptionCode, ReleaseMarking } from "../core/types";

const GENERIC_MARKINGS = [
  /\b(?:declassified|released)\s+in\s+part\b/gi,
  /\bsanitized\s+copy\b/gi,
  /\bpage\s+denied\b/gi,
  /\breferral\b|\bconsultation\b/gi,
  /\bexcision\b/gi,
  /\[\s*(?:deleted|declassified|not declassified|text omitted|classification)\b[^\]]*\]/gi
];

export function detectReleaseMarkings(text: string, codes: ExemptionCode[], page?: number): ReleaseMarking[] {
  const markings: ReleaseMarking[] = [];
  const candidates = [
    ...codes.flatMap((code) => [code.code, ...code.aliases]),
    "(b)(1)",
    "(b)(2)",
    "(b)(3)",
    "(b)(4)",
    "(b)(5)",
    "(b)(6)",
    "(b)(7)",
    "(b)(8)",
    "(b)(9)"
  ];
  const escaped = [...new Set(candidates)]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
    .map((code) => code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (escaped.length) {
    const codePattern = new RegExp(`(?<![A-Za-z0-9])(?:${escaped.join("|")})(?![A-Za-z0-9])`, "gi");
    for (const match of text.matchAll(codePattern)) {
      const canonical = codes.find((code) =>
        [code.code, ...code.aliases].some((alias) => alias.toLocaleLowerCase() === match[0].toLocaleLowerCase())
      );
      markings.push({
        id: makeId("marking", `${page ?? 0}|${match.index}|${match[0]}`),
        code: canonical?.code ?? match[0],
        text: match[0],
        system: canonical?.system ?? "Unrecognized or ambiguous release marking",
        page,
        spanLength: "unknown",
        confidence: canonical ? 0.95 : 0.7,
        detectionMethod: "pattern_match"
      });
    }
  }
  for (const pattern of GENERIC_MARKINGS) {
    for (const match of text.matchAll(pattern)) {
      const duplicate = markings.some(
        (marking) =>
          marking.page === page &&
          marking.text?.toLocaleLowerCase() === match[0].toLocaleLowerCase()
      );
      if (duplicate) continue;
      markings.push({
        id: makeId("marking", `${page ?? 0}|${match.index}|${match[0]}`),
        text: match[0],
        system: "Unrecognized or ambiguous release marking",
        page,
        spanLength: "unknown",
        confidence: 0.8,
        detectionMethod: "pattern_match"
      });
    }
  }
  return markings;
}

export interface RedactionRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  page: number;
}

export function assessDarkRegion(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  page: number
): RedactionRegion[] {
  if (pixels.length !== width * height * 4 || width <= 0 || height <= 0) return [];
  let dark = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index] < 28 && pixels[index + 1] < 28 && pixels[index + 2] < 28 && pixels[index + 3] > 220) dark += 1;
  }
  const ratio = dark / (width * height);
  return ratio > 0.75
    ? [{ x: 0, y: 0, width, height, confidence: Math.min(0.98, ratio), page }]
    : [];
}
