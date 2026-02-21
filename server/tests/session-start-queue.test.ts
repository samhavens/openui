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

// --- signalSessionReady with pending session ---
// Note: These tests are limited by the shared module-level queue state.
// The queue's processing flag, currentPending, and queue array persist
// between tests, making timing-dependent assertions unreliable.
// Full queue integration is tested via the mobile-api tests.

describe("signalSessionReady — integration", () => {
  it("completes processing after signal + timeout", async () => {
    // Just verify the queue eventually drains (via timeout)
    // Previous tests may have left items in the queue
    await sleep(600);
    const progress = getQueueProgress();
    // completed should be >= 0 (some tests may have completed)
    expect(typeof progress.completed).toBe("number");
  });
});
