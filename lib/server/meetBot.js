import { chromium } from "playwright";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isValidMeetLink(link) {
  try {
    const url = new URL(link);
    return url.hostname === "meet.google.com";
  } catch {
    return false;
  }
}

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

async function tryClick(page, selector, options = {}) {
  const element = page.locator(selector).first();
  const count = await element.count();
  if (!count) {
    return false;
  }

  await element.click(options);
  return true;
}

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

  let browser;

  try {
    await onStatus("joining", "Launching browser session");

    browser = await chromium.launch({
      headless: true,
      args: [
        "--use-fake-ui-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
        "--disable-dev-shm-usage",
        "--no-sandbox"
      ]
    });

    const context = await browser.newContext({
      permissions: ["microphone", "camera"],
      viewport: { width: 1440, height: 960 }
    });

    const page = await context.newPage();
    await page.goto(meetLink, { waitUntil: "domcontentloaded", timeout: 60000 });
    await wait(2500);

    await onStatus("joining", "Disabling local mic/camera and preparing name");
    await tryClick(page, 'button[aria-label*="Turn off microphone"]');
    await tryClick(page, 'button[aria-label*="Turn off camera"]');

    const nameInput = page.locator('input[type="text"]').first();
    if ((await nameInput.count()) > 0) {
      await nameInput.fill(botName);
      await wait(300);
    }

    const joinButton = page.getByRole("button", { name: /Join now|Ask to join/i }).first();
    if ((await joinButton.count()) === 0) {
      await onStatus("in_lobby", "Waiting for join button");
      await page.waitForTimeout(3500);
    }

    if ((await joinButton.count()) === 0) {
      throw new Error("Join button not found. Meeting may require sign-in or access is restricted.");
    }

    await joinButton.click({ timeout: 10000 });

    await onStatus("joined", "Join request submitted");

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

      await wait(1800);
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
    if (browser) {
      await browser.close().catch(() => undefined);
    }
  }
}