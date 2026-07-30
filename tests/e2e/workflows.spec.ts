import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

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
    await page.getByRole("button", { name: "Run adapters and prepare handoffs" }).click();
    const progress = page.getByRole("region", { name: "Source progress" }).or(page.locator(".source-progress"));
    await expect(progress.getByText("National Archives Catalog")).toBeVisible({ timeout: 30_000 });
    await expect(progress.getByText("production Worker URL is not configured")).toBeVisible();
    await expect(progress.getByText("Office of the Historian / FRUS")).toBeVisible();
    await expect(page.getByRole("heading", { name: /\d+ of \d+ results/ })).toBeVisible({ timeout: 30_000 });
  });

  test("prepares honest State and CIA handoffs without treating either as zero-result search", async ({ page }) => {
    test.setTimeout(45_000);
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("#new-search");
    await page.getByLabel("Title or subject").fill("Memorandum from Scowcroft to Bush");
    await page.getByLabel("Exact phrase").fill("Malta Summit");
    await page.getByLabel("General keywords").fill("Malta");
    await page.getByLabel("Date from").fill("1989-11-01");
    await page.getByLabel("Date to").fill("1990-01-31");
    await page
      .getByLabel("I acknowledge this notice and will use only unclassified, unrestricted search information.")
      .check();
    await page.getByRole("button", { name: "Build search plan" }).click();
    await page.getByRole("button", { name: "Run adapters and prepare handoffs" }).click();

    const progress = page.locator(".source-progress");
    const stateRun = progress.locator("li").filter({ hasText: "Department of State FOIA Virtual Reading Room" });
    await expect(stateRun.getByRole("link", { name: /Open prefilled State search/ })).toBeVisible({ timeout: 30_000 });
    await expect(stateRun).toContainText("Prepared a user-initiated search on the official source");
    await expect(stateRun).toContainText("Handoff only");
    await expect(stateRun).not.toContainText("0 results");

    const stateHref = await stateRun
      .getByRole("link", { name: /Open prefilled State search/ })
      .getAttribute("href");
    expect(stateHref).toBeTruthy();
    const stateUrl = new URL(stateHref!);
    expect(stateUrl.origin).toBe("https://foia.state.gov");
    expect(stateUrl.pathname).toBe("/FOIALIBRARY/SearchResults.aspx");
    expect(stateUrl.searchParams.get("searchText")).toBe(
      '"Malta Summit" Memorandum from Scowcroft to Bush Malta'
    );
    expect(stateUrl.searchParams.get("beginDate")).toBe("11-01-1989");
    expect(stateUrl.searchParams.get("endDate")).toBe("01-31-1990");
    expect(stateHref).toContain("searchText=%22Malta%20Summit%22%20Memorandum%20from%20Scowcroft%20to%20Bush%20Malta");

    const ciaRun = progress.locator("li").filter({ hasText: "CIA FOIA Electronic Reading Room" });
    await expect(ciaRun).toContainText("official source is unavailable upstream");
    await expect(ciaRun).toContainText("Handoff only");
    await expect(ciaRun).not.toContainText("0 results");
    const copyCiaTerms = ciaRun.getByRole("button", { name: "Copy CIA search terms" });
    await expect(copyCiaTerms).toBeVisible();
    await copyCiaTerms.click();
    await expect(ciaRun.getByRole("button", { name: "Copied" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("Malta Summit");
    await expect(ciaRun.getByRole("link", { name: /View CIA search service notice/ })).toHaveAttribute(
      "href",
      "https://www.cia.gov/redirects/search-unavailable/"
    );

    await stateRun.getByText("Record a result found on the official site").click();
    await stateRun.getByLabel("Official record title").fill("Researcher-recorded Malta locator");
    await stateRun
      .getByLabel("Official record or file URL")
      .fill("https://foia.state.gov/DOCUMENTS/1-FY2012/F-2011-01588/DOC_0C17684682/C17684682.pdf");
    await stateRun
      .getByLabel("I confirm this URL identifies an unclassified, publicly released record on the official agency domain.")
      .check();
    await stateRun.getByRole("button", { name: "Add official result" }).click();
    await expect(stateRun).toContainText("Official locator added to this project and Saved Records.");
    await expect(stateRun).toContainText("1 recorded");
    await expect(page.getByText("Researcher-recorded Malta locator", { exact: true })).toBeVisible();

    await page.goto("#projects");
    const savedProject = page.locator(".folder-card").filter({ hasText: "Memorandum from Scowcroft to Bush" });
    await savedProject.getByRole("button", { name: "Open" }).click();
    const reopenedStateRun = page
      .locator(".source-progress li")
      .filter({ hasText: "Department of State FOIA Virtual Reading Room" });
    await expect(reopenedStateRun.getByRole("button", { name: "Open prefilled State search" })).toBeDisabled();
    await page
      .getByLabel("I acknowledge this notice and will use only unclassified, unrestricted search information.")
      .check();
    await expect(reopenedStateRun.getByRole("link", { name: /Open prefilled State search/ })).toBeVisible();
    const manualRecord = page.locator(".record-card").filter({ hasText: "Researcher-recorded Malta locator" });
    await manualRecord.getByRole("button", { name: "★ Saved" }).click();
    await expect(manualRecord.getByRole("button", { name: "☆ Save record" })).toBeVisible();
    await page.getByRole("button", { name: "Run adapters and prepare handoffs" }).click();
    await expect(page.getByText("Researcher-recorded Malta locator", { exact: true })).toBeVisible({
      timeout: 30_000
    });
    const rerunRecord = page.locator(".record-card").filter({ hasText: "Researcher-recorded Malta locator" });
    await expect(rerunRecord.getByRole("button", { name: "☆ Save record" })).toBeVisible();
    await expect(
      page
        .locator(".source-progress li")
        .filter({ hasText: "Department of State FOIA Virtual Reading Room" })
    ).toContainText("1 recorded");
  });

  test("keeps manual-source actions beside CIA and State names in source coverage", async ({ page }) => {
    await page.goto("#coverage");

    const ciaRow = page.locator("tr").filter({ hasText: "CIA FOIA Electronic Reading Room" });
    await expect(ciaRow.getByRole("link", { name: "Prepare CIA retry terms" })).toBeVisible();
    await expect(ciaRow.getByRole("link", { name: /View CIA search service notice/ })).toBeVisible();

    const stateRow = page.locator("tr").filter({ hasText: "Department of State FOIA Virtual Reading Room" });
    await expect(stateRow.getByRole("link", { name: "Prepare search handoff" })).toBeVisible();
    await expect(stateRow.getByRole("link", { name: /Open State FOIA search/ })).toBeVisible();
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
    test.setTimeout(45_000);
    await page.goto("#new-search");
    await page.getByRole("tab", { name: "Quick search" }).click();
    await page.getByLabel("Unclassified metadata and keywords").fill("Reykjavik private-mode fixture");
    await page
      .getByLabel("I acknowledge this notice and will use only unclassified, unrestricted search information.")
      .check();
    await page.getByRole("button", { name: "Build search plan" }).click();
    await expect.poll(() => page.evaluate(() => location.hash)).toContain("#search?");
    await page.getByLabel(/Private search mode/).check();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("#new-search");
    await expect(page.getByText(/Queries still reach selected live official sources/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy search link" })).toHaveCount(0);
    await page.getByRole("button", { name: "Run adapters and prepare handoffs" }).click();
    await expect(page.getByText(/Private mode kept this project in memory only/)).toBeVisible({
      timeout: 30_000
    });
    await page.goto("#projects");
    await expect(
      page.locator(".folder-card").filter({ hasText: "Reykjavik private-mode fixture" })
    ).toHaveCount(0);
  });

  test("keeps an imported private project memory-only", async ({ page }, testInfo) => {
    await page.goto("#projects");
    const exactProject = page.locator(".folder-card").filter({ hasText: "Exact match: Nixon and Elvis photograph" });
    const jsonDownloadPromise = page.waitForEvent("download");
    await exactProject.getByRole("button", { name: "Export JSON" }).click();
    const jsonDownload = await jsonDownloadPromise;
    const exportedPath = await jsonDownload.path();
    const exported = JSON.parse(await readFile(exportedPath!, "utf8"));
    exported.privateMode = true;
    const privateImportPath = testInfo.outputPath("private-project.json");
    await writeFile(privateImportPath, JSON.stringify(exported), "utf8");

    await page.locator('input[type="file"]').setInputFiles(privateImportPath);
    await expect(page.getByRole("heading", { name: "Define the target record" })).toBeVisible();
    await expect(page.getByLabel(/Private search mode/)).toBeChecked();
    await expect(page.getByLabel(/Private search mode/)).toBeDisabled();

    await page.goto("#projects");
    await expect(
      page.locator(".folder-card").filter({ hasText: "Exact match: Nixon and Elvis photograph (imported)" })
    ).toHaveCount(0);
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
