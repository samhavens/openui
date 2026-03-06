import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useStore } from "../stores/useStore";
import { useIsMobile } from "../hooks/useIsMobile";

// Track matchMedia listeners
let matchMediaListeners: ((e: { matches: boolean }) => void)[] = [];
let currentMatches = false;

function setMatchMedia(matches: boolean) {
  currentMatches = matches;
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn((query: string) => ({
      matches: currentMatches,
      media: query,
      onchange: null,
      addEventListener: (_: string, handler: (e: { matches: boolean }) => void) => {
        matchMediaListeners.push(handler);
      },
      removeEventListener: (_: string, handler: (e: { matches: boolean }) => void) => {
        matchMediaListeners = matchMediaListeners.filter((h) => h !== handler);
      },
      dispatchEvent: () => false,
    })),
  });
}

beforeEach(() => {
  matchMediaListeners = [];
  useStore.setState({ isMobile: false, forceDesktop: false });
});

describe("useIsMobile", () => {
  it("sets isMobile to true for narrow viewport", () => {
    setMatchMedia(true);
    renderHook(() => useIsMobile());
    expect(useStore.getState().isMobile).toBe(true);
  });

  it("sets isMobile to false for wide viewport", () => {
    setMatchMedia(false);
    renderHook(() => useIsMobile());
    expect(useStore.getState().isMobile).toBe(false);
  });

  it("respects forceDesktop override", () => {
    setMatchMedia(true);
    useStore.setState({ forceDesktop: true });
    renderHook(() => useIsMobile());
    expect(useStore.getState().isMobile).toBe(false);
  });

  it("responds to matchMedia change events", () => {
    setMatchMedia(false);
    renderHook(() => useIsMobile());
    expect(useStore.getState().isMobile).toBe(false);

    // Simulate viewport resize
    act(() => {
      for (const listener of matchMediaListeners) {
        listener({ matches: true });
      }
    });
    expect(useStore.getState().isMobile).toBe(true);
  });
});
