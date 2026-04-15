import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { getConfig } from "@/lib/server/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function resolveProfileDir() {
  const config = getConfig();
  const raw = config.bot.chromeProfileDir;

  if (path.isAbsolute(raw)) {
    return raw;
  }

  return path.resolve(process.cwd(), raw);
}

function exists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function checkPlaywrightBinary() {
  try {
    const executablePath = chromium.executablePath();
    const executableExists = Boolean(executablePath) && exists(executablePath);

    return {
      ok: executableExists,
      executablePath: executablePath || null,
      message: executableExists
        ? "Chromium executable is available."
        : "Chromium executable could not be found. Run `npx playwright install chromium` during build."
    };
  } catch (error) {
    return {
      ok: false,
      executablePath: null,
      message: error instanceof Error ? error.message : "Unable to resolve Playwright executable path."
    };
  }
}

function checkProfile() {
  const profileDir = resolveProfileDir();
  const hasProfileDir = exists(profileDir);
  const hasLocalState = exists(path.join(profileDir, "Local State"));
  const hasCookiesRoot = exists(path.join(profileDir, "Cookies"));
  const hasDefaultDir = exists(path.join(profileDir, "Default"));
  const hasCookiesInDefault = exists(path.join(profileDir, "Default", "Cookies"));

  const hasAnyProfileData = hasDefaultDir || hasCookiesRoot || hasLocalState;
  const likelyAuthenticated = (hasCookiesRoot || hasCookiesInDefault) && hasAnyProfileData;

  let message = "Profile directory is present.";
  if (!hasAnyProfileData) {
    message = "No browser profile data found. Run setup profile before joining sign-in-required meetings.";
  } else if (!likelyAuthenticated) {
    message = "Profile exists, but login cookies were not detected. Re-run setup profile if join fails.";
  }

  return {
    ok: hasAnyProfileData,
    likelyAuthenticated,
    profileDir,
    signals: {
      hasProfileDir,
      hasDefaultDir,
      hasLocalState,
      hasCookiesRoot,
      hasCookiesInDefault
    },
    message
  };
}

export async function GET() {
  const config = getConfig();
  const playwright = checkPlaywrightBinary();
  const profile = checkProfile();

  const readyForAuthenticatedMeetJoin = playwright.ok && profile.ok && profile.likelyAuthenticated;
  const readyForAnonymousMeetJoin = playwright.ok;

  const nextSteps = [];

  if (!playwright.ok) {
    nextSteps.push("Install Playwright Chromium during build and set PLAYWRIGHT_BROWSERS_PATH=0.");
  }

  if (!profile.ok || !profile.likelyAuthenticated) {
    nextSteps.push("Run npm run setup:profile on a machine with a real browser and persist that profile directory.");
  }

  if (nextSteps.length === 0) {
    nextSteps.push("Preflight checks passed.");
  }

  return Response.json({
    ok: readyForAnonymousMeetJoin,
    environment: {
      railway: Boolean(process.env.RAILWAY_PROJECT_ID),
      nodeEnv: process.env.NODE_ENV || "development"
    },
    readiness: {
      readyForAnonymousMeetJoin,
      readyForAuthenticatedMeetJoin
    },
    checks: {
      playwright,
      profile,
      botConfig: {
        headless: config.bot.headless,
        chromeProfileDir: profile.profileDir,
        simulationFallback: config.simulation.allowFallback
      }
    },
    nextSteps
  });
}
