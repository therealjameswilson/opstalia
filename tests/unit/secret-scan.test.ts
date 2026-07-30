import { describe, expect, it } from "vitest";
import { findSecretKinds } from "../../scripts/secret-scan-utils.mjs";

describe("repository secret scanner", () => {
  it("detects GovInfo URL keys and every named Worker secret", () => {
    const content = [
      ["NARA", "_API_KEY=", "n".repeat(32)].join(""),
      ["GOVINFO", "_API_KEY=", "g".repeat(32)].join(""),
      ["https://api.govinfo.gov/search?", "api_key=", "u".repeat(32)].join(""),
      ["RATE_LIMIT", "_SALT=", "r".repeat(32)].join(""),
      ["CLOUDFLARE", "_API_TOKEN=", "c".repeat(40)].join(""),
      ["x-api", "-key: ", "h".repeat(32)].join("")
    ].join("\n");
    expect(findSecretKinds(content)).toEqual(
      expect.arrayContaining([
        "NARA API secret",
        "GovInfo API secret",
        "GovInfo API query key",
        "Rate-limit salt",
        "Cloudflare token",
        "NARA API header value"
      ])
    );
  });

  it("ignores checked-in placeholders and Wrangler-only guidance", () => {
    expect(
      findSecretKinds(
        [
          "NARA_API_KEY=installed-with-wrangler-only",
          "GOVINFO_API_KEY=installed-with-wrangler-only",
          "RATE_LIMIT_SALT=placeholder",
          "CLOUDFLARE_API_TOKEN=YOUR_TOKEN",
          "x-api-key: REDACTED"
        ].join("\n")
      )
    ).toEqual([]);
  });
});
