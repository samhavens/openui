/**
 * Tests for:
 * 1. Mobile/desktop render gate in AppContent
 * 2. MobileDashboard filtering and search
 * 3. Session card navigation
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useStore } from "../stores/useStore";
import { MobileDashboard } from "../components/mobile/MobileDashboard";
import { MobileSessionCard } from "../components/mobile/MobileSessionCard";
import type { AgentSession } from "../stores/useStore";

// Mock framer-motion to avoid animation complexity in tests
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
  useMotionValue: () => ({ get: () => 0 }),
  useTransform: () => ({ get: () => 0 }),
  animate: vi.fn(),
}));

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: `node-${Math.random()}`,
    sessionId: `session-${Math.random()}`,
    agentId: "claude",
    agentName: "Claude Code",
    command: "claude",
    color: "#888",
    createdAt: new Date().toISOString(),
    cwd: "/workspace/project",
    status: "idle",
    ...overrides,
  };
}

function resetStore() {
  useStore.setState({
    sessions: new Map(),
    isMobile: false,
    forceDesktop: false,
    mobileView: "dashboard",
    mobileSessionId: null,
    mobileStatusFilter: "all",
    mobileSearchQuery: "",
  });
}

// Stub fetch for dashboard polling
beforeEach(() => {
  resetStore();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => [],
  }) as any;
  // Mock history.pushState
  window.history.pushState = vi.fn();
});

describe("MobileDashboard filtering", () => {
  it("shows all sessions by default", () => {
    const s1 = makeSession({ customName: "Alpha", status: "idle" });
    const s2 = makeSession({ customName: "Beta", status: "running" });
    useStore.setState({ sessions: new Map([[s1.id, s1], [s2.id, s2]]) });

    render(<MobileDashboard />);
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
  });

  it("filter waiting_input only shows those sessions", () => {
    const s1 = makeSession({ customName: "Alpha", status: "idle" });
    const s2 = makeSession({ customName: "Beta", status: "waiting_input" });
    useStore.setState({
      sessions: new Map([[s1.id, s1], [s2.id, s2]]),
      mobileStatusFilter: "waiting_input",
    });

    render(<MobileDashboard />);
    expect(screen.queryByText("Alpha")).toBeNull();
    expect(screen.getByText("Beta")).toBeTruthy();
  });

  it("search filters by agent name", () => {
    const s1 = makeSession({ customName: "MyFoo", status: "idle" });
    const s2 = makeSession({ customName: "OtherBar", status: "idle" });
    useStore.setState({
      sessions: new Map([[s1.id, s1], [s2.id, s2]]),
      mobileSearchQuery: "foo",
    });

    render(<MobileDashboard />);
    expect(screen.getByText("MyFoo")).toBeTruthy();
    expect(screen.queryByText("OtherBar")).toBeNull();
  });

  it("search filters by branch", () => {
    const s1 = makeSession({ customName: "Agent1", gitBranch: "feature/auth", status: "idle" });
    const s2 = makeSession({ customName: "Agent2", gitBranch: "main", status: "idle" });
    useStore.setState({
      sessions: new Map([[s1.id, s1], [s2.id, s2]]),
      mobileSearchQuery: "auth",
    });

    render(<MobileDashboard />);
    expect(screen.getByText("Agent1")).toBeTruthy();
    expect(screen.queryByText("Agent2")).toBeNull();
  });

  it("shows empty state when no sessions exist", () => {
    render(<MobileDashboard />);
    expect(screen.getByText(/no agents/i)).toBeTruthy();
  });
});

describe("MobileSessionCard navigation", () => {
  it("tapping card sets mobileView to detail and sets mobileSessionId", () => {
    const session = makeSession({ customName: "Tappable" });
    useStore.setState({ sessions: new Map([[session.id, session]]) });

    render(<MobileSessionCard session={session} />);
    const card = screen.getByText("Tappable").closest("div[class]")!;
    fireEvent.click(card);

    const state = useStore.getState();
    expect(state.mobileView).toBe("detail");
    expect(state.mobileSessionId).toBe(session.id);
  });

  it("Respond button is shown for waiting_input sessions", () => {
    const session = makeSession({ status: "waiting_input", customName: "Waiting" });
    render(<MobileSessionCard session={session} />);
    expect(screen.getByText("Respond")).toBeTruthy();
  });

  it("Respond button is NOT shown for idle sessions", () => {
    const session = makeSession({ status: "idle", customName: "IdleOne" });
    render(<MobileSessionCard session={session} />);
    expect(screen.queryByText("Respond")).toBeNull();
  });
});
