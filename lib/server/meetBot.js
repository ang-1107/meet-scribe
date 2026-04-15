import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import path from "path";
import fs from "fs";
import { getConfig } from "@/lib/server/config";
import { injectAudioHooks, activateCapture } from "@/lib/server/audioCapture";
import { transcribeAudioChunk } from "@/lib/server/transcriber";

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
 * Resolve the Chrome profile directory from config.
 * Relative paths are resolved from the project root.
 */
function resolveProfileDir() {
  const config = getConfig();
  const raw = config.bot.chromeProfileDir;

  if (path.isAbsolute(raw)) {
    return raw;
  }

  return path.resolve(process.cwd(), raw);
}

/* ------------------------------------------------------------------ */
/*  Simulation mode                                                   */
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
    page.locator("button").filter({ hasText: joinRegex }).first(),
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
/*  Mic/camera disable — multi-strategy                               */
/* ------------------------------------------------------------------ */

/**
 * Try hard to turn off the microphone and camera on the Meet pre-join
 * screen. Google Meet uses different button labels/selectors depending
 * on locale, account type, and UI version, so we try many patterns.
 */
async function disableMicAndCamera(page) {
  // Strategy 1: aria-label patterns (most common).
  const micSelectors = [
    'button[aria-label*="Turn off microphone"]',
    'button[aria-label*="turn off microphone"]',
    'button[aria-label*="Mute microphone"]',
    'button[aria-label*="microphone" i][data-is-muted="false"]',
    '[role="button"][aria-label*="microphone" i]',
    'button[data-tooltip*="microphone" i]'
  ];

  const camSelectors = [
    'button[aria-label*="Turn off camera"]',
    'button[aria-label*="turn off camera"]',
    'button[aria-label*="Turn off video"]',
    'button[aria-label*="camera" i][data-is-muted="false"]',
    '[role="button"][aria-label*="camera" i]',
    'button[data-tooltip*="camera" i]'
  ];

  for (const sel of micSelectors) {
    if (await tryClick(page, sel)) {
      break;
    }
  }

  await humanDelay(200, 500);

  for (const sel of camSelectors) {
    if (await tryClick(page, sel)) {
      break;
    }
  }

  // Strategy 2: JavaScript fallback — find and click any button whose
  // aria-label contains "microphone" or "camera" and appears to be "on".
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button, [role='button']"));
    for (const btn of buttons) {
      const label = (btn.getAttribute("aria-label") || "").toLowerCase();
      const muted = btn.getAttribute("data-is-muted");

      if (label.includes("microphone") && muted !== "true") {
        if (label.includes("turn off") || !label.includes("turn on")) {
          btn.click();
        }
      }
      if (label.includes("camera") && muted !== "true") {
        if (label.includes("turn off") || !label.includes("turn on")) {
          btn.click();
        }
      }
    }
  }).catch(() => {});
}

/* ------------------------------------------------------------------ */
/*  Browser launch with stealth + persistent profile                  */
/* ------------------------------------------------------------------ */

const ANTI_DETECT_ARGS = [
  "--disable-blink-features=AutomationControlled",
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
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

const REALISTIC_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

async function launchStealthBrowser({ headless, profileDir }) {
  fs.mkdirSync(profileDir, { recursive: true });

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

  const config = getConfig();

  if (config.simulation.force) {
    return simulateTranscript({ durationSeconds, onStatus, onTranscript, shouldStop });
  }

  let context;

  try {
    await onStatus("joining", "Launching stealth browser session");

    const headless = config.bot.headless;
    const profileDir = resolveProfileDir();

    const profileExists =
      fs.existsSync(path.join(profileDir, "Default")) ||
      fs.existsSync(path.join(profileDir, "Cookies")) ||
      fs.existsSync(path.join(profileDir, "Local State"));

    if (!profileExists) {
      await onStatus(
        "joining",
        "No Google login profile found. Run 'npm run setup:profile' first. Attempting anonymous join..."
      );
    }

    context = await launchStealthBrowser({ headless, profileDir });

    const pages = context.pages();
    const page = pages.length > 0 ? pages[0] : await context.newPage();

    // Additional stealth: override navigator.webdriver at page level.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      if (window.chrome) {
        window.chrome.runtime = window.chrome.runtime || {};
      } else {
        window.chrome = { runtime: {} };
      }
    });

    // CRITICAL: Inject audio capture hooks BEFORE navigating to Meet.
    // This patches RTCPeerConnection so we catch all incoming audio tracks
    // as Meet's JavaScript establishes WebRTC connections.
    const chunkInterval = config.transcription.chunkIntervalSeconds;
    const whisperModel = config.transcription.whisperModel;
    const lines = [];
    let chunkIndex = 0;

    await injectAudioHooks(page, async (samples) => {
      chunkIndex++;
      const label = `chunk #${chunkIndex}`;
      console.log(`[meetBot] Received audio ${label} (${samples.length} samples, ${(samples.length / 16000).toFixed(1)}s)`);

      try {
        const text = await transcribeAudioChunk(samples, { model: whisperModel });
        if (text && text.length > 1) {
          console.log(`[meetBot] Transcribed ${label}: "${text.slice(0, 80)}..."`);
          lines.push(text);
          await onTranscript(text);
        } else {
          console.log(`[meetBot] ${label}: silence or empty transcription.`);
        }
      } catch (err) {
        console.error(`[meetBot] Transcription error for ${label}:`, err.message);
      }
    });

    await onStatus("joining", "Navigating to Meet link");
    await page.goto(meetLink, { waitUntil: "domcontentloaded", timeout: 60000 });

    await humanDelay(2000, 4000);
    await dismissInterstitials(page);
    await humanDelay(1000, 2000);

    await onStatus("joining", "Disabling local mic/camera and preparing name");
    await disableMicAndCamera(page);
    await humanDelay(400, 800);

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

      const blockedBySignIn =
        (await page
          .getByText(/sign in to continue|use your google account/i)
          .count()
          .catch(() => 0)) > 0;
      if (blockedBySignIn) {
        throw new Error(
          "Join action unavailable because this meeting view requires Google sign-in. " +
            "Run 'npm run setup:profile' to sign in with a Google account first."
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
        throw new Error(
          `Meet is showing an error/interstitial page. title='${title}' headline='${headline || "n/a"}'`
        );
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
        `Join button not found. title='${title}' headline='${headline || "n/a"}' url='${url}'.${buttonDetails}`
      );
    }

    await onStatus("joined", alreadyInCall ? "Bot appears to already be in call" : "Join request submitted");

    // Wait for call admission.
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

    // ---- Activate audio capture (hooks were injected before navigation) ----

    await onStatus("listening", "Starting audio capture and transcription");

    const captureHandle = await activateCapture(page, {
      chunkIntervalSeconds: chunkInterval
    });

    // Also try enabling Meet captions as a secondary source.
    await page.keyboard.press("c").catch(() => undefined);

    // Caption scraping as fallback/supplement (best-effort).
    const seen = new Set();
    const deadline = Date.now() + durationSeconds * 1000;

    while (Date.now() < deadline && !shouldStop()) {
      // Scrape any visible captions too.
      const batch = await page
        .evaluate(() => {
          const selectors = [
            '[jsname="YSxPC"]',
            '[class*="bh44bd"]',
            '[class*="iTTPOb"] span',
            '[data-is-caption="true"]'
          ];
          const values = [];
          for (const sel of selectors) {
            document.querySelectorAll(sel).forEach((node) => {
              const text = (node.textContent || "").trim();
              if (text.length > 2) {
                values.push(text);
              }
            });
          }
          return values;
        })
        .catch(() => []);

      for (const line of batch) {
        if (!seen.has(line)) {
          seen.add(line);
          lines.push(line);
          await onTranscript(line);
        }
      }

      // Check if removed from the meeting.
      const wasRemoved = await page
        .getByText(/removed from the meeting|meeting has ended/i)
        .count()
        .catch(() => 0);

      if (wasRemoved > 0) {
        break;
      }

      await humanDelay(1500, 2500);
    }

    // Stop audio capture.
    await captureHandle.stop();

    if (lines.length === 0) {
      throw new Error(
        "Joined the meeting but no transcript was captured. Ensure other participants are speaking and audio is working."
      );
    }

    return lines.join("\n");
  } catch (error) {
    let message = error instanceof Error ? error.message : "Unknown bot error";

    if (/Executable doesn't exist|playwright install/i.test(message)) {
      message =
        "Playwright Chromium browser is not installed in this deployment image. " +
        "Redeploy after ensuring browser install runs at build time (postinstall) and PLAYWRIGHT_BROWSERS_PATH=0 is set.";
    }

    if (config.simulation.allowFallback) {
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