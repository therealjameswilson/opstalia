import { readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { findSecretKinds } from "./secret-scan-utils.mjs";

const output = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { encoding: "utf8" });
const files = output.split(/\r?\n/).filter(Boolean);
const findings = [];
for (const file of files) {
  if (file === "package-lock.json" || file.startsWith("public/data/indexes/")) continue;
  const stat = statSync(file);
  if (!stat.isFile() || stat.size > 5_000_000) continue;
  const content = readFileSync(file, "utf8");
  for (const kind of findSecretKinds(content)) {
    findings.push(`${file}: ${kind}`);
  }
}
if (findings.length) {
  process.stderr.write(`Potential secrets found:\n${findings.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`Secret scan passed across ${files.length} tracked and unignored files.\n`);
