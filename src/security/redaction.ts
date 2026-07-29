const SECRET_PATTERNS = [
  /x-api-key\s*[:=]\s*[^\s,;]+/gi,
  /authorization\s*[:=]\s*(?:bearer\s+)?[^\s,;]+/gi,
  /NARA_API_KEY\s*[:=]\s*[^\s,;]+/gi,
  /CF_API_TOKEN\s*[:=]\s*[^\s,;]+/gi
];

export function redactSecrets(value: unknown): string {
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }
  return SECRET_PATTERNS.reduce((current, pattern) => current.replace(pattern, "[REDACTED]"), text);
}

export function normalizeError(error: unknown): { code: string; message: string } {
  const message = redactSecrets(error instanceof Error ? error.message : error);
  if (/timeout|abort/i.test(message)) return { code: "SOURCE_TIMEOUT", message: "The source did not respond before the timeout." };
  if (/429|rate.?limit/i.test(message)) return { code: "SOURCE_RATE_LIMIT", message: "The official source rate limit was reached." };
  if (/allowlist|SSRF|official domain/i.test(message)) return { code: "URL_POLICY_REJECTED", message };
  return { code: "SOURCE_ERROR", message: message.slice(0, 300) || "Unknown source error" };
}
