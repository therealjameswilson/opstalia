import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test.describe("Opstalia research workflows", () => {
  test("states the public unclassified boundary on every entry point", async ({ page }) => {
    await page.goto("");
    await expect(page.getByText("Opstalia is an independent research tool")).toBeVisible();
    await expect(page.getByText("UNCLASSIFIED INTERNET APPLICATION", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Internet-only in version 1.0" })).toBeVisible();
    await expect(page.getByText("Opstalia 1.0 does not connect or synchronize with Opstalia-c or any closed network.")).toBeVisible();
  });

  test("requires acknowledgement and builds an editable exact-NAID plan", async ({ page }) => {
    await page.goto("#new-search");
    const quickTab = page.getByRole("tab", { name: "Quick search" });
    await quickTab.click();
    await page.getByLabel("Unclassified metadata and keywords").fill("NAID 1634221");
    await expect(page.getByRole("button", { name: "Build search plan" })).toBeDisabled();
    await page
      .getByLabel("I acknowledge this notice and will use only unclassified, unrestricted search information.")
      .check();
    await page.getByRole("button", { name: "Build search plan" }).click();
    await expect(page.getByRole("heading", { name: "Editable search plan" })).toBeVisible();
    const identifierQuery = page.locator(".query-list li").filter({ hasText: "identifier" });
    await expect(identifierQuery.getByRole("textbox")).toHaveValue("1634221");
    await expect(identifierQuery.getByRole("checkbox")).toBeChecked();
    await expect(page.getByText("No paid AI API generated these terms.")).toBeVisible();
  });

  test("isolates an unavailable live source while returning a local official-source result", async ({ page }) => {
    test.setTimeout(45_000);
    await page.goto("#new-search");
    await page.getByRole("tab", { name: "Quick search" }).click();
    await page.getByLabel("Unclassified metadata and keywords").fill("Reykjavik");
    await page
      .getByLabel("I acknowledge this notice and will use only unclassified, unrestricted search information.")
      .check();
    await page.getByRole("button", { name: "Build search plan" }).click();
    await page.getByRole("button", { name: "Search selected official sources" }).click();
    const progress = page.getByRole("region", { name: "Source progress" }).or(page.locator(".source-progress"));
    await expect(progress.getByText("National Archives Catalog")).toBeVisible({ timeout: 30_000 });
    await expect(progress.getByText("production Worker URL is not configured")).toBeVisible();
    await expect(progress.getByText("Office of the Historian / FRUS")).toBeVisible();
    await expect(page.getByRole("heading", { name: /\d+ of \d+ results/ })).toBeVisible({ timeout: 30_000 });
  });

  test("opens saved records, compares official versions, and records a version decision", async ({ page }) => {
    await page.goto("");
    const menu = page.getByRole("button", { name: /Menu/ });
    if (await menu.isVisible()) await menu.click();
    await page.getByRole("button", { name: "Saved Records" }).click();
    await expect(page.getByRole("heading", { name: "Saved records" })).toBeVisible();
    await expect(page.getByText("Reykjavik Memorandum of Conversation", { exact: true })).toBeVisible();

    if (await menu.isVisible()) await menu.click();
    await page.getByRole("button", { name: "Compare Versions" }).click();
    await expect(page.getByRole("heading", { name: "Compare public versions" })).toBeVisible();
    await expect(page.getByText("Deterministic relationship assessment")).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Left version" })).not.toHaveValue("");
    await expect(page.getByRole("combobox", { name: "Right version" })).not.toHaveValue("");
    await page.getByRole("button", { name: "Confirm probable version" }).click();
    await expect(page.getByText(/relationship score/)).toBeVisible();
  });

  test("shows authoritative exemption definitions", async ({ page }) => {
    await page.goto("#exemptions");
    await page.getByLabel("Search codes or definitions").fill("b7E");
    await expect(page.locator(".code-card")).toHaveCount(1);
    await expect(page.getByText("Protected law-enforcement techniques, procedures, or guidelines.")).toBeVisible();
    const authority = page.getByRole("link", { name: "Official authority" });
    await expect(authority).toHaveAttribute("href", /^https:\/\/www\.justice\.gov\//);
  });

  test("exports Markdown and round-trips a complete project JSON", async ({ page }) => {
    await page.goto("#projects");
    const exactProject = page.locator(".folder-card").filter({ hasText: "Exact match: Nixon and Elvis photograph" });
    const jsonDownloadPromise = page.waitForEvent("download");
    await exactProject.getByRole("button", { name: "Export JSON" }).click();
    const jsonDownload = await jsonDownloadPromise;
    const jsonPath = await jsonDownload.path();
    expect(jsonPath).toBeTruthy();
    const exported = JSON.parse(await readFile(jsonPath!, "utf8"));
    expect(exported.schema).toBe("opstalia-project-1.0");
    expect(exported.records[0].title.value).toBe("NARA Catalog record 1634221");

    await page.locator('input[type="file"]').setInputFiles(jsonPath!);
    await expect(page.getByText(/Imported Exact match: Nixon and Elvis photograph \(imported\)/)).toBeVisible();

    await exactProject.first().getByRole("button", { name: "Open" }).click();
    const markdownDownloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Markdown" }).click();
    const markdownDownload = await markdownDownloadPromise;
    const markdownPath = await markdownDownload.path();
    const markdown = await readFile(markdownPath!, "utf8");
    expect(markdown).toContain("# Opstalia research report");
    expect(markdown).toContain("source_reported: Fact directly supplied by an official source");
    expect(markdown).toContain("https://catalog.archives.gov/id/1634221");
  });

  test("private mode remains memory-only and warns that queries still leave the browser", async ({ page }) => {
    await page.goto("#new-search");
    await page.getByRole("tab", { name: "Quick search" }).click();
    await page.getByLabel("Unclassified metadata and keywords").fill("Reykjavik private-mode fixture");
    await page.getByLabel(/Private search mode/).check();
    await expect(page.getByText(/Queries still reach selected live official sources/)).toBeVisible();
    await page
      .getByLabel("I acknowledge this notice and will use only unclassified, unrestricted search information.")
      .check();
    await page.getByRole("button", { name: "Build search plan" }).click();
    await expect(page.getByRole("button", { name: "Copy search link" })).toHaveCount(0);
  });

  test("ships no plausible secret in browser resources and exposes only official evidence links", async ({ page }) => {
    const responses: string[] = [];
    page.on("response", async (response) => {
      if (response.request().resourceType() === "script") responses.push(await response.text());
    });
    await page.goto("#saved");
    await page.waitForLoadState("networkidle");
    const joined = responses.join("\n");
    expect(joined).not.toMatch(/x-api-key["'\s:=]+[A-Za-z0-9_-]{16,}/i);
    expect(joined).not.toMatch(/NARA_API_KEY\s*[:=]\s*["'][^"']+["']/);

    const evidenceLinks = await page.locator('a:has-text("Official record")').evaluateAll((links) =>
      links.map((link) => (link as HTMLAnchorElement).href)
    );
    expect(evidenceLinks.length).toBeGreaterThan(0);
    for (const url of evidenceLinks) {
      const hostname = new URL(url).hostname;
      expect(
        hostname.endsWith(".gov") ||
          hostname.endsWith(".mil") ||
          hostname === "archives.gov" ||
          hostname.endsWith(".archives.gov")
      ).toBe(true);
    }
  });
});
