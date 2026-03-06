/**
 * Tests for useAppInit hook — initialization logic (config, agents, canvases, sessions).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useStore } from "../stores/useStore";

// Mock fetch globally
const mockFetch = vi.fn();

beforeEach(() => {
  // Reset store
  useStore.setState({
    sessions: new Map(),
    nodes: [],
    canvases: [],
    activeCanvasId: null,
    agents: [],
    launchCwd: "",
    showArchived: false,
    autoResumeProgress: null,
    addAgentModalOpen: false,
    authRequired: false,
    authUrl: null,
    isMobile: false,
    forceDesktop: false,
    mobileView: "dashboard",
    mobileSessionId: null,
    mobileStatusFilter: "all",
    mobileSearchQuery: "",
    selectedNodeId: null,
    sidebarOpen: false,
  });

  mockFetch.mockReset();
  global.fetch = mockFetch;

  // Default fetch mocks
  mockFetch.mockImplementation((url: string) => {
    if (url === "/api/config") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ launchCwd: "/test/workspace" }),
      });
    }
    if (url === "/api/agents") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([
          { id: "claude", name: "Claude Code", command: "claude", color: "#22C55E" },
        ]),
      });
    }
    if (url === "/api/canvases") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([
          { id: "default", name: "Default", color: "#3B82F6", order: 0, createdAt: "2024-01-01" },
        ]),
      });
    }
    if (url === "/api/auto-resume/progress") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ isActive: false, total: 0 }),
      });
    }
    if (url === "/api/sessions") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([]),
      });
    }
    if (url === "/api/state") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ nodes: [] }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });

  // Mock localStorage
  vi.spyOn(Storage.prototype, "getItem").mockReturnValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useAppInit", () => {
  it("fetches config and sets launchCwd", async () => {
    const { useAppInit } = await import("../hooks/useAppInit");
    const addSession = vi.fn();

    renderHook(() => useAppInit(addSession));

    await waitFor(() => {
      expect(useStore.getState().launchCwd).toBe("/test/workspace");
    });
  });

  it("fetches agents and sets them in store", async () => {
    const { useAppInit } = await import("../hooks/useAppInit");
    const addSession = vi.fn();

    renderHook(() => useAppInit(addSession));

    await waitFor(() => {
      expect(useStore.getState().agents).toHaveLength(1);
      expect(useStore.getState().agents[0].id).toBe("claude");
    });
  });

  it("fetches canvases and sets them in store", async () => {
    const { useAppInit } = await import("../hooks/useAppInit");
    const addSession = vi.fn();

    renderHook(() => useAppInit(addSession));

    await waitFor(() => {
      expect(useStore.getState().canvases).toHaveLength(1);
      expect(useStore.getState().canvases[0].id).toBe("default");
    });
  });

  it("sets activeCanvasId to first canvas", async () => {
    const { useAppInit } = await import("../hooks/useAppInit");
    const addSession = vi.fn();

    renderHook(() => useAppInit(addSession));

    await waitFor(() => {
      expect(useStore.getState().activeCanvasId).toBe("default");
    });
  });

  it("uses saved activeCanvasId from localStorage when valid", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockReturnValue("default");

    const { useAppInit } = await import("../hooks/useAppInit");
    const addSession = vi.fn();

    renderHook(() => useAppInit(addSession));

    await waitFor(() => {
      expect(useStore.getState().activeCanvasId).toBe("default");
    });
  });

  it("triggers canvas migration when canvases are empty", async () => {
    mockFetch.mockImplementation((url: string, opts?: any) => {
      if (url === "/api/config") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ launchCwd: "/test" }) });
      }
      if (url === "/api/agents") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ id: "claude", name: "Claude", command: "claude", color: "#22C55E" }]),
        });
      }
      if (url === "/api/canvases" && !opts) {
        // First call returns empty
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }
      if (url === "/api/migrate/canvases" && opts?.method === "POST") {
        return Promise.resolve({ ok: true });
      }
      if (url === "/api/canvases") {
        // Second call after migration returns the migrated canvas
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([
            { id: "migrated", name: "Default", color: "#3B82F6", order: 0, createdAt: "2024-01-01" },
          ]),
        });
      }
      if (url === "/api/auto-resume/progress") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ isActive: false, total: 0 }),
        });
      }
      if (url === "/api/sessions") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }
      if (url === "/api/state") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ nodes: [] }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    const { useAppInit } = await import("../hooks/useAppInit");
    const addSession = vi.fn();

    renderHook(() => useAppInit(addSession));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/migrate/canvases", expect.objectContaining({ method: "POST" }));
    });
  });

  it("clears auto-resume progress when not active and total is 0", async () => {
    const { useAppInit } = await import("../hooks/useAppInit");
    const addSession = vi.fn();

    renderHook(() => useAppInit(addSession));

    await waitFor(() => {
      expect(useStore.getState().autoResumeProgress).toBeNull();
    });
  });

  it("sets auto-resume progress when active", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/auto-resume/progress") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ isActive: true, total: 5, completed: 2 }),
        });
      }
      if (url === "/api/config") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ launchCwd: "/test" }) });
      }
      if (url === "/api/agents") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ id: "claude", name: "Claude", command: "claude", color: "#22C55E" }]),
        });
      }
      if (url === "/api/canvases") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ id: "c1", name: "C1", color: "#fff", order: 0, createdAt: "" }]),
        });
      }
      if (url === "/api/sessions") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }
      if (url === "/api/state") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ nodes: [] }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    const { useAppInit } = await import("../hooks/useAppInit");
    const addSession = vi.fn();

    renderHook(() => useAppInit(addSession));

    await waitFor(() => {
      const progress = useStore.getState().autoResumeProgress;
      expect(progress).not.toBeNull();
      expect(progress?.isActive).toBe(true);
      expect(progress?.total).toBe(5);
    });
  });

  it("restores sessions after agents load", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/config") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ launchCwd: "/test" }) });
      }
      if (url === "/api/agents") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ id: "claude", name: "Claude Code", command: "claude", color: "#22C55E" }]),
        });
      }
      if (url === "/api/canvases") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ id: "c1", name: "C1", color: "#fff", order: 0, createdAt: "" }]),
        });
      }
      if (url === "/api/auto-resume/progress") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ isActive: false, total: 0 }),
        });
      }
      if (url === "/api/sessions") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([
            {
              nodeId: "node-1",
              sessionId: "sess-1",
              agentId: "claude",
              agentName: "Claude Code",
              command: "claude",
              createdAt: "2024-01-01T00:00:00Z",
              cwd: "/workspace",
              status: "idle",
            },
          ]),
        });
      }
      if (url === "/api/state") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ nodes: [] }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    const { useAppInit } = await import("../hooks/useAppInit");
    const addSession = vi.fn();

    renderHook(() => useAppInit(addSession));

    await waitFor(() => {
      expect(addSession).toHaveBeenCalledWith("node-1", expect.objectContaining({
        id: "node-1",
        sessionId: "sess-1",
        agentId: "claude",
      }));
    });
  });

  it("handles fetch errors gracefully", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { useAppInit } = await import("../hooks/useAppInit");
    const addSession = vi.fn();

    // Should not throw
    renderHook(() => useAppInit(addSession));

    // Give time for promises to reject
    await new Promise(r => setTimeout(r, 100));
    consoleSpy.mockRestore();
  });
});
