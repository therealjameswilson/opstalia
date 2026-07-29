const IDENTIFIER_PATTERNS = [
  /\bNAID[:#\s-]*(\d{4,})\b/gi,
  /\b(?:CIA-)?RDP[A-Z0-9-]{8,}\b/gi,
  /\b(?:F|MDR|ISCAP|NDC)-?\d{4}-\d{3,6}(?:-DOCS?\d+)?\b/gi,
  /\b\d{4}-\d{3}(?:-DOCS?\s?\d+(?:-\d+)?)?\b/gi,
  /\b(?:NSSM|NSDM|NSC|PDD|NSDD|PD|PRM|NIE|SNIE|EO)\s?[-–]?\s?\d{1,4}\b/gi,
  /\b(?:cable|telegram|memorandum|memo|report|document)\s+(?:no\.?\s*)?[A-Z0-9][A-Z0-9/_-]{2,}\b/gi
];

export function extractIdentifiers(text: string): string[] {
  const found = new Set<string>();
  for (const pattern of IDENTIFIER_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const value = (match[1] ?? match[0])
        .replace(/\s+/g, " ")
        .replace(/\s*[-–]\s*/g, "-")
        .trim()
        .toUpperCase();
      found.add(value);
    }
  }
  if (/^\d{4,}$/.test(text.trim())) found.add(text.trim());
  return [...found];
}
