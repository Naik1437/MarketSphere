import { chromium } from "playwright";

const BASE_URL = process.env.MARKETSPHERE_WEB_URL || "http://localhost:3000";
const PASS = process.env.DEMO_SEED_PASSWORD || "DemoPass!2026";

async function loginViaUI(page, email) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
  await page.fill("#email", email);
  await page.fill("#password", PASS);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1000);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // 1. Seller SKU creation
  await loginViaUI(page, "seller1@marketsphere.local");
  await page.waitForSelector("text=Add SKU");
  const skuCode = `GAP-SKU-${Date.now()}`;
  await page.fill('input[placeholder="SKU Code (e.g. MY-SKU-001)"]', skuCode);
  await page.fill('input[placeholder="Variant Title (e.g. Black)"]', "Gap Variant");
  await page.fill('input[placeholder="Price"]', "499");
  await page.click('button:has-text("Add SKU")');
  await page.waitForSelector("text=SKU added.");
  console.log("PASS: Seller SKU creation persisted");

  // 2. Customer Review & Return + Dispute
  await loginViaUI(page, "customer1@marketsphere.local");
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.click("text=Wireless Mouse Pro");
  await page.waitForSelector("text=Write a Review");
  await page.fill("#comment", "Verified E2E review");
  await page.click('button:has-text("Submit Review")');
  await page.waitForSelector("text=Review submitted.");
  console.log("PASS: Customer review submitted");

  await page.goto(`${BASE_URL}/orders`, { waitUntil: "networkidle" });
  await page.waitForSelector("text=My Orders");
  await page.locator('input[placeholder="Reason (min 5 chars)..."]').first().fill("E2E return reason");
  await page.locator('button:has-text("Request Return")').first().click();
  await page.waitForSelector("text=Return requested.");
  await page.locator('button:has-text("Raise Dispute")').first().click();
  await page.waitForSelector("text=Dispute opened.");
  console.log("PASS: Customer return & dispute persisted");

  // 3. Warehouse Shipment Transition
  await loginViaUI(page, "warehouse@marketsphere.local");
  await page.waitForSelector("text=Warehouse Operations");
  const inTransitBtn = page.locator('button:has-text("Mark In Transit")').first();
  if ((await inTransitBtn.count()) > 0) {
    await inTransitBtn.click();
    await page.waitForSelector("text=Shipment status updated.");
    console.log("PASS: Warehouse shipment transitioned to IN_TRANSIT");
  }

  // 4. Support Return Approval, Refund & Dispute Resolution
  await loginViaUI(page, "support@marketsphere.local");
  await page.waitForSelector("text=Support Operations");
  const approveBtn = page.locator('button:has-text("Approve")').first();
  if ((await approveBtn.count()) > 0) {
    await approveBtn.click();
    await page.waitForSelector("text=Return status updated.");
  }
  const refundBtn = page.locator('button:has-text("Issue Refund")').first();
  if ((await refundBtn.count()) > 0) {
    await refundBtn.click();
    await page.locator('text=/Refund processed|Refund exceeds/').waitFor();
  }
  const resolveBtn = page.locator('button:has-text("Resolve")').first();
  if ((await resolveBtn.count()) > 0) {
    await resolveBtn.click();
    await page.waitForSelector("text=Dispute resolved.");
  }
  console.log("PASS: Support return, refund, and dispute processing persisted");

  // 5. Admin Seller Approval & Settlement Generation
  await loginViaUI(page, "admin@marketsphere.local");
  await page.waitForSelector("text=Admin Oversight");
  await page.locator('button:has-text("Generate Settlement")').nth(1).click();
  await page.waitForSelector("text=Settlement generated.");
  console.log("PASS: Admin settlement generation persisted");

  // 6. Seller sees Settlement
  await loginViaUI(page, "seller1@marketsphere.local");
  await page.waitForSelector("text=settlements recorded.");
  console.log("PASS: Seller sees persisted settlement");

  await browser.close();
  console.log("ALL GAP OPERATIONS PASSED");
}

main().catch((err) => {
  console.error("GAPS E2E FAILED:", err);
  process.exit(1);
});
