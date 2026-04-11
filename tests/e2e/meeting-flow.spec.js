import { test, expect } from "@playwright/test";

test("user can start a session and receive transcript and summary", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Join, Capture, Summarize" })).toBeVisible();

  await page.getByLabel("Google Meet Link").fill("https://meet.google.com/abc-defg-hij");
  await page.getByLabel("Bot Name").fill("E2E Bot");
  await page.getByLabel("Listen Seconds").fill("30");

  await page.getByRole("button", { name: "Start Bot" }).click();

  await expect(page.locator(".card-status .status")).toContainText("completed", {
    timeout: 45000
  });

  await expect(page.locator(".card-transcript pre")).toContainText("Kickoff started", {
    timeout: 45000
  });

  await expect(page.locator(".card-summary")).not.toContainText("Summary appears after processing.");
});