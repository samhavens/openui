/**
 * Tests for useAgentNodeState hook and AgentNode component.
 * Mocks store, fetch, framer-motion, lucide-react.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { useStore } from "../stores/useStore";

// Mock framer-motion
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => {
      const { whileHover, whileTap, initial, animate, exit, transition, onContextMenu, ...rest } = props;
      return <div onContextMenu={onContextMenu} {...rest}>{children}</div>;
    },
    button: ({ children, ...props }: any) => {
      const { whileHover, whileTap, initial, animate, exit, transition, ...rest } = props;
      return <button {...rest}>{children}</button>;
    },
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// Mock lucide-react
vi.mock("lucide-react", () => {
  const mk = (name: string) => {
    const Ic = (props: any) => <span data-testid={`icon-${name.toLowerCase()}`} {...props}>{name}</span>;
    Ic.displayName = name;
    return Ic;
  };
  return {
    Sparkles: mk("Sparkles"), Code: mk("Code"), Cpu: mk("Cpu"),
    Zap: mk("Zap"), Rocket: mk("Rocket"), Bot: mk("Bot"),
    Brain: mk("Brain"), Wand2: mk("Wand2"), X: mk("X"),
    Trash2: mk("Trash2"), GitFork: mk("GitFork"),
    FolderOpen: mk("FolderOpen"), ArrowUp: mk("ArrowUp"),
    Home: mk("Home"), Loader2: mk("Loader2"),
    AlertCircle: mk("AlertCircle"), AlertTriangle: mk("AlertTriangle"),
    ChevronDown: mk("ChevronDown"), GitBranch: mk("GitBranch"),
  };
});

// Mock ForkDialog
vi.mock("../components/ForkDialog", () => ({
  ForkDialog: ({ open }: any) => open ? <div data-testid="fork-dialog" /> : null,
}));

// Mock AgentNodeCard
vi.mock("../components/AgentNode/AgentNodeCard", () => ({
  AgentNodeCard: (props: any) => (
    <div data-testid="agent-node-card" data-status={props.status}>
      {props.displayName}
    </div>
  ),
}));

// Mock AgentNodeContextMenu
vi.mock("../components/AgentNode/AgentNodeContextMenu", () => ({
  AgentNodeContextMenu: ({ onDelete, onFork, onClose }: any) => (
    <div data-testid="context-menu" className="context-menu-container">
      <button data-testid="ctx-delete" onClick={onDelete}>Delete</button>
      <button data-testid="ctx-fork" onClick={onFork}>Fork</button>
      <button data-testid="ctx-close" onClick={onClose}>Close</button>
    </div>
  ),
}));

function resetStore() {
  useStore.setState({
    sessions: new Map(),
    nodes: [],
    agents: [
      { id: "claude", name: "Claude Code", command: "claude", color: "#22C55E", icon: "sparkles" },
      { id: "codex", name: "Codex", command: "codex", color: "#3B82F6", icon: "code" },
    ],
    activeCanvasId: "default",
    selectedNodeId: null,
    sidebarOpen: false,
  });
}

beforeEach(() => {
  resetStore();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({}),
  }) as any;
});

// ─────────────────────────────────────────────────────────────────────────────
// useAgentNodeState
// ─────────────────────────────────────────────────────────────────────────────

describe("useAgentNodeState", () => {
  let useAgentNodeState: any;

  beforeEach(async () => {
    const mod = await import("../components/AgentNode/useAgentNodeState");
    useAgentNodeState = mod.useAgentNodeState;
  });

  const nodeData = { sessionId: "sess-1", agentId: "claude", color: "#22C55E", icon: "sparkles" };

  it("initial state has no context menu", () => {
    const session = {
      id: "node-1", sessionId: "sess-1", agentId: "claude", agentName: "Claude Code",
      command: "claude", color: "#22C55E", createdAt: "", cwd: "/workspace", status: "idle" as const,
    };
    useStore.setState({ sessions: new Map([["node-1", session]]) });

    const { result } = renderHook(() => useAgentNodeState("node-1", nodeData, session));
    expect(result.current.contextMenu).toBeNull();
  });

  it("canFork is true for claude agents", () => {
    const session = {
      id: "node-1", sessionId: "sess-1", agentId: "claude", agentName: "Claude Code",
      command: "claude", color: "#22C55E", createdAt: "", cwd: "/workspace", status: "idle" as const,
    };
    useStore.setState({ sessions: new Map([["node-1", session]]) });

    const { result } = renderHook(() => useAgentNodeState("node-1", nodeData, session));
    expect(result.current.canFork).toBe(true);
  });

  it("canFork is false for non-claude agents", () => {
    const session = {
      id: "node-1", sessionId: "sess-1", agentId: "codex", agentName: "Codex",
      command: "codex", color: "#3B82F6", createdAt: "", cwd: "/workspace", status: "idle" as const,
    };
    const codexNodeData = { sessionId: "sess-1", agentId: "codex", color: "#3B82F6", icon: "code" };
    useStore.setState({ sessions: new Map([["node-1", session]]) });

    const { result } = renderHook(() => useAgentNodeState("node-1", codexNodeData, session));
    expect(result.current.canFork).toBe(false);
  });

  it("handleDelete calls fetch DELETE and removes session/node", async () => {
    const session = {
      id: "node-1", sessionId: "sess-1", agentId: "claude", agentName: "Claude Code",
      command: "claude", color: "#22C55E", createdAt: "", cwd: "/workspace", status: "idle" as const,
    };
    useStore.setState({
      sessions: new Map([["node-1", session]]),
      nodes: [{ id: "node-1", type: "agent", position: { x: 0, y: 0 }, data: {} }],
    });

    const { result } = renderHook(() => useAgentNodeState("node-1", nodeData, session));

    await act(async () => {
      await result.current.handleDelete();
    });

    expect(global.fetch).toHaveBeenCalledWith("/api/sessions/sess-1", { method: "DELETE" });
    expect(useStore.getState().sessions.has("node-1")).toBe(false);
  });

  it("handleFork opens fork dialog and closes context menu", () => {
    const session = {
      id: "node-1", sessionId: "sess-1", agentId: "claude", agentName: "Claude Code",
      command: "claude", color: "#22C55E", createdAt: "", cwd: "/workspace", status: "idle" as const,
    };
    useStore.setState({ sessions: new Map([["node-1", session]]) });

    const { result } = renderHook(() => useAgentNodeState("node-1", nodeData, session));

    act(() => {
      result.current.handleFork();
    });

    expect(result.current.forkDialogOpen).toBe(true);
    expect(result.current.contextMenu).toBeNull();
  });

  it("closeContextMenu sets context menu to null", () => {
    const session = {
      id: "node-1", sessionId: "sess-1", agentId: "claude", agentName: "Claude Code",
      command: "claude", color: "#22C55E", createdAt: "", cwd: "/workspace", status: "idle" as const,
    };
    useStore.setState({ sessions: new Map([["node-1", session]]) });

    const { result } = renderHook(() => useAgentNodeState("node-1", nodeData, session));

    act(() => {
      result.current.closeContextMenu();
    });

    expect(result.current.contextMenu).toBeNull();
  });

  it("handleForkConfirm calls fork endpoint", async () => {
    const session = {
      id: "node-1", sessionId: "sess-1", agentId: "claude", agentName: "Claude Code",
      command: "claude", color: "#22C55E", createdAt: "", cwd: "/workspace", status: "idle" as const,
    };
    useStore.setState({
      sessions: new Map([["node-1", session]]),
      nodes: [{ id: "node-1", type: "agent", position: { x: 100, y: 100 }, data: {} }],
      activeCanvasId: "default",
    });

    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        sessionId: "fork-sess-1",
        nodeId: "fork-node-1",
        agentId: "claude",
        agentName: "Claude Code",
        cwd: "/workspace",
      }),
    });

    const { result } = renderHook(() => useAgentNodeState("node-1", nodeData, session));

    await act(async () => {
      await result.current.handleForkConfirm({
        name: "My Fork",
        color: "#FF0000",
        icon: "sparkles",
        cwd: "/workspace",
      });
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/sessions/sess-1/fork",
      expect.objectContaining({ method: "POST" })
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AgentNode (render)
// ─────────────────────────────────────────────────────────────────────────────

describe("AgentNode", () => {
  let AgentNode: any;

  beforeEach(async () => {
    const mod = await import("../components/AgentNode/index");
    AgentNode = mod.AgentNode;
  });

  it("renders AgentNodeCard with correct display name", () => {
    const session = {
      id: "node-1", sessionId: "sess-1", agentId: "claude", agentName: "Claude Code",
      command: "claude", color: "#22C55E", createdAt: "", cwd: "/workspace", status: "idle" as const,
    };
    useStore.setState({ sessions: new Map([["node-1", session]]) });

    render(
      <AgentNode
        id="node-1"
        data={{ label: "Claude Code", agentId: "claude", color: "#22C55E", icon: "sparkles", sessionId: "sess-1" }}
        selected={false}
        type="agent"
        isConnectable={false}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        zIndex={0}
        dragging={false}
        deletable={false}
        selectable={false}
        parentId=""
        sourcePosition={undefined}
        targetPosition={undefined}
      />
    );

    expect(screen.getByTestId("agent-node-card")).toBeTruthy();
    expect(screen.getByText("Claude Code")).toBeTruthy();
  });

  it("renders with custom name from session", () => {
    const session = {
      id: "node-1", sessionId: "sess-1", agentId: "claude", agentName: "Claude Code",
      customName: "My Custom Agent",
      command: "claude", color: "#22C55E", createdAt: "", cwd: "/workspace", status: "running" as const,
    };
    useStore.setState({ sessions: new Map([["node-1", session]]) });

    render(
      <AgentNode
        id="node-1"
        data={{ label: "Claude Code", agentId: "claude", color: "#22C55E", icon: "sparkles", sessionId: "sess-1" }}
        selected={false}
        type="agent"
        isConnectable={false}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        zIndex={0}
        dragging={false}
        deletable={false}
        selectable={false}
        parentId=""
        sourcePosition={undefined}
        targetPosition={undefined}
      />
    );

    expect(screen.getByText("My Custom Agent")).toBeTruthy();
  });

  it("shows context menu on right-click", () => {
    const session = {
      id: "node-1", sessionId: "sess-1", agentId: "claude", agentName: "Claude Code",
      command: "claude", color: "#22C55E", createdAt: "", cwd: "/workspace", status: "idle" as const,
    };
    useStore.setState({ sessions: new Map([["node-1", session]]) });

    render(
      <AgentNode
        id="node-1"
        data={{ label: "Claude Code", agentId: "claude", color: "#22C55E", icon: "sparkles", sessionId: "sess-1" }}
        selected={false}
        type="agent"
        isConnectable={false}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        zIndex={0}
        dragging={false}
        deletable={false}
        selectable={false}
        parentId=""
        sourcePosition={undefined}
        targetPosition={undefined}
      />
    );

    // Right-click on the card wrapper
    const card = screen.getByTestId("agent-node-card");
    fireEvent.contextMenu(card.parentElement!);

    expect(screen.getByTestId("context-menu")).toBeTruthy();
  });

  it("does not show ForkDialog by default", () => {
    const session = {
      id: "node-1", sessionId: "sess-1", agentId: "claude", agentName: "Claude Code",
      command: "claude", color: "#22C55E", createdAt: "", cwd: "/workspace", status: "idle" as const,
    };
    useStore.setState({ sessions: new Map([["node-1", session]]) });

    render(
      <AgentNode
        id="node-1"
        data={{ label: "Claude Code", agentId: "claude", color: "#22C55E", icon: "sparkles", sessionId: "sess-1" }}
        selected={false}
        type="agent"
        isConnectable={false}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        zIndex={0}
        dragging={false}
        deletable={false}
        selectable={false}
        parentId=""
        sourcePosition={undefined}
        targetPosition={undefined}
      />
    );

    expect(screen.queryByTestId("fork-dialog")).toBeNull();
  });

  it("uses status from store", () => {
    const session = {
      id: "node-1", sessionId: "sess-1", agentId: "claude", agentName: "Claude Code",
      command: "claude", color: "#22C55E", createdAt: "", cwd: "/workspace", status: "running" as const,
    };
    useStore.setState({ sessions: new Map([["node-1", session]]) });

    render(
      <AgentNode
        id="node-1"
        data={{ label: "Claude Code", agentId: "claude", color: "#22C55E", icon: "sparkles", sessionId: "sess-1" }}
        selected={false}
        type="agent"
        isConnectable={false}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        zIndex={0}
        dragging={false}
        deletable={false}
        selectable={false}
        parentId=""
        sourcePosition={undefined}
        targetPosition={undefined}
      />
    );

    const card = screen.getByTestId("agent-node-card");
    expect(card.getAttribute("data-status")).toBe("running");
  });
});
