/**
 * Tests for App component — the root component (630 lines).
 * Mocks @xyflow/react, all child components, and fetch.
 *
 * Strategy: Use fake timers to suppress polling intervals.
 * Focus on synchronous render tests for line coverage.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { useStore } from "../stores/useStore";

// Mock @xyflow/react
vi.mock("@xyflow/react", () => ({
  ReactFlow: ({ children, nodes, onNodeClick, onPaneClick }: any) => (
    <div data-testid="reactflow">
      {nodes?.map((n: any) => (
        <div
          key={n.id}
          data-testid={`node-${n.id}`}
          onClick={(e) => onNodeClick?.(e, n)}
        >
          {n.data?.label || n.id}
        </div>
      ))}
      <div data-testid="pane" onClick={() => onPaneClick?.()} />
      {children}
    </div>
  ),
  ReactFlowProvider: ({ children }: any) => <>{children}</>,
  Background: () => <div data-testid="rf-background" />,
  Controls: () => <div data-testid="rf-controls" />,
  BackgroundVariant: { Dots: "dots" },
  useNodesState: (initial: any[]) => [initial, vi.fn(), vi.fn()],
  useReactFlow: () => ({
    fitView: vi.fn(),
    getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    getNodes: () => [],
  }),
}));

vi.mock("@xyflow/react/dist/style.css", () => ({}));

// Mock all child components
vi.mock("../components/AgentNode/index", () => ({
  AgentNode: () => <div data-testid="agent-node" />,
}));
vi.mock("../components/Sidebar", () => ({
  Sidebar: () => <div data-testid="sidebar" />,
}));
vi.mock("../components/NewSessionModal", () => ({
  NewSessionModal: ({ open, onClose }: any) =>
    open ? <div data-testid="new-session-modal"><button onClick={onClose}>close-modal</button></div> : null,
}));
vi.mock("../components/Header", () => ({
  Header: () => <div data-testid="header" />,
}));
vi.mock("../components/CanvasControls", () => ({
  CanvasControls: () => <div data-testid="canvas-controls" />,
}));
vi.mock("../components/CanvasTabs", () => ({
  CanvasTabs: () => <div data-testid="canvas-tabs" />,
}));
vi.mock("../components/AuthBanner", () => ({
  AuthBanner: () => <div data-testid="auth-banner" />,
}));
vi.mock("../components/mobile/MobileApp", () => ({
  MobileApp: () => <div data-testid="mobile-app" />,
}));
vi.mock("../hooks/useIsMobile", () => ({
  useIsMobile: () => {},
}));
vi.mock("lucide-react", () => ({
  Plus: (props: any) => <span data-testid="icon-plus" {...props}>Plus</span>,
}));

function resetStore() {
  useStore.setState({
    nodes: [],
    sessions: new Map(),
    agents: [],
    canvases: [],
    activeCanvasId: null,
    launchCwd: "",
    selectedNodeId: null,
    sidebarOpen: false,
    addAgentModalOpen: false,
    newSessionModalOpen: false,
    newSessionForNodeId: null,
    showArchived: false,
    isMobile: false,
    forceDesktop: false,
    autoResumeProgress: null,
  });
}

beforeEach(() => {
  resetStore();
  // Use fake timers to prevent polling intervals from firing
  vi.useFakeTimers();
  global.fetch = vi.fn().mockImplementation(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  ) as any;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("App", () => {
  let App: any;

  beforeEach(async () => {
    vi.useRealTimers(); // need real timers for dynamic import
    const mod = await import("../App");
    App = mod.default;
    vi.useFakeTimers(); // re-enable for the test
  });

  it("renders desktop layout by default", () => {
    render(<App />);
    expect(screen.getByTestId("header")).toBeTruthy();
    expect(screen.getByTestId("auth-banner")).toBeTruthy();
    expect(screen.getByTestId("canvas-tabs")).toBeTruthy();
    expect(screen.getByTestId("reactflow")).toBeTruthy();
  });

  it("renders MobileApp when isMobile and not forceDesktop", () => {
    useStore.setState({ isMobile: true, forceDesktop: false });
    render(<App />);
    expect(screen.getByTestId("mobile-app")).toBeTruthy();
    expect(screen.queryByTestId("reactflow")).toBeNull();
  });

  it("renders desktop when isMobile but forceDesktop", () => {
    useStore.setState({ isMobile: true, forceDesktop: true });
    render(<App />);
    expect(screen.getByTestId("reactflow")).toBeTruthy();
    expect(screen.queryByTestId("mobile-app")).toBeNull();
  });

  it("shows empty state when no nodes", () => {
    render(<App />);
    expect(screen.getByText("No agents yet")).toBeTruthy();
    expect(screen.getByText("Create Agent")).toBeTruthy();
    expect(screen.getByText("Spawn your first AI agent to get started")).toBeTruthy();
  });

  it("clicking Create Agent opens modal", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Create Agent"));
    expect(useStore.getState().addAgentModalOpen).toBe(true);
  });

  it("shows NewSessionModal when addAgentModalOpen", () => {
    useStore.setState({ addAgentModalOpen: true });
    render(<App />);
    expect(screen.getByTestId("new-session-modal")).toBeTruthy();
  });

  it("shows NewSessionModal when newSessionModalOpen", () => {
    useStore.setState({ newSessionModalOpen: true });
    render(<App />);
    expect(screen.getByTestId("new-session-modal")).toBeTruthy();
  });

  it("closing modal resets modal state", () => {
    useStore.setState({ addAgentModalOpen: true });
    render(<App />);
    fireEvent.click(screen.getByText("close-modal"));
    expect(useStore.getState().addAgentModalOpen).toBe(false);
    expect(useStore.getState().newSessionModalOpen).toBe(false);
    expect(useStore.getState().newSessionForNodeId).toBeNull();
  });

  it("calls fetch on mount for config, agents, canvases", () => {
    render(<App />);
    expect(global.fetch).toHaveBeenCalledWith("/api/config");
    expect(global.fetch).toHaveBeenCalledWith("/api/agents");
    expect(global.fetch).toHaveBeenCalledWith("/api/canvases");
  });

  it("renders Sidebar component", () => {
    render(<App />);
    expect(screen.getByTestId("sidebar")).toBeTruthy();
  });

  it("renders ReactFlow background and controls", () => {
    render(<App />);
    expect(screen.getByTestId("rf-background")).toBeTruthy();
    expect(screen.getByTestId("rf-controls")).toBeTruthy();
    expect(screen.getByTestId("canvas-controls")).toBeTruthy();
  });

  it("Escape key closes sidebar when open", () => {
    useStore.setState({ sidebarOpen: true, selectedNodeId: "node-1" });
    render(<App />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useStore.getState().sidebarOpen).toBe(false);
    expect(useStore.getState().selectedNodeId).toBeNull();
  });

  it("Escape key does nothing when sidebar closed", () => {
    useStore.setState({ sidebarOpen: false });
    render(<App />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useStore.getState().sidebarOpen).toBe(false);
  });

  it("Escape key ignored when typing in input", () => {
    useStore.setState({ sidebarOpen: true, selectedNodeId: "node-1" });
    render(<App />);
    // Create an input and dispatch keydown from it
    const input = document.createElement("input");
    document.body.appendChild(input);
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
    Object.defineProperty(event, "target", { value: input });
    window.dispatchEvent(event);
    // Sidebar should stay open since key came from input
    expect(useStore.getState().sidebarOpen).toBe(true);
    document.body.removeChild(input);
  });

  it("Cmd+1 selects first agent node", () => {
    useStore.setState({
      nodes: [
        { id: "node-1", type: "agent", position: { x: 0, y: 0 }, data: { canvasId: "default", label: "A1" } },
        { id: "node-2", type: "agent", position: { x: 200, y: 0 }, data: { canvasId: "default", label: "A2" } },
      ],
      activeCanvasId: "default",
    });
    render(<App />);
    fireEvent.keyDown(window, { key: "1", metaKey: true });
    expect(useStore.getState().selectedNodeId).toBe("node-1");
    expect(useStore.getState().sidebarOpen).toBe(true);
  });

  it("Cmd+] cycles to next agent", () => {
    useStore.setState({
      nodes: [
        { id: "n1", type: "agent", position: { x: 0, y: 0 }, data: { canvasId: "default", label: "A" } },
        { id: "n2", type: "agent", position: { x: 200, y: 0 }, data: { canvasId: "default", label: "B" } },
      ],
      activeCanvasId: "default",
      selectedNodeId: "n1",
    });
    render(<App />);
    fireEvent.keyDown(window, { key: "]", metaKey: true });
    expect(useStore.getState().selectedNodeId).toBe("n2");
  });

  it("Cmd+[ cycles to previous agent", () => {
    useStore.setState({
      nodes: [
        { id: "n1", type: "agent", position: { x: 0, y: 0 }, data: { canvasId: "default", label: "A" } },
        { id: "n2", type: "agent", position: { x: 200, y: 0 }, data: { canvasId: "default", label: "B" } },
      ],
      activeCanvasId: "default",
      selectedNodeId: "n1",
    });
    render(<App />);
    fireEvent.keyDown(window, { key: "[", metaKey: true });
    // Wraps around to last
    expect(useStore.getState().selectedNodeId).toBe("n2");
  });
});
