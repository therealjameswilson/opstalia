import { expect, test } from "@playwright/test";
import { resolve } from "node:path";

type AxeResult = {
  violations: Array<{ id: string; impact: string | null; help: string; nodes: unknown[] }>;
};

const pages = [
  ["dashboard", ""],
  ["new search", "#new-search"],
  ["source coverage", "#coverage"],
  ["exemption guide", "#exemptions"],
  ["security", "#security"],
  ["privacy", "#privacy"]
] as const;

for (const [name, hash] of pages) {
  test(`${name} has no critical or serious axe violations`, async ({ page }) => {
    await page.addInitScript({ path: resolve("node_modules/axe-core/axe.min.js") });
    await page.goto(hash);
    const result = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (context: Document, options: unknown) => Promise<AxeResult> } }).axe;
      return axe.run(document, {
        resultTypes: ["violations"],
        rules: {
          "color-contrast": { enabled: true }
        }
      });
    });
    const blocking = result.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious");
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });
}
