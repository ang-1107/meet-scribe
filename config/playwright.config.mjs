import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "../tests/e2e",
  timeout: 60000,
  expect: {
    timeout: 30000
  },
  use: {
    baseURL: "http://127.0.0.1:3001",
    trace: "on-first-retry"
  },
  webServer: {
    command: "npm run dev -- --port 3001",
    url: "http://127.0.0.1:3001",
    reuseExistingServer: true,
    env: {
      MEETSCRIBE_FORCE_SIMULATION: "true",
      MEETSCRIBE_DATA_DIR: ".e2e-data"
    }
  }
});
