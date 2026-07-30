export const SECRET_PATTERNS = [
  {
    name: "NARA API header value",
    pattern:
      /x-api-key["'\s:=]+(?!YOUR|REDACTED|placeholder|installed-with-wrangler-only|replace-with|test-only)[A-Za-z0-9_-]{16,}/i
  },
  {
    name: "NARA API secret",
    pattern:
      /\bNARA_API_KEY["'\s:=]+(?!YOUR|REDACTED|placeholder|installed-with-wrangler-only|replace-with|test-only)[A-Za-z0-9_-]{16,}/i
  },
  {
    name: "GovInfo API secret",
    pattern:
      /\bGOVINFO_API_KEY["'\s:=]+(?!YOUR|REDACTED|placeholder|installed-with-wrangler-only|replace-with|test-only)[A-Za-z0-9_-]{16,}/i
  },
  {
    name: "GovInfo API query key",
    pattern:
      /[?&]api_key=(?!YOUR|REDACTED|placeholder|installed-with-wrangler-only|replace-with|test-only)[A-Za-z0-9_-]{16,}/i
  },
  {
    name: "Cloudflare token",
    pattern:
      /\b(?:CF_API_TOKEN|CLOUDFLARE_API_TOKEN)["'\s:=]+(?!YOUR|REDACTED|placeholder|installed-with-wrangler-only|replace-with|test-only)[A-Za-z0-9_-]{30,}/i
  },
  {
    name: "Rate-limit salt",
    pattern:
      /\bRATE_LIMIT_SALT["'\s:=]+(?!YOUR|REDACTED|placeholder|installed-with-wrangler-only|replace-with|test-only)[A-Za-z0-9_-]{24,}/i
  },
  {
    name: "GitHub token",
    pattern: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}/i
  },
  {
    name: "Private key",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/
  }
];

export function findSecretKinds(content) {
  return SECRET_PATTERNS
    .filter((entry) => entry.pattern.test(content))
    .map((entry) => entry.name);
}
