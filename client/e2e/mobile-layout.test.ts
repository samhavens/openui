/**
 * Layout regression tests for mobile views.
 *
 * These tests assert that interactive elements (inputs, macro buttons) are
 * WITHIN the visible viewport — i.e. not clipped by overflow:hidden or pushed
 * below the fold by a broken flex layout.
 *
 * The two bugs these guard against:
 *
 * Bug A — Terminal input offscreen:
 *   MobileLiteTerminal used `h-full` inside a flex container where the parent
 *   had no `flex-1`, so `h-full` resolved to the full 100vh.  The outer
 *   `overflow-hidden` clipped everything below the fold.  The input row sat
 *   at ~(100vh + header_height), invisible.
 *
 * Bug B — BottomSheet content clipped:
 *   The scrollable content div used an inline `maxHeight: calc(Npx - env(safe-area-inset-bottom))`.
 *   `env()` in JS-computed inline styles is unreliable in some Mobile Safari versions.
 *   Content could overflow/clip, hiding the input and macro buttons.
 *
 * Why Playwright, not jsdom?
 *   jsdom does not compute CSS layout — getBoundingClientRect() always returns zeros.
 *   These bugs are *geometry* bugs.  Only a real browser engine (Chromium here)
 *   can detect them.
 */

import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wait for the store to be exposed on window (set in main.tsx for DEV mode). */
async function waitForStore(page: Page) {
  await page.waitForFunction(() => !!(window as any).__openui_store, {
    timeout: 10_000,
  });
}

/**
 * Inject a mock session into the Zustand store and navigate to a given view.
 * Uses the `__openui_store` handle exposed in dev mode — no real server calls.
 */
async function gotoMobileView(
  page: Page,
  view: "dashboard" | "detail" | "terminal"
) {
  await page.goto("/");
  // Wait for React to mount and the store to be exposed
  await page.waitForLoadState("networkidle");
  await waitForStore(page);

  await page.evaluate((v) => {
    const store = (window as any).__openui_store;
    const state = store.getState();

    const mockSession = {
      id: "e2e-test-node",
      sessionId: "e2e-test-session",
      agentId: "claude",
      agentName: "Test Agent",
      command: "claude",
      color: "#6366f1",
      createdAt: new Date().toISOString(),
      cwd: "/tmp",
      status: "idle" as const,
    };

    state.addSession("e2e-test-node", mockSession);
    state.setMobileSessionId("e2e-test-node");
    state.setMobileView(v);
  }, view);

  // Let React re-render and any animations settle
  await page.waitForTimeout(800);
}

/**
 * Assert that an element's bottom edge is within the viewport.
 * This is the primary invariant: interactive elements must not be offscreen.
 */
async function assertWithinViewport(page: Page, locator: ReturnType<Page["locator"]>, label: string) {
  const box = await locator.boundingBox();
  expect(box, `${label}: element not found`).not.toBeNull();

  const { height: viewportHeight } = page.viewportSize()!;
  const elementBottom = box!.y + box!.height;

  expect(
    elementBottom,
    `${label}: bottom edge (${elementBottom.toFixed(0)}px) is below viewport (${viewportHeight}px) — element is offscreen`
  ).toBeLessThanOrEqual(viewportHeight);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("mobile layout — elements must be within viewport", () => {
  // ---------------------------------------------------------------------------
  // Bug A: Terminal input pushed offscreen by broken flex layout
  // ---------------------------------------------------------------------------
  test("terminal: input row is within viewport (Bug A regression)", async ({ page }) => {
    await gotoMobileView(page, "terminal");

    // The toolbar must be visible at the top
    const toolbar = page.locator("text=Test Agent").first();
    await expect(toolbar).toBeVisible();

    // The input field must be visible — this is what was clipped before the fix
    const input = page.locator('input[placeholder*="Input"]');
    await expect(input).toBeVisible();
    await assertWithinViewport(page, input, "terminal input");
  });

  test("terminal: send button is within viewport", async ({ page }) => {
    await gotoMobileView(page, "terminal");

    // The send button sits right of the input; if input is clipped, button is too
    const sendBtn = page.locator("button").filter({ has: page.locator("svg") }).last();
    await assertWithinViewport(page, sendBtn, "terminal send button");
  });

  test("terminal: output area does not push input below the fold", async ({ page }) => {
    await gotoMobileView(page, "terminal");

    const input = page.locator('input[placeholder*="Input"]');
    const box = await input.boundingBox();
    expect(box).not.toBeNull();

    // Input must start in the lower half of the screen (not near the top — that
    // would mean the output area collapsed), but not past the bottom
    const { height: vh } = page.viewportSize()!;
    expect(box!.y).toBeGreaterThan(vh * 0.3); // not squished to top
    expect(box!.y + box!.height).toBeLessThanOrEqual(vh); // not past bottom
  });

  // ---------------------------------------------------------------------------
  // Bug B: BottomSheet content clipped / input unreachable
  // ---------------------------------------------------------------------------
  test("detail sheet: input is within viewport after scrolling to bottom (Bug B regression)", async ({ page }) => {
    await gotoMobileView(page, "detail");

    // The BottomSheet animates open — wait for it
    await page.waitForTimeout(600);

    // Scroll the sheet's overflow container to the very bottom
    const sheetScroll = page.locator(".overflow-y-auto").first();
    await sheetScroll.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(300);

    // The send-message input must now be visible
    const input = page.locator('textarea[placeholder*="Send a message"], input[placeholder*="Send a message"]');
    await expect(input).toBeVisible();
    await assertWithinViewport(page, input, "detail sheet input");
  });

  test("detail sheet: macro buttons are within viewport at initial open", async ({ page }) => {
    await gotoMobileView(page, "detail");
    await page.waitForTimeout(600);

    // y / n macro buttons should be reachable without scrolling past the viewport
    const yBtn = page.locator("button", { hasText: "y" }).first();
    await expect(yBtn).toBeVisible();
    await assertWithinViewport(page, yBtn, "macro 'y' button");
  });

  test("detail sheet: archive/kill buttons visible without scrolling (snap height regression)", async ({ page }) => {
    // Root cause of Bug D: default snap point was 60% height. Content (~560px)
    // didn't fit — Notes barely visible, Archive/Kill below the fold. Fixed by
    // opening at 95% snap by default.
    await gotoMobileView(page, "detail");
    await page.waitForTimeout(600);

    // No scrolling — buttons must be immediately visible at initial open
    const archiveBtn = page.locator("button", { hasText: "Archive" });
    await expect(archiveBtn).toBeVisible();
    await assertWithinViewport(page, archiveBtn, "Archive button (no scroll)");

    const killBtn = page.locator("button", { hasText: "Kill" });
    await expect(killBtn).toBeVisible();
    await assertWithinViewport(page, killBtn, "Kill button (no scroll)");
  });

  test("detail sheet: archive/kill buttons reachable by scrolling (drag-intercepts-scroll regression)", async ({ page }) => {
    // Root cause of Bug C: framer-motion `drag="y"` on the entire sheet div
    // intercepts touch scroll events as sheet-dismiss drags. Downward scroll
    // inside the sheet dismisses the sheet instead of scrolling content.
    // Fix: restrict drag to the handle only via dragControls + dragListener=false.
    await gotoMobileView(page, "detail");
    await page.waitForTimeout(600);

    // Programmatically scroll the sheet content to the bottom
    const sheetScroll = page.locator(".overflow-y-auto").first();
    await sheetScroll.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await page.waitForTimeout(300);

    // Archive button must be reachable and within viewport
    const archiveBtn = page.locator("button", { hasText: "Archive" });
    await expect(archiveBtn).toBeVisible();
    await assertWithinViewport(page, archiveBtn, "Archive button");

    // Kill button too
    const killBtn = page.locator("button", { hasText: "Kill" });
    await expect(killBtn).toBeVisible();
    await assertWithinViewport(page, killBtn, "Kill button");
  });

  // ---------------------------------------------------------------------------
  // Regression: desktop view must not show mobile UI
  // ---------------------------------------------------------------------------
  test("desktop: ReactFlow canvas renders, no mobile UI", async ({ browser }) => {
    // Use a desktop-sized context — overrides the iPhone device
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    // ReactFlow pane should exist
    await expect(page.locator(".react-flow")).toBeVisible();

    // Mobile dashboard must NOT be present
    const mobileDash = page.locator('[data-testid="mobile-dashboard"]');
    await expect(mobileDash).not.toBeVisible();

    await ctx.close();
  });
});
