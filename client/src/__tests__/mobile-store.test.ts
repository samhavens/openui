import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "../stores/useStore";
import type { AgentSession, Canvas } from "../stores/useStore";

// Reset store between tests
function resetStore() {
  useStore.setState({
    isMobile: false,
    forceDesktop: false,
    mobileView: "dashboard",
    mobileSessionId: null,
    mobileStatusFilter: "all",
    mobileSearchQuery: "",
    sessions: new Map(),
    nodes: [],
    canvases: [],
    activeCanvasId: null,
    selectedNodeId: null,
    sidebarOpen: false,
    addAgentModalOpen: false,
    newSessionModalOpen: false,
    authRequired: false,
    authUrl: null,
    autoResumeProgress: null,
  });
}

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: "test-id",
    sessionId: "session-1",
    agentId: "claude",
    agentName: "Claude Code",
    command: "claude",
    color: "#F97316",
    createdAt: new Date().toISOString(),
    cwd: "/tmp",
    status: "idle",
    ...overrides,
  };
}

function makeCanvas(overrides: Partial<Canvas> = {}): Canvas {
  return {
    id: `canvas-${Math.random().toString(36).slice(2, 6)}`,
    name: "Test Canvas",
    color: "#3B82F6",
    order: 0,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("mobile store state", () => {
  beforeEach(resetStore);

  it("defaults isMobile to false", () => {
    expect(useStore.getState().isMobile).toBe(false);
  });

  it("setIsMobile(true) updates isMobile", () => {
    useStore.getState().setIsMobile(true);
    expect(useStore.getState().isMobile).toBe(true);
  });

  it("mobileView defaults to dashboard", () => {
    expect(useStore.getState().mobileView).toBe("dashboard");
  });

  it("setMobileView updates mobileView", () => {
    useStore.getState().setMobileView("detail");
    expect(useStore.getState().mobileView).toBe("detail");
  });

  it("setMobileView to terminal works", () => {
    useStore.getState().setMobileView("terminal");
    expect(useStore.getState().mobileView).toBe("terminal");
  });

  it("mobileStatusFilter defaults to all", () => {
    expect(useStore.getState().mobileStatusFilter).toBe("all");
  });

  it("setMobileStatusFilter updates filter", () => {
    useStore.getState().setMobileStatusFilter("waiting_input");
    expect(useStore.getState().mobileStatusFilter).toBe("waiting_input");
  });

  it("mobileSearchQuery defaults to empty string", () => {
    expect(useStore.getState().mobileSearchQuery).toBe("");
  });

  it("setMobileSearchQuery updates query", () => {
    useStore.getState().setMobileSearchQuery("foo");
    expect(useStore.getState().mobileSearchQuery).toBe("foo");
  });

  it("setForceDesktop updates store state", () => {
    useStore.getState().setForceDesktop(true);
    expect(useStore.getState().forceDesktop).toBe(true);
  });

  it("mobileSessionId defaults to null", () => {
    expect(useStore.getState().mobileSessionId).toBe(null);
  });

  it("setMobileSessionId sets the id", () => {
    useStore.getState().setMobileSessionId("node-abc");
    expect(useStore.getState().mobileSessionId).toBe("node-abc");
  });
});

// --- Session CRUD ---

describe("session CRUD", () => {
  beforeEach(resetStore);

  it("addSession adds a session to the map", () => {
    const session = makeSession({ sessionId: "s1" });
    useStore.getState().addSession("node-1", session);
    expect(useStore.getState().sessions.has("node-1")).toBe(true);
    expect(useStore.getState().sessions.get("node-1")?.sessionId).toBe("s1");
  });

  it("updateSession merges partial updates", () => {
    useStore.getState().addSession("node-1", makeSession());
    useStore.getState().updateSession("node-1", { status: "running" });
    expect(useStore.getState().sessions.get("node-1")?.status).toBe("running");
    expect(useStore.getState().sessions.get("node-1")?.agentId).toBe("claude");
  });

  it("updateSession no-ops for missing nodeId", () => {
    useStore.getState().updateSession("nonexistent", { status: "running" });
    expect(useStore.getState().sessions.size).toBe(0);
  });

  it("removeSession deletes from map", () => {
    useStore.getState().addSession("node-1", makeSession());
    useStore.getState().removeSession("node-1");
    expect(useStore.getState().sessions.has("node-1")).toBe(false);
  });

  it("removeSession no-ops for missing nodeId", () => {
    useStore.getState().addSession("node-1", makeSession());
    useStore.getState().removeSession("nonexistent");
    expect(useStore.getState().sessions.size).toBe(1);
  });
});

// --- Node CRUD ---

describe("node CRUD", () => {
  beforeEach(resetStore);

  it("setNodes replaces all nodes", () => {
    const nodes = [{ id: "n1", type: "default", position: { x: 0, y: 0 }, data: {} }];
    useStore.getState().setNodes(nodes as any);
    expect(useStore.getState().nodes).toHaveLength(1);
  });

  it("addNode appends to nodes array", () => {
    const node = { id: "n1", type: "default", position: { x: 0, y: 0 }, data: {} };
    useStore.getState().addNode(node as any);
    expect(useStore.getState().nodes).toHaveLength(1);
    expect(useStore.getState().nodes[0].id).toBe("n1");
  });

  it("updateNode merges updates for matching id", () => {
    useStore.getState().addNode({ id: "n1", type: "default", position: { x: 0, y: 0 }, data: {} } as any);
    useStore.getState().updateNode("n1", { position: { x: 100, y: 200 } });
    expect(useStore.getState().nodes[0].position).toEqual({ x: 100, y: 200 });
  });

  it("removeNode filters out matching id", () => {
    useStore.getState().addNode({ id: "n1", type: "default", position: { x: 0, y: 0 }, data: {} } as any);
    useStore.getState().addNode({ id: "n2", type: "default", position: { x: 10, y: 10 }, data: {} } as any);
    useStore.getState().removeNode("n1");
    expect(useStore.getState().nodes).toHaveLength(1);
    expect(useStore.getState().nodes[0].id).toBe("n2");
  });

  it("removeNode no-ops for missing id", () => {
    useStore.getState().addNode({ id: "n1", type: "default", position: { x: 0, y: 0 }, data: {} } as any);
    useStore.getState().removeNode("nonexistent");
    expect(useStore.getState().nodes).toHaveLength(1);
  });
});

// --- Canvas management ---

describe("canvas management", () => {
  beforeEach(resetStore);

  it("setCanvases replaces all canvases", () => {
    const canvases = [makeCanvas({ id: "c1" }), makeCanvas({ id: "c2" })];
    useStore.getState().setCanvases(canvases);
    expect(useStore.getState().canvases).toHaveLength(2);
  });

  it("addCanvas appends to canvases array", () => {
    useStore.getState().addCanvas(makeCanvas({ id: "c1" }));
    expect(useStore.getState().canvases).toHaveLength(1);
  });

  it("updateCanvas merges updates for matching id", () => {
    useStore.getState().addCanvas(makeCanvas({ id: "c1", name: "Old" }));
    useStore.getState().updateCanvas("c1", { name: "New" });
    expect(useStore.getState().canvases[0].name).toBe("New");
    expect(useStore.getState().canvases[0].id).toBe("c1");
  });

  it("removeCanvas filters out matching id", () => {
    useStore.getState().setCanvases([makeCanvas({ id: "c1" }), makeCanvas({ id: "c2" })]);
    useStore.getState().removeCanvas("c1");
    expect(useStore.getState().canvases).toHaveLength(1);
    expect(useStore.getState().canvases[0].id).toBe("c2");
  });

  it("removeCanvas switches activeCanvasId if active canvas removed", () => {
    const c1 = makeCanvas({ id: "c1" });
    const c2 = makeCanvas({ id: "c2" });
    useStore.setState({ canvases: [c1, c2], activeCanvasId: "c1" });
    useStore.getState().removeCanvas("c1");
    expect(useStore.getState().activeCanvasId).toBe("c2");
  });

  it("removeCanvas leaves activeCanvasId unchanged if non-active canvas removed", () => {
    const c1 = makeCanvas({ id: "c1" });
    const c2 = makeCanvas({ id: "c2" });
    useStore.setState({ canvases: [c1, c2], activeCanvasId: "c1" });
    useStore.getState().removeCanvas("c2");
    expect(useStore.getState().activeCanvasId).toBe("c1");
  });

  it("reorderCanvases reorders by given IDs", () => {
    const c1 = makeCanvas({ id: "c1", order: 0 });
    const c2 = makeCanvas({ id: "c2", order: 1 });
    const c3 = makeCanvas({ id: "c3", order: 2 });
    useStore.setState({ canvases: [c1, c2, c3] });
    useStore.getState().reorderCanvases(["c3", "c1", "c2"]);
    const ids = useStore.getState().canvases.map((c) => c.id);
    expect(ids).toEqual(["c3", "c1", "c2"]);
  });

  it("moveNodeToCanvas updates node data.canvasId", () => {
    useStore.getState().addNode({ id: "n1", type: "default", position: { x: 0, y: 0 }, data: { canvasId: "c1" } } as any);
    useStore.getState().moveNodeToCanvas("n1", "c2");
    expect((useStore.getState().nodes[0].data as any).canvasId).toBe("c2");
  });
});

// --- UI state ---

describe("UI state", () => {
  beforeEach(resetStore);

  it("selectedNodeId defaults to null and can be set", () => {
    expect(useStore.getState().selectedNodeId).toBeNull();
    useStore.getState().setSelectedNodeId("node-1");
    expect(useStore.getState().selectedNodeId).toBe("node-1");
  });

  it("sidebarOpen defaults to false and can be toggled", () => {
    expect(useStore.getState().sidebarOpen).toBe(false);
    useStore.getState().setSidebarOpen(true);
    expect(useStore.getState().sidebarOpen).toBe(true);
  });

  it("addAgentModalOpen defaults to false and can be set", () => {
    expect(useStore.getState().addAgentModalOpen).toBe(false);
    useStore.getState().setAddAgentModalOpen(true);
    expect(useStore.getState().addAgentModalOpen).toBe(true);
  });

  it("newSessionModalOpen defaults to false and can be set", () => {
    expect(useStore.getState().newSessionModalOpen).toBe(false);
    useStore.getState().setNewSessionModalOpen(true);
    expect(useStore.getState().newSessionModalOpen).toBe(true);
  });
});

// --- Auth state ---

describe("auth state", () => {
  beforeEach(resetStore);

  it("setAuthRequired sets authRequired and authUrl", () => {
    useStore.getState().setAuthRequired("http://localhost:8020/auth");
    expect(useStore.getState().authRequired).toBe(true);
    expect(useStore.getState().authUrl).toBe("http://localhost:8020/auth");
  });

  it("clearAuthRequired resets auth state", () => {
    useStore.getState().setAuthRequired("http://localhost:8020/auth");
    useStore.getState().clearAuthRequired();
    expect(useStore.getState().authRequired).toBe(false);
    expect(useStore.getState().authUrl).toBeNull();
  });

  it("setAutoResumeProgress sets progress", () => {
    const progress = { total: 5, completed: 2, current: "session-1", isActive: true };
    useStore.getState().setAutoResumeProgress(progress);
    expect(useStore.getState().autoResumeProgress).toEqual(progress);
  });

  it("setAutoResumeProgress can be set to null", () => {
    useStore.getState().setAutoResumeProgress({ total: 5, completed: 5, current: null, isActive: false });
    useStore.getState().setAutoResumeProgress(null);
    expect(useStore.getState().autoResumeProgress).toBeNull();
  });
});
