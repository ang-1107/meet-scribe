import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import path from "path";
import fs from "fs";

// Register stealth plugin — patches navigator.webdriver, User-Agent, WebGL, etc.
chromium.use(StealthPlugin());

/* ------------------------------------------------------------------ */
/*  Utility helpers                                                   */
/* ------------------------------------------------------------------ */

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Random delay between min–max ms to mimic human timing. */
function humanDelay(minMs = 800, maxMs = 2500) {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return wait(ms);
}

function isValidMeetLink(link) {
  try {
    const url = new URL(link);
    return url.hostname === "meet.google.com";
  } catch {
    return false;
  }
}

/**
 * Resolve the Chrome profile directory.
 *
 * Priority:
 *   1. MEETSCRIBE_CHROME_PROFILE_DIR env var (absolute path)
 *   2. Default: <project-root>/data/chrome-profile
 *
 * A persistent profile stores Google login cookies so the bot doesn't
 * need to authenticate on every launch.
 */
function resolveProfileDir() {
  if (process.env.MEETSCRIBE_CHROME_PROFILE_DIR) {
    return path.resolve(process.env.MEETSCRIBE_CHROME_PROFILE_DIR);
  }

  // Default: data/chrome-profile relative to project root.
  // Walk up from this file (lib/server/) to project root.
  const projectRoot = path.resolve(
    path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/i, "$1")),
    "..",
    ".."
  );
  return path.join(projectRoot, "data", "chrome-profile");
}

/* ------------------------------------------------------------------ */
/*  Simulation mode (unchanged from original)                          */
/* ------------------------------------------------------------------ */

async function simulateTranscript({ durationSeconds, onStatus, onTranscript, shouldStop }) {
  const demoLines = [
    "Alex: Kickoff started, agenda is roadmap and launch blockers.",
    "Priya: Decision needed on release date for the beta branch.",
    "Alex: Agreed target is April 30, pending QA pass by Tuesday.",
    "Chen: Action item: finalize migration checklist and share by EOD.",
    "Priya: Open question: do we support legacy webhook payloads?",
    "Alex: Follow-up owner is Chen for compatibility report."
  ];

  await onStatus("joined", "Bot joined in simulation mode");
  await wait(800);
  await onStatus("listening", "Collecting transcript chunks");

  const maxLoops = Math.min(Math.max(Math.floor(durationSeconds / 8), 1), 8);
  const chunks = [];

  for (let i = 0; i < maxLoops; i += 1) {
    if (shouldStop()) {
      break;
    }

    const line = demoLines[i % demoLines.length];
    chunks.push(line);
    await onTranscript(line);
    await wait(1200);
  }

  return chunks.join("\n");
}

/* ------------------------------------------------------------------ */
/*  DOM interaction helpers                                            */
/* ------------------------------------------------------------------ */

async function tryClick(page, selector, options = {}) {
  const element = page.locator(selector).first();
  const count = await element.count();
  if (!count) {
    return false;
  }

  await element.click(options);
  return true;
}

async function isInCall(page) {
  const acceptedSignals = [
    'button[aria-label*="Leave call"]',
    'button[aria-label*="End call"]',
    '[data-call-active="true"]'
  ];

  const checks = await Promise.all(
    acceptedSignals.map((selector) =>
      page
        .locator(selector)
        .first()
        .count()
        .then((count) => count > 0)
        .catch(() => false)
    )
  );

  return checks.some(Boolean);
}

async function dismissInterstitials(page) {
  const buttons = [
    /Accept all|I agree|Accept|Got it/i,
    /Continue without microphone and camera|Continue/i,
    /Dismiss|Close/i
  ];

  for (const pattern of buttons) {
    try {
      const button = page.getByRole("button", { name: pattern }).first();
      if ((await button.count()) > 0) {
        await button.click({ timeout: 2000 });
        await humanDelay(300, 800);
      }
    } catch {
      // Best effort interstitial cleanup.
    }
  }
}

async function getPageHeadline(page) {
  return page
    .evaluate(() => {
      const heading =
        document.querySelector("h1") ||
        document.querySelector("h2") ||
        document.querySelector("[role='heading']");
      return (heading?.textContent || "").trim();
    })
    .catch(() => "");
}

async function tryClickJoinButton(page) {
  const joinRegex = /Ask to join|Join now|Request to join|Join|Knock/i;

  const candidates = [
    page.getByRole("button", { name: joinRegex }).first(),
    page.locator('[role="button"][aria-label*="Join" i], [role="button"][aria-label*="join" i]').first(),
    page.locator('[role="button"]').filter({ hasText: joinRegex }).first(),
    page.locator('button[aria-label*="Join"], button[aria-label*="join"]').first(),
    page.locator('button').filter({ hasText: joinRegex }).first(),
    page.locator(
      'button:has(span:has-text("Ask to join")), button:has(span:has-text("Join now")), button:has(span:has-text("Request to join"))'
    ).first()
  ];

  for (const candidate of candidates) {
    if ((await candidate.count()) === 0) {
      continue;
    }

    try {
      await candidate.waitFor({ state: "visible", timeout: 2000 });
      await humanDelay(400, 1000);
      await candidate.click({ timeout: 5000 });
      return true;
    } catch {
      // Keep trying other candidates.
    }
  }

  return false;
}

async function getVisibleButtonTexts(page) {
  return page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const texts = buttons
      .map((button) => {
        const rect = button.getBoundingClientRect();
        const visible = rect.width > 0 && rect.height > 0;
        if (!visible) {
          return "";
        }

        const aria = (button.getAttribute("aria-label") || "").trim();
        const text = (button.textContent || "").trim().replace(/\s+/g, " ");
        return text || aria;
      })
      .filter(Boolean);

    return texts.slice(0, 12);
  });
}

async function trySetDisplayName(page, botName) {
  const selectors = [
    'input[aria-label="Your name"]',
    'input[placeholder="Your name"]',
    'input[jsname="YPqjbf"]',
    'input[type="text"]'
  ];

  for (const selector of selectors) {
    const input = page.locator(selector).first();
    if ((await input.count()) === 0) {
      continue;
    }

    try {
      await input.waitFor({ state: "visible", timeout: 2500 });
      await humanDelay(300, 700);
      await input.click({ timeout: 2500 });
      await input.fill(botName, { timeout: 5000 });
      return true;
    } catch {
      // Try next selector.
    }
  }

  return page.evaluate((value) => {
    const input =
      document.querySelector('input[aria-label="Your name"]') ||
      document.querySelector('input[placeholder="Your name"]') ||
      document.querySelector('input[jsname="YPqjbf"]') ||
      document.querySelector('input[type="text"]');

    if (!input || input.disabled || input.readOnly) {
      return false;
    }

    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, botName);
}

/* ------------------------------------------------------------------ */
/*  Browser launch with stealth + persistent profile                  */
/* ------------------------------------------------------------------ */

/**
 * Anti-detection Chromium launch arguments.
 *
 * These hide automation markers that Google uses to fingerprint bots:
 *  - AutomationControlled: removes the "Chrome is being controlled by automation" infobar
 *    and the corresponding Blink feature flag that sets navigator.webdriver
 *  - Fake media stream: auto-grants mic/camera so Meet doesn't block on permissions
 *  - Disabled dev-shm: prevents shared-memory issues in containers (deployment compat)
 */
const ANTI_DETECT_ARGS = [
  "--disable-blink-features=AutomationControlled",
  "--use-fake-ui-for-media-stream",
  "--autoplay-policy=no-user-gesture-required",
  "--disable-dev-shm-usage",
  "--disable-features=IsolateOrigins,site-per-process",
  "--disable-infobars",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--no-first-run",
  "--no-default-browser-check"
];

/** A realistic User-Agent string matching Chrome 136 on Windows 10. */
const REALISTIC_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

async function launchStealthBrowser({ headless, profileDir }) {
  // Ensure profile directory exists.
  fs.mkdirSync(profileDir, { recursive: true });

  /**
   * Use launchPersistentContext so that cookies (including Google auth)
   * are preserved across runs. This is the key to staying logged in.
   *
   * NOTE: launchPersistentContext returns a BrowserContext directly
   * (not a Browser). There is no separate browser.newContext() call.
   */
  const context = await chromium.launchPersistentContext(profileDir, {
    headless,
    args: ANTI_DETECT_ARGS,
    ignoreDefaultArgs: ["--enable-automation"],
    viewport: { width: 1440, height: 900 },
    userAgent: REALISTIC_USER_AGENT,
    locale: "en-US",
    timezoneId: "America/New_York",
    permissions: ["microphone", "camera"],
    bypassCSP: true
  });

  return context;
}

/* ------------------------------------------------------------------ */
/*  Main export: join Meet and capture transcript                     */
/* ------------------------------------------------------------------ */

export async function joinMeetAndCaptureTranscript({
  meetLink,
  botName,
  durationSeconds,
  onStatus,
  onTranscript,
  shouldStop
}) {
  if (!isValidMeetLink(meetLink)) {
    throw new Error("Invalid Google Meet link.");
  }

  const forceSimulation = process.env.MEETSCRIBE_FORCE_SIMULATION === "true";
  const allowSimulationFallback = process.env.MEETSCRIBE_ALLOW_SIMULATION_FALLBACK === "true";
  if (forceSimulation) {
    return simulateTranscript({ durationSeconds, onStatus, onTranscript, shouldStop });
  }

  let context;

  try {
    await onStatus("joining", "Launching stealth browser session");

    const configuredHeadless = process.env.MEETSCRIBE_HEADLESS;
    const headless = configuredHeadless ? configuredHeadless === "true" : false;
    const profileDir = resolveProfileDir();

    // Check if profile has been set up (has a Google login).
    const profileExists = fs.existsSync(path.join(profileDir, "Default"))
      || fs.existsSync(path.join(profileDir, "Cookies"))
      || fs.existsSync(path.join(profileDir, "Local State"));

    if (!profileExists) {
      await onStatus(
        "joining",
        "No Google login profile found. Run 'node scripts/setupProfile.mjs' first to log in. Attempting anonymous join..."
      );
    }

    context = await launchStealthBrowser({ headless, profileDir });

    // Get the default page or create one.
    const pages = context.pages();
    const page = pages.length > 0 ? pages[0] : await context.newPage();

    // Additional stealth: override navigator.webdriver at page level as extra insurance.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", {
        get: () => undefined
      });

      // Hide automation-related Chrome properties.
      if (window.chrome) {
        window.chrome.runtime = window.chrome.runtime || {};
      } else {
        window.chrome = { runtime: {} };
      }
    });

    await onStatus("joining", "Navigating to Meet link");
    await page.goto(meetLink, { waitUntil: "domcontentloaded", timeout: 60000 });

    // Human-like pause after page load.
    await humanDelay(2000, 4000);
    await dismissInterstitials(page);
    await humanDelay(1000, 2000);

    await onStatus("joining", "Disabling local mic/camera and preparing name");
    await tryClick(page, 'button[aria-label*="Turn off microphone"]');
    await humanDelay(300, 600);
    await tryClick(page, 'button[aria-label*="Turn off camera"]');
    await humanDelay(300, 600);

    const didSetName = await trySetDisplayName(page, botName);
    if (!didSetName) {
      await onStatus("joining", "Could not set display name field; continuing with Meet default.");
    } else {
      await humanDelay(500, 1000);
    }

    let clickedJoin = false;
    let alreadyInCall = await isInCall(page);
    const joinDeadline = Date.now() + 45000;

    while (!clickedJoin && !alreadyInCall && Date.now() < joinDeadline) {
      await dismissInterstitials(page);
      clickedJoin = await tryClickJoinButton(page);
      if (clickedJoin) {
        break;
      }

      const blockedBySignIn = (await page.getByText(/sign in to continue|use your google account/i).count().catch(() => 0)) >
        0;
      if (blockedBySignIn) {
        throw new Error(
          "Join action unavailable because this meeting view requires Google sign-in. " +
          "Run 'node scripts/setupProfile.mjs' to sign in with a Google account first."
        );
      }

      const knownErrorSurface =
        (await page
          .getByText(
            /you can't join this video call|check your meeting code|meeting has ended|no longer available|this call is full|couldn't find a meeting/i
          )
          .count()
          .catch(() => 0)) > 0;
      if (knownErrorSurface) {
        const title = await page.title().catch(() => "unknown");
        const headline = await getPageHeadline(page);
        throw new Error(`Meet is showing an error/interstitial page. title='${title}' headline='${headline || "n/a"}'`);
      }

      await onStatus("in_lobby", "Waiting for host admission or join control");
      await humanDelay(2000, 4000);
      alreadyInCall = await isInCall(page);
    }

    if (!clickedJoin && !alreadyInCall) {
      const buttons = await getVisibleButtonTexts(page).catch(() => []);
      const title = await page.title().catch(() => "unknown");
      const url = page.url();
      const headline = await getPageHeadline(page);
      const buttonDetails = buttons.length > 0 ? ` Visible buttons: ${buttons.join(" | ")}` : "";
      throw new Error(
        `Join button not found. title='${title}' headline='${headline || "n/a"}' url='${url}'. Meeting may require sign-in, account restrictions, invalid/ended room, or a different locale UI.${buttonDetails}`
      );
    }

    await onStatus("joined", alreadyInCall ? "Bot appears to already be in call" : "Join request submitted");

    const acceptedSignals = [
      'button[aria-label*="Leave call"]',
      'button[aria-label*="End call"]',
      '[data-call-active="true"]'
    ];

    const joinedResults = await Promise.all(
      acceptedSignals.map((selector) =>
        page
          .waitForSelector(selector, { timeout: 20000 })
          .then(() => true)
          .catch(() => false)
      )
    );
    const joined = joinedResults.some(Boolean);

    if (!joined) {
      await onStatus("in_lobby", "Still in lobby or waiting for approval");
      throw new Error("Bot was not admitted to the meeting within timeout.");
    }

    await onStatus("listening", "Capturing live captions (if available)");

    // Try to enable captions — press 'c' which is the Meet shortcut.
    await page.keyboard.press("c").catch(() => undefined);

    const seen = new Set();
    const lines = [];
    const deadline = Date.now() + durationSeconds * 1000;

    while (Date.now() < deadline && !shouldStop()) {
      const batch = await page.evaluate(() => {
        const selectors = [
          '[jsname="YSxPC"]',
          '[class*="bh44bd"]',
          '[class*="iTTPOb"] span',
          '[data-is-caption="true"]'
        ];

        const values = [];
        for (const selector of selectors) {
          document.querySelectorAll(selector).forEach((node) => {
            const text = (node.textContent || "").trim();
            if (text.length > 2) {
              values.push(text);
            }
          });
        }
        return values;
      });

      const additions = [];
      for (const line of batch) {
        if (!seen.has(line)) {
          seen.add(line);
          additions.push(line);
          lines.push(line);
        }
      }

      if (additions.length > 0) {
        await onTranscript(additions.join("\n"));
      }

      const wasRemoved = await page
        .getByText(/removed from the meeting|meeting has ended/i)
        .count()
        .catch(() => 0);

      if (wasRemoved > 0) {
        break;
      }

      await humanDelay(1500, 2500);
    }

    if (lines.length === 0) {
      throw new Error(
        "Joined the meeting but no captions were detected. Turn on captions in Meet or use simulation mode."
      );
    }

    return lines.join("\n");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown bot error";

    if (allowSimulationFallback) {
      await onStatus("listening", `Real capture failed; switching to simulation fallback: ${message}`);
      return simulateTranscript({ durationSeconds, onStatus, onTranscript, shouldStop });
    }

    throw new Error(`Real Meet join/capture failed: ${message}`);
  } finally {
    if (context) {
      await context.close().catch(() => undefined);
    }
  }
}