import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:6969",
    trace: "on-first-retry",
    // Chromium in a 390×844 mobile viewport (iPhone 14 dimensions).
    // Using Chromium (not WebKit) so we only need one browser installed.
    // The layout invariants we're testing are geometry bugs that reproduce in
    // any real browser engine — Chromium is sufficient to catch them.
    browserName: "chromium",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  },
  projects: [
    {
      name: "mobile-chromium",
    },
  ],
  webServer: {
    command: "bun run dev",
    port: 6969,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
