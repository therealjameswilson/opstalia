import { readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";

const patterns = [
  { name: "NARA API header value", pattern: /x-api-key["'\s:=]+(?!YOUR|REDACTED|placeholder)[A-Za-z0-9_-]{16,}/i },
  { name: "Cloudflare token", pattern: /\b(?:CF_API_TOKEN|CLOUDFLARE_API_TOKEN)["'\s:=]+(?!placeholder)[A-Za-z0-9_-]{30,}/i },
  { name: "GitHub token", pattern: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}/i },
  { name: "Private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ }
];

const output = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { encoding: "utf8" });
const files = output.split(/\r?\n/).filter(Boolean);
const findings = [];
for (const file of files) {
  if (file === "package-lock.json" || file.startsWith("public/data/indexes/")) continue;
  const stat = statSync(file);
  if (!stat.isFile() || stat.size > 5_000_000) continue;
  const content = readFileSync(file, "utf8");
  for (const entry of patterns) {
    if (entry.pattern.test(content)) findings.push(`${file}: ${entry.name}`);
  }
}
if (findings.length) {
  process.stderr.write(`Potential secrets found:\n${findings.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`Secret scan passed across ${files.length} tracked and unignored files.\n`);
