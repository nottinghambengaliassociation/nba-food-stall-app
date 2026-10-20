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
    //
    // Hotfix H4 (v1.3.2) adds `cash-h4.spec.js` to `iphone13` only: CLAUDE.md
    // H4 1 asks for the Card default "on every layout", and iphone13 is the
    // small phone named in the H4 brief. `phone` and `tablet` run it as well,
    // so all three layouts are covered without a fourth full pass.
    ...[
      // iphone13 also carries the gated read-only H4 live check: CLAUDE.md H4 1
      // names the phone Review & send sheet, and 390x664 is the small phone the
      // H3 and H4 briefs are written against.
      // Phase V (v1.4.0) adds `cash-p5.spec.js` to `iphone13`: Phase V 1 moves
      // two controls into the one-row 52 px H3 header (the "Orders" button with
      // its badge, and "Next A-045" into the ☰ menu) and adds an eighth tile,
      // which are geometry claims only the small phone can falsify.
      { name: "iphone13", width: 390, height: 664, match: /(cash-h3|cash-h4|cash-p5|live-h3|live-h4)\.spec\.js/ },
      { name: "iphone17", width: 402, height: 694, match: /(cash-h3|live-h3)\.spec\.js/ },
      { name: "promax", width: 430, height: 752, match: /(cash-h3|live-h3)\.spec\.js/ },
    ].map(({ name, width, height, match }) => ({
      name,
      // The H3 emulator suite, and the gated read-only H3 live check.
      testMatch: match,
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
