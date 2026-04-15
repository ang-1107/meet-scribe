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

    if (!executableExists) {
      return {
        ok: false,
        executablePath: executablePath || null,
        launchable: false,
        message: "Chromium executable could not be found. Run `npx playwright install chromium` during build."
      };
    }

    return {
      ok: true,
      executablePath,
      launchable: null,
      message: "Chromium executable is available."
    };
  } catch (error) {
    return {
      ok: false,
      executablePath: null,
      launchable: false,
      message: error instanceof Error ? error.message : "Unable to resolve Playwright executable path."
    };
  }
}

async function checkPlaywrightLaunchability() {
  try {
    const browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
      timeout: 15000
    });

    await browser.close();

    return {
      ok: true,
      message: "Chromium launched successfully."
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Chromium launch failed.";
    const missingSharedLib = /error while loading shared libraries|libglib-2\.0\.so\.0/i.test(message);

    return {
      ok: false,
      missingSharedLib,
      message
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
  const playwrightBinary = checkPlaywrightBinary();
  const playwrightLaunch = playwrightBinary.ok
    ? await checkPlaywrightLaunchability()
    : {
        ok: false,
        missingSharedLib: false,
        message: "Launch check skipped because executable is missing."
      };
  const profile = checkProfile();

  const playwrightOk = playwrightBinary.ok && playwrightLaunch.ok;
  const readyForAuthenticatedMeetJoin = playwrightOk && profile.ok && profile.likelyAuthenticated;
  const readyForAnonymousMeetJoin = playwrightOk;

  const nextSteps = [];

  if (!playwrightBinary.ok) {
    nextSteps.push("Install Playwright Chromium during build and set PLAYWRIGHT_BROWSERS_PATH=0.");
  }

  if (playwrightBinary.ok && !playwrightLaunch.ok) {
    if (playwrightLaunch.missingSharedLib) {
      nextSteps.push("Install Playwright Linux runtime libraries (for example libglib2.0-0) in the deploy image.");
    } else {
      nextSteps.push("Chromium binary exists but failed to launch. Check Playwright launch logs and container OS dependencies.");
    }
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
      playwright: {
        binary: playwrightBinary,
        launch: playwrightLaunch
      },
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
