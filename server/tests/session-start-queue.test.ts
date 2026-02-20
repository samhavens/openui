/**
 * Tests for sessionStartQueue.ts — queue API surface and basic behavior.
 *
 * The queue module has persistent module-level state (processing flag, queue array,
 * currentPending). These tests focus on the observable API contract rather than
 * timing-dependent queue processing, which is integration-tested via the
 * mobile-api tests that exercise the full status-update → signalSessionReady flow.
 */

import { describe, it, expect } from "bun:test";

// Set env vars BEFORE importing the module
process.env.OPENUI_QUIET = "1";
process.env.OPENUI_STARTUP_TIMEOUT_MS = "500";
process.env.OPENUI_POST_SIGNAL_DELAY_MS = "50";

import {
  enqueueSessionStart,
  signalSessionReady,
  getQueueProgress,
  resetQueueProgress,
  setAuthBroadcast,
} from "../services/sessionStartQueue";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- getQueueProgress ---

describe("getQueueProgress", () => {
  it("returns an object with total, completed, current, isActive", () => {
    const progress = getQueueProgress();
    expect(progress).toHaveProperty("total");
    expect(progress).toHaveProperty("completed");
    expect(progress).toHaveProperty("current");
    expect(progress).toHaveProperty("isActive");
    expect(typeof progress.total).toBe("number");
    expect(typeof progress.completed).toBe("number");
    expect(typeof progress.isActive).toBe("boolean");
  });
});

// --- resetQueueProgress ---

describe("resetQueueProgress", () => {
  it("resets counters to zero", () => {
    resetQueueProgress();
    const progress = getQueueProgress();
    expect(progress.total).toBe(0);
    expect(progress.completed).toBe(0);
    expect(progress.current).toBeNull();
  });
});

// --- signalSessionReady ---

describe("signalSessionReady", () => {
  it("does not throw for unknown sessionId", () => {
    expect(() => signalSessionReady("nonexistent-session-xyz")).not.toThrow();
  });

  it("does not throw when called multiple times with same id", () => {
    expect(() => {
      signalSessionReady("double-signal-1");
      signalSessionReady("double-signal-1");
    }).not.toThrow();
  });
});

// --- setAuthBroadcast ---

describe("setAuthBroadcast", () => {
  it("accepts callback functions without throwing", () => {
    expect(() => {
      setAuthBroadcast(
        (url: string) => {},
        () => {}
      );
    }).not.toThrow();
  });
});

// --- enqueueSessionStart basic behavior ---

describe("enqueueSessionStart", () => {
  it("calls startFn", async () => {
    let called = false;
    const prefix = `basic-${Date.now()}`;

    enqueueSessionStart(`${prefix}-1`, () => {
      called = true;
    });

    // startFn is called synchronously in the promise executor
    // but processQueue might be waiting for a previous entry
    // Give it time to drain any previous state
    await sleep(600);
    expect(called).toBe(true);

    // Clean up: signal ready so queue drains
    signalSessionReady(`${prefix}-1`);
    await sleep(100);
  });

  it("increments totalEnqueued", async () => {
    resetQueueProgress();
    const prefix = `count-${Date.now()}`;

    enqueueSessionStart(`${prefix}-1`, () => {});
    const progress = getQueueProgress();
    expect(progress.total).toBeGreaterThanOrEqual(1);

    // Clean up
    signalSessionReady(`${prefix}-1`);
    await sleep(100);
  });

  it("does not throw when startFn throws", async () => {
    const prefix = `err-${Date.now()}`;

    expect(() => {
      enqueueSessionStart(`${prefix}-1`, () => {
        throw new Error("intentional");
      });
    }).not.toThrow();

    // Wait for processing to complete
    await sleep(200);
  });
});

// --- signalSessionReady resolves pending session ---

describe("signalSessionReady — real path", () => {
  it("resolves the pending session and advances queue", async () => {
    const prefix = `signal-real-${Date.now()}`;
    let fn1Called = false;
    let fn2Called = false;

    // Enqueue two sessions — first should start immediately
    enqueueSessionStart(`${prefix}-1`, () => { fn1Called = true; });
    enqueueSessionStart(`${prefix}-2`, () => { fn2Called = true; });

    // fn1 should have been called synchronously
    expect(fn1Called).toBe(true);

    // Signal the first session ready (before timeout)
    signalSessionReady(`${prefix}-1`);

    // Wait for post-signal delay (50ms) + processing time
    await sleep(200);

    // The second session should now have been started
    expect(fn2Called).toBe(true);

    // Clean up
    signalSessionReady(`${prefix}-2`);
    await sleep(100);
  });

  it("completes the queue and increments completed count", async () => {
    resetQueueProgress();
    const prefix = `complete-${Date.now()}`;

    enqueueSessionStart(`${prefix}-1`, () => {});
    signalSessionReady(`${prefix}-1`);

    // Wait for post-signal delay + queue draining
    await sleep(200);

    const progress = getQueueProgress();
    expect(progress.completed).toBeGreaterThanOrEqual(1);
  });

  it("sets isActive false after queue drains", async () => {
    const prefix = `drain-${Date.now()}`;

    enqueueSessionStart(`${prefix}-1`, () => {});
    signalSessionReady(`${prefix}-1`);

    await sleep(200);

    const progress = getQueueProgress();
    expect(progress.isActive).toBe(false);
    expect(progress.current).toBeNull();
  });

  it("calls onAuthComplete when session was waiting for auth", async () => {
    const prefix = `auth-${Date.now()}`;
    let authCompleteCalled = false;

    setAuthBroadcast(
      () => {}, // onAuthRequired
      () => { authCompleteCalled = true; }, // onAuthComplete
    );

    // Enqueue with getOutputBuffer that returns OAuth URL
    const buffer = ["Starting session...", "Please visit http://localhost:8020/callback to authenticate"];
    enqueueSessionStart(`${prefix}-1`, () => {}, () => buffer);

    // Wait for OAuth detection interval (500ms check cycle)
    await sleep(700);

    // Now signal ready
    signalSessionReady(`${prefix}-1`);

    // Wait for post-signal delay
    await sleep(200);

    expect(authCompleteCalled).toBe(true);

    // Reset callbacks
    setAuthBroadcast(() => {}, () => {});
  });
});

// --- OAuth detection ---

describe("OAuth detection", () => {
  it("detects OAuth URL and calls onAuthRequired", async () => {
    const prefix = `oauth-${Date.now()}`;
    let authUrl = "";

    setAuthBroadcast(
      (url: string) => { authUrl = url; },
      () => {},
    );

    // Start with empty buffer, add OAuth URL after a delay
    const buffer: string[] = [];
    enqueueSessionStart(`${prefix}-1`, () => {}, () => buffer);

    // Add OAuth URL to buffer
    buffer.push("Waiting for authentication...");
    buffer.push("Open http://localhost:8020/auth in your browser");

    // Wait for detection interval (runs every 500ms)
    await sleep(700);

    expect(authUrl).toContain("http://localhost:8020");

    // Signal ready to unblock
    signalSessionReady(`${prefix}-1`);
    await sleep(200);

    // Reset
    setAuthBroadcast(() => {}, () => {});
  });
});
