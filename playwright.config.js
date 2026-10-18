import { defineConfig, devices } from "@playwright/test";

const BASE_URL = "http://127.0.0.1:5173/";

export default defineConfig({
  testDir: "./tests/e2e",
  // Firestore live updates and emulator round trips need a little room.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // One retry locally too: the Firestore emulator is shared with the
  // developer's own `npm run test:e2e` runs and can restart mid-suite.
  retries: 1,
  reporter: [["html", { outputFolder: "playwright-report", open: "never" }], ["list"]],
  outputDir: "test-results",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
  },
  projects: [
    {
      name: "phone",
      use: {
        ...devices["Desktop Chrome"],
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
        deviceScaleFactor: 2,
      },
    },
    {
      name: "tablet",
      use: {
        ...devices["Desktop Chrome"],
        browserName: "chromium",
        viewport: { width: 1280, height: 800 },
        hasTouch: true,
        isMobile: false,
        deviceScaleFactor: 2,
      },
    },
  ],
  webServer: {
    command: "npm run serve",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
