import { spawn } from "node:child_process";

function shouldInstallBrowsers() {
  if (process.env.MEETSCRIBE_INSTALL_PLAYWRIGHT === "true") {
    return true;
  }

  if (process.env.CI === "true") {
    return true;
  }

  if (process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_SERVICE_ID || process.env.RAILWAY_ENVIRONMENT_ID) {
    return true;
  }

  return false;
}

async function run() {
  if (!shouldInstallBrowsers()) {
    console.log("[postinstall] Skipping Playwright browser install (non-CI local environment).");
    return;
  }

  const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
  const args = ["playwright", "install", "chromium"];

  // Keep browser binaries under /app so they persist in the final deploy image.
  const env = {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || "0"
  };

  if (process.platform === "linux" && process.env.MEETSCRIBE_PLAYWRIGHT_WITH_DEPS !== "false") {
    args.push("--with-deps");
  }

  console.log(`[postinstall] Installing Playwright browser: ${args.join(" ")}`);

  await new Promise((resolve, reject) => {
    const child = spawn(npxCommand, args, {
      stdio: "inherit",
      env
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Playwright browser install failed with code ${code ?? "unknown"}`));
    });
  });
}

run().catch((error) => {
  console.error(`[postinstall] ${error.message}`);
  process.exit(1);
});
