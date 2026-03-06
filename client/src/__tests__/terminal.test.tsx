/**
 * Tests for Terminal and MobileLiteTerminal components.
 * Mocks @xterm/xterm, addons, WebSocket, and ResizeObserver.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { useStore } from "../stores/useStore";

// Share state between mock factories and tests via vi.hoisted
const { terminalInstances, wsInstances } = vi.hoisted(() => ({
  terminalInstances: [] as any[],
  wsInstances: [] as any[],
}));

// Mock @xterm/xterm with a real class
vi.mock("@xterm/xterm", () => {
  class MockTerminal {
    onData: any;
    write: any;
    open: any;
    loadAddon: any;
    focus: any;
    scrollToBottom: any;
    dispose: any;
    cols = 80;
    rows = 24;
    _dataCallback: any = null;

    constructor() {
      this.write = (...args: any[]) => { (this as any)._writes = (this as any)._writes || []; (this as any)._writes.push(args); };
      this.open = () => {};
      this.loadAddon = () => {};
      this.focus = () => {};
      this.scrollToBottom = () => {};
      this.dispose = () => {};
      this.onData = (cb: any) => { this._dataCallback = cb; };
      terminalInstances.push(this);
    }
  }
  return { Terminal: MockTerminal };
});

vi.mock("@xterm/addon-fit", () => {
  class MockFitAddon { fit() {} }
  return { FitAddon: MockFitAddon };
});

vi.mock("@xterm/addon-web-links", () => {
  class MockWebLinksAddon {}
  return { WebLinksAddon: MockWebLinksAddon };
});

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

// Mock lucide-react
vi.mock("lucide-react", () => ({
  Send: (props: any) => <span data-testid="icon-send" {...props}>Send</span>,
}));

// Save originals
const OriginalWebSocket = global.WebSocket;
const OriginalResizeObserver = global.ResizeObserver;

beforeEach(() => {
  terminalInstances.length = 0;
  wsInstances.length = 0;

  // Mock ResizeObserver
  (global as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  // Mock WebSocket
  (global as any).WebSocket = class MockWS {
    static OPEN = 1;
    readyState = 1;
    send = vi.fn();
    close = vi.fn();
    onopen: any = null;
    onmessage: any = null;
    onerror: any = null;
    onclose: any = null;
    constructor() {
      wsInstances.push(this);
      setTimeout(() => this.onopen?.(), 0);
    }
  };
  (global.WebSocket as any).OPEN = 1;

  // Mock fetch
  global.fetch = vi.fn().mockImplementation((url: string) => {
    if (typeof url === "string" && url.includes("/tail")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          tail: "test output",
          status: "running",
          currentTool: null,
          toolInput: null,
        }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  }) as any;

  useStore.setState({
    sessions: new Map(),
    mobileSessionId: null,
  });
});

afterEach(() => {
  global.WebSocket = OriginalWebSocket;
  if (OriginalResizeObserver) {
    global.ResizeObserver = OriginalResizeObserver;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Terminal
// ─────────────────────────────────────────────────────────────────────────────

describe("Terminal", () => {
  let TerminalComponent: any;

  beforeEach(async () => {
    const mod = await import("../components/Terminal");
    TerminalComponent = mod.Terminal;
  });

  it("renders terminal container div", () => {
    const { container } = render(
      <TerminalComponent sessionId="sess-1" color="#22C55E" nodeId="node-1" />
    );
    expect(container.firstElementChild).toBeTruthy();
    expect(container.firstElementChild!.className).toContain("w-full");
  });

  it("creates xterm Terminal instance on mount", () => {
    render(<TerminalComponent sessionId="sess-1" color="#22C55E" nodeId="node-1" />);
    expect(terminalInstances.length).toBeGreaterThanOrEqual(1);
  });

  it("writes reset sequence on open", () => {
    render(<TerminalComponent sessionId="sess-1" color="#22C55E" nodeId="node-1" />);
    const inst = terminalInstances[0];
    const writes = (inst as any)._writes || [];
    const hasResetWrite = writes.some((args: any[]) => args[0] === "\x1b[0m\x1b[?25h");
    expect(hasResetWrite).toBe(true);
  });

  it("creates WebSocket connection after delay", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<TerminalComponent sessionId="sess-1" color="#22C55E" nodeId="node-1" />);
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(wsInstances.length).toBeGreaterThanOrEqual(1);
    vi.useRealTimers();
  });

  it("does not create terminal when sessionId is empty", () => {
    const prevCount = terminalInstances.length;
    render(<TerminalComponent sessionId="" color="#22C55E" nodeId="node-1" />);
    expect(terminalInstances.length).toBe(prevCount);
  });

  it("sets up resize observer on terminal container", () => {
    const observeSpy = vi.spyOn(ResizeObserver.prototype, "observe");
    render(<TerminalComponent sessionId="sess-1" color="#22C55E" nodeId="node-1" />);
    expect(observeSpy).toHaveBeenCalled();
    observeSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MobileLiteTerminal
// ─────────────────────────────────────────────────────────────────────────────

describe("MobileLiteTerminal", () => {
  let MobileLiteTerminal: any;

  beforeEach(async () => {
    const mod = await import("../components/mobile/MobileLiteTerminal");
    MobileLiteTerminal = mod.MobileLiteTerminal;
  });

  it("returns null when no session", () => {
    useStore.setState({ mobileSessionId: null, sessions: new Map() });
    const { container } = render(<MobileLiteTerminal />);
    expect(container.innerHTML).toBe("");
  });

  it("renders input bar when session exists", () => {
    const session = {
      id: "node-1", sessionId: "sess-1", agentId: "claude", agentName: "Claude Code",
      command: "claude", color: "#22C55E", createdAt: new Date().toISOString(),
      cwd: "/workspace", status: "running" as const,
    };
    useStore.setState({
      mobileSessionId: "node-1",
      sessions: new Map([["node-1", session]]),
    });

    render(<MobileLiteTerminal />);
    expect(screen.getByPlaceholderText("Input…")).toBeTruthy();
    expect(screen.getByTestId("icon-send")).toBeTruthy();
  });

  it("creates xterm instance when session exists", () => {
    const session = {
      id: "node-1", sessionId: "sess-1", agentId: "claude", agentName: "Claude Code",
      command: "claude", color: "#22C55E", createdAt: new Date().toISOString(),
      cwd: "/workspace", status: "running" as const,
    };
    useStore.setState({
      mobileSessionId: "node-1",
      sessions: new Map([["node-1", session]]),
    });

    render(<MobileLiteTerminal />);
    expect(terminalInstances.length).toBeGreaterThanOrEqual(1);
  });

  it("polls /tail for macro state", async () => {
    const session = {
      id: "node-1", sessionId: "sess-1", agentId: "claude", agentName: "Claude Code",
      command: "claude", color: "#22C55E", createdAt: new Date().toISOString(),
      cwd: "/workspace", status: "running" as const,
    };
    useStore.setState({
      mobileSessionId: "node-1",
      sessions: new Map([["node-1", session]]),
    });

    render(<MobileLiteTerminal />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/sessions/sess-1/tail")
      );
    });
  });

  it("typing in input updates its value", () => {
    const session = {
      id: "node-1", sessionId: "sess-1", agentId: "claude", agentName: "Claude Code",
      command: "claude", color: "#22C55E", createdAt: new Date().toISOString(),
      cwd: "/workspace", status: "running" as const,
    };
    useStore.setState({
      mobileSessionId: "node-1",
      sessions: new Map([["node-1", session]]),
    });

    render(<MobileLiteTerminal />);
    const input = screen.getByPlaceholderText("Input…") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "hello" } });
    expect(input.value).toBe("hello");
  });

  it("submitting form sends input via WebSocket", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const session = {
      id: "node-1", sessionId: "sess-1", agentId: "claude", agentName: "Claude Code",
      command: "claude", color: "#22C55E", createdAt: new Date().toISOString(),
      cwd: "/workspace", status: "running" as const,
    };
    useStore.setState({
      mobileSessionId: "node-1",
      sessions: new Map([["node-1", session]]),
    });

    render(<MobileLiteTerminal />);
    await act(async () => { vi.advanceTimersByTime(200); });

    const input = screen.getByPlaceholderText("Input…");
    fireEvent.change(input, { target: { value: "test cmd" } });
    fireEvent.submit(input.closest("form")!);

    const ws = wsInstances[0];
    if (ws) {
      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ type: "input", data: "test cmd" })
      );
    }
    vi.useRealTimers();
  });
});
