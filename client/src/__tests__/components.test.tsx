/**
 * Component render tests — verify components render without crashing
 * and display expected content with mocked dependencies.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useStore } from "../stores/useStore";
import type { AgentSession } from "../stores/useStore";

// Mock framer-motion
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => {
      const { whileHover, whileTap, onTap, dragControls, dragListener, dragConstraints, dragElastic, onDragEnd, initial, animate, exit, transition, ...rest } = props;
      return <div {...rest}>{children}</div>;
    },
    button: ({ children, ...props }: any) => {
      const { whileHover, whileTap, initial, animate, exit, transition, ...rest } = props;
      return <button {...rest}>{children}</button>;
    },
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
  useMotionValue: () => ({ get: () => 0, set: () => {} }),
  useTransform: () => ({ get: () => 0 }),
  animate: vi.fn(),
  useDragControls: () => ({ start: vi.fn() }),
}));

// Mock lucide-react icons
vi.mock("lucide-react", () => ({
  Plus: () => <span data-testid="icon-plus">+</span>,
  Folder: () => <span data-testid="icon-folder">F</span>,
  Settings: () => <span data-testid="icon-settings">S</span>,
  Archive: () => <span data-testid="icon-archive">A</span>,
  Loader2: () => <span data-testid="icon-loader">L</span>,
  AlertTriangle: () => <span data-testid="icon-alert">!</span>,
  ExternalLink: () => <span data-testid="icon-link">→</span>,
  X: () => <span data-testid="icon-x">X</span>,
  Monitor: () => <span data-testid="icon-monitor">M</span>,
  MoreHorizontal: () => <span data-testid="icon-more">…</span>,
  Send: () => <span data-testid="icon-send">→</span>,
}));

// Mock SettingsModal (used by Header)
vi.mock("../components/SettingsModal", () => ({
  SettingsModal: ({ open }: any) => open ? <div data-testid="settings-modal">Settings</div> : null,
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
    launchCwd: "/test/dir",
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
  });
}

beforeEach(() => {
  resetStore();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => [],
  }) as any;
  window.history.pushState = vi.fn();
});

// --- Header ---

describe("Header", () => {
  let Header: any;

  beforeEach(async () => {
    const mod = await import("../components/Header");
    Header = mod.Header;
  });

  it("renders OpenUI brand text", () => {
    render(<Header />);
    expect(screen.getByText("OpenUI")).toBeTruthy();
  });

  it("renders launchCwd", () => {
    useStore.setState({ launchCwd: "/my/project" });
    render(<Header />);
    expect(screen.getByText("/my/project")).toBeTruthy();
  });

  it("shows status counts for active sessions", () => {
    const s1 = makeSession({ status: "running" });
    const s2 = makeSession({ status: "waiting_input" });
    const s3 = makeSession({ status: "idle" });
    useStore.setState({
      sessions: new Map([[s1.id, s1], [s2.id, s2], [s3.id, s3]]),
    });

    render(<Header />);
    // Should show counts — all three statuses have 1 session each
    const ones = screen.getAllByText("1");
    expect(ones.length).toBe(3);
  });

  it("shows New Agent button", () => {
    render(<Header />);
    expect(screen.getByText("New Agent")).toBeTruthy();
  });

  it("clicking New Agent opens modal", () => {
    render(<Header />);
    fireEvent.click(screen.getByText("New Agent"));
    expect(useStore.getState().addAgentModalOpen).toBe(true);
  });
});

// --- AuthBanner ---

describe("AuthBanner", () => {
  let AuthBanner: any;

  beforeEach(async () => {
    const mod = await import("../components/AuthBanner");
    AuthBanner = mod.AuthBanner;
  });

  it("renders nothing when authRequired is false", () => {
    useStore.setState({ authRequired: false });
    const { container } = render(<AuthBanner />);
    expect(container.innerHTML).toBe("");
  });

  it("renders auth banner when authRequired is true", () => {
    useStore.setState({ authRequired: true });
    render(<AuthBanner />);
    expect(screen.getByText(/authentication required/i)).toBeTruthy();
  });

  it("shows auth URL link when provided", () => {
    useStore.setState({ authRequired: true, authUrl: "https://auth.example.com" });
    render(<AuthBanner />);
    const link = screen.getByText("Open auth page");
    expect(link).toBeTruthy();
    expect(link.closest("a")?.href).toBe("https://auth.example.com/");
  });

  it("dismiss button clears auth required", () => {
    useStore.setState({ authRequired: true });
    render(<AuthBanner />);

    const dismissBtn = screen.getByTitle("Dismiss");
    fireEvent.click(dismissBtn);

    expect(useStore.getState().authRequired).toBe(false);
  });
});

// --- CanvasControls ---

describe("CanvasControls", () => {
  let CanvasControls: any;

  beforeEach(async () => {
    const mod = await import("../components/CanvasControls");
    CanvasControls = mod.CanvasControls;
  });

  it("renders the add agent FAB", () => {
    render(<CanvasControls />);
    expect(screen.getByTitle("New Agent")).toBeTruthy();
  });

  it("clicking FAB opens modal", () => {
    render(<CanvasControls />);
    fireEvent.click(screen.getByTitle("New Agent"));
    expect(useStore.getState().addAgentModalOpen).toBe(true);
  });
});

// --- MobileHeader ---

describe("MobileHeader", () => {
  let MobileHeader: any;

  beforeEach(async () => {
    const mod = await import("../components/mobile/MobileHeader");
    MobileHeader = mod.MobileHeader;
  });

  it("renders OpenUI title", () => {
    render(<MobileHeader onCreateOpen={vi.fn()} />);
    expect(screen.getByText("OpenUI")).toBeTruthy();
  });

  it("renders New and Desktop buttons", () => {
    render(<MobileHeader onCreateOpen={vi.fn()} />);
    expect(screen.getByText("New")).toBeTruthy();
    expect(screen.getByText("Desktop")).toBeTruthy();
  });

  it("shows status chips when sessions exist", () => {
    const s1 = makeSession({ status: "waiting_input" });
    const s2 = makeSession({ status: "running" });
    useStore.setState({ sessions: new Map([[s1.id, s1], [s2.id, s2]]) });

    render(<MobileHeader onCreateOpen={vi.fn()} />);
    expect(screen.getByText("1 waiting")).toBeTruthy();
    expect(screen.getByText("1 running")).toBeTruthy();
  });

  it("shows 'No agents running' when no sessions", () => {
    render(<MobileHeader onCreateOpen={vi.fn()} />);
    expect(screen.getByText("No agents running")).toBeTruthy();
  });

  it("calls onCreateOpen when New is clicked", () => {
    const onCreateOpen = vi.fn();
    render(<MobileHeader onCreateOpen={onCreateOpen} />);
    fireEvent.click(screen.getByText("New"));
    expect(onCreateOpen).toHaveBeenCalled();
  });

  it("Desktop button sets forceDesktop", () => {
    render(<MobileHeader onCreateOpen={vi.fn()} />);
    fireEvent.click(screen.getByText("Desktop"));
    expect(useStore.getState().forceDesktop).toBe(true);
  });
});

// --- BottomSheet ---

describe("BottomSheet", () => {
  let BottomSheet: any;

  beforeEach(async () => {
    const mod = await import("../components/mobile/BottomSheet");
    BottomSheet = mod.BottomSheet;
  });

  it("renders children when open", () => {
    render(
      <BottomSheet open={true} onClose={vi.fn()}>
        <div>Sheet Content</div>
      </BottomSheet>
    );
    expect(screen.getByText("Sheet Content")).toBeTruthy();
  });

  it("does not render children when closed", () => {
    render(
      <BottomSheet open={false} onClose={vi.fn()}>
        <div>Sheet Content</div>
      </BottomSheet>
    );
    expect(screen.queryByText("Sheet Content")).toBeNull();
  });

  it("renders drag handle", () => {
    const { container } = render(
      <BottomSheet open={true} onClose={vi.fn()}>
        <div>Content</div>
      </BottomSheet>
    );
    // Drag handle area exists
    const grabElements = container.querySelectorAll(".cursor-grab");
    expect(grabElements.length).toBeGreaterThan(0);
  });
});
