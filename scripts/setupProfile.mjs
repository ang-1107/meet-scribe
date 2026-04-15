#!/usr/bin/env node

/**
 * One-time Google account login setup for Meet Scribe.
 *
 * This script opens a visible Chromium browser using the same stealth
 * configuration as the bot, navigates to Google Accounts, and lets
 * you log in manually.  Once you sign in, your session cookies are
 * saved to the persistent Chrome profile directory so all future bot
 * runs are authenticated automatically.
 *
 * Usage:
 *   node scripts/setupProfile.mjs
 *
 * Optional env overrides:
 *   MEETSCRIBE_CHROME_PROFILE_DIR  –  custom profile path
 */

import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

chromium.use(StealthPlugin());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveProfileDir() {
  if (process.env.MEETSCRIBE_CHROME_PROFILE_DIR) {
    return path.resolve(process.env.MEETSCRIBE_CHROME_PROFILE_DIR);
  }
  return path.join(path.resolve(__dirname, ".."), "data", "chrome-profile");
}

const ANTI_DETECT_ARGS = [
  "--disable-blink-features=AutomationControlled",
  "--use-fake-ui-for-media-stream",
  "--autoplay-policy=no-user-gesture-required",
  "--disable-dev-shm-usage",
  "--disable-features=IsolateOrigins,site-per-process",
  "--disable-infobars",
  "--no-first-run",
  "--no-default-browser-check"
];

const REALISTIC_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";


async function main() {
  const profileDir = resolveProfileDir();
  fs.mkdirSync(profileDir, { recursive: true });

  console.log("");
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║         Meet Scribe — Google Account Setup               ║");
  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log("║                                                          ║");
  console.log("║  A browser window will open to Google Accounts.          ║");
  console.log("║  Please sign in with the Google account you want         ║");
  console.log("║  the bot to use when joining meetings.                   ║");
  console.log("║                                                          ║");
  console.log("║  After successful sign-in, the session will be saved     ║");
  console.log("║  so the bot stays logged in for all future runs.         ║");
  console.log("║                                                          ║");
  console.log("║  Close the browser window when you're done.              ║");
  console.log("║                                                          ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log("");
  console.log(`  Profile directory: ${profileDir}`);
  console.log("");

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    args: ANTI_DETECT_ARGS,
    ignoreDefaultArgs: ["--enable-automation"],
    viewport: { width: 1280, height: 800 },
    userAgent: REALISTIC_USER_AGENT,
    locale: "en-US",
    timezoneId: "America/New_York",
    permissions: ["microphone", "camera"]
  });

  const page = context.pages()[0] || (await context.newPage());

  // Stealth: override navigator.webdriver at page level.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", {
      get: () => undefined
    });
    if (window.chrome) {
      window.chrome.runtime = window.chrome.runtime || {};
    } else {
      window.chrome = { runtime: {} };
    }
  });

  await page.goto("https://accounts.google.com", {
    waitUntil: "domcontentloaded",
    timeout: 30000
  });

  console.log("  ⏳ Waiting for you to sign in...");
  console.log("     Close the browser window when done.\n");

  // Wait until the user closes the browser.
  await new Promise((resolve) => {
    context.on("close", resolve);
  });

  // Verify something was saved.
  const hasProfile =
    fs.existsSync(path.join(profileDir, "Default")) ||
    fs.existsSync(path.join(profileDir, "Cookies")) ||
    fs.existsSync(path.join(profileDir, "Local State"));

  if (hasProfile) {
    console.log("  ✅ Profile saved successfully!");
    console.log(`     Location: ${profileDir}`);
    console.log("");
    console.log("  You can now start the app and the bot will use this account.");
    console.log("  Run:  npm run dev");
  } else {
    console.log("  ⚠️  No profile data detected. You may need to run this again.");
  }

  console.log("");
}

main().catch((err) => {
  console.error("Setup failed:", err.message);
  process.exit(1);
});
