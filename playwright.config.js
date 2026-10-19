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
    // Hotfix H3 (v1.3.1): the cash counter is rebuilt for small phones.
    // These three viewports run the H3 spec ONLY (`testMatch` below): the
    // suite is already ~286 e2e cases and running all of it three more times
    // would make the fix loop unusable. `cash-h3.spec.js` carries every
    // assertion that depends on the small-screen geometry; everything else
    // keeps running on `phone` (390x844, also below the 700 px breakpoint, so
    // it exercises the same H3 layout) and `tablet`.
    //
    // 390x664 and 402x694 are the visible areas named in CLAUDE.md -> Hotfix
    // H3. 430x752 is the iPhone Pro Max device width (430x932) less the same
    // 180 px of Safari chrome that turns 844 into 664 and 874 into 694.
    ...[
      { name: "iphone13", width: 390, height: 664 },
      { name: "iphone17", width: 402, height: 694 },
      { name: "promax", width: 430, height: 752 },
    ].map(({ name, width, height }) => ({
      name,
      testMatch: /cash-h3\.spec\.js/,
      use: {
        ...devices["Desktop Chrome"],
        browserName: "chromium",
        viewport: { width, height },
        hasTouch: true,
        isMobile: true,
        deviceScaleFactor: 2,
      },
    })),
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
