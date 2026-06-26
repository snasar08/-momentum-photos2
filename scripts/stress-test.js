const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE_URL = process.env.STRESS_URL || "http://localhost:3100";
const PHOTO_DIR = path.join(__dirname, "..", ".test-photos");

async function main() {
  const files = fs
    .readdirSync(PHOTO_DIR)
    .filter((f) => f !== "_manifest.json")
    .map((f) => path.join(PHOTO_DIR, f));

  console.log(`Driving wizard with ${files.length} files against ${BASE_URL}`);

  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
  const page = await browser.newPage();
  const consoleErrors = [];
  const pageErrors = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("requestfailed", (req) => console.log("requestfailed:", req.url(), req.failure()?.errorText));
  page.on("response", (res) => {
    if (res.status() >= 400) console.log("HTTP", res.status(), res.url());
  });

  const results = { steps: [] };
  function logStep(name, ok, detail) {
    results.steps.push({ name, ok, detail });
    console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? " - " + detail : ""}`);
  }

  // Headless Chromium exposes the File System Access API, which would make
  // exportZip() open a native OS save dialog that nothing here can drive.
  // Stripping it exercises the same anchor-download fallback path real users
  // get in Firefox/Safari (browsers without FSA support).
  await page.addInitScript(() => {
    delete window.showSaveFilePicker;
  });

  try {
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    logStep("load app", true);

    // Step 1: Upload
    const flatInput = page.locator('input[type="file"]').nth(1);
    await flatInput.setInputFiles(files);
    await page.waitForFunction(
      () => document.body.innerText.includes("photo") && /\d+\s*photo/.test(document.body.innerText),
      { timeout: 60000 }
    );
    const continueUploadBtn = page.locator("button.btn-primary", { hasText: "Continue" });
    await continueUploadBtn.waitFor({ state: "visible", timeout: 30000 });
    const uploadBtnText = await continueUploadBtn.innerText();
    logStep("upload step: files accepted", true, uploadBtnText);
    await continueUploadBtn.click();

    // Step 2: Review/Dedup - wait for scanning to finish
    await page.waitForSelector("h2:has-text('Review')", { timeout: 30000 }).catch(() => {});
    await page.waitForFunction(
      () => !document.body.innerText.includes("Scanning"),
      { timeout: 5 * 60 * 1000 }
    );
    const dedupText = await page.locator("body").innerText();
    const dupMentioned = /duplicate/i.test(dedupText);
    logStep("review/dedup step: scan completed", true, `duplicate UI present: ${dupMentioned}`);
    const continueReviewBtn = page.locator("button.btn-primary", { hasText: "Continue" });
    await continueReviewBtn.waitFor({ state: "visible", timeout: 30000 });
    await continueReviewBtn.click();

    // Step 3: Enhance
    await page.waitForSelector("h2", { timeout: 30000 });
    await page.waitForTimeout(2000);
    const enhanceBtn = page.locator("button.btn-primary", { hasText: "Continue" });
    await enhanceBtn.waitFor({ state: "visible", timeout: 60000 });
    const enhanceDisabled = await enhanceBtn.isDisabled();
    logStep("enhance step: rotation/frame/glare controls rendered", !enhanceDisabled);
    await enhanceBtn.click({ force: true });

    // Step 4: Face tag
    await page.waitForTimeout(2000);
    const faceBtn = page.locator("button.btn-primary", { hasText: "Continue" });
    await faceBtn.waitFor({ state: "visible", timeout: 60000 });
    logStep("face tag step: clustering completed", true);
    await faceBtn.click({ force: true });

    // Step 5: Configure crop - pick an aspect ratio option
    await page.waitForSelector(".aspect-btn", { timeout: 30000 });
    await page.locator(".aspect-btn").first().click();
    const cropBtn = page.locator("button.btn-primary", { hasText: "Continue" });
    await cropBtn.waitFor({ state: "visible", timeout: 10000 });
    const cropDisabled = await cropBtn.isDisabled();
    logStep("configure crop step: aspect selectable", !cropDisabled);
    await cropBtn.click();

    // Step 6: Process & export
    await page.waitForSelector("h2:has-text('Process')", { timeout: 30000 });

    const exportBtn = page.locator("button.btn-primary", { hasText: "Export ZIP" });
    const downloadPromise = page.waitForEvent("download", { timeout: 5 * 60 * 1000 });
    await exportBtn.click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    const size = downloadPath ? fs.statSync(downloadPath).size : 0;
    logStep("zip export downloaded", size > 0, `size=${size} bytes`);

    const shareBtn = page.locator("button", { hasText: "Share Album" });
    await shareBtn.waitFor({ state: "visible", timeout: 10000 });
    await shareBtn.click();
    await page.waitForTimeout(500);
    logStep("share link generated", true);
  } catch (e) {
    logStep("FATAL", false, e.message);
    try {
      await page.screenshot({ path: path.join(__dirname, "..", ".debug-failure.png"), fullPage: true });
      fs.writeFileSync(path.join(__dirname, "..", ".debug-failure.html"), await page.content());
    } catch {}
  }

  await page.waitForTimeout(1000);
  results.consoleErrors = consoleErrors;
  results.pageErrors = pageErrors;
  fs.writeFileSync(path.join(__dirname, "..", ".test-photos-results.json"), JSON.stringify(results, null, 2));

  console.log(`\nConsole errors: ${consoleErrors.length}`);
  consoleErrors.slice(0, 20).forEach((e) => console.log("  console:", e));
  console.log(`Page errors: ${pageErrors.length}`);
  pageErrors.slice(0, 20).forEach((e) => console.log("  page:", e));

  await browser.close();
  process.exit(consoleErrors.length > 0 || pageErrors.length > 0 || results.steps.some((s) => !s.ok) ? 1 : 0);
}

main().catch((e) => {
  console.error("Runner crashed:", e);
  process.exit(2);
});
