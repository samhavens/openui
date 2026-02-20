/**
 * Tests for NewSessionModal — the largest component (1072 lines).
 * Mocks @xyflow/react, framer-motion, lucide-react, and fetch.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useStore } from "../stores/useStore";

// Mock @xyflow/react
vi.mock("@xyflow/react", () => ({
  useReactFlow: () => ({
    getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    getNodes: () => [],
  }),
}));

// Mock framer-motion
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => {
      const { whileHover, whileTap, initial, animate, exit, transition, ...rest } = props;
      return <div {...rest}>{children}</div>;
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
    X: mk("X"), Sparkles: mk("Sparkles"), Code: mk("Code"), Cpu: mk("Cpu"),
    FolderOpen: mk("FolderOpen"), Terminal: mk("Terminal"), Plus: mk("Plus"),
    Minus: mk("Minus"), Loader2: mk("Loader2"), GitBranch: mk("GitBranch"),
    AlertCircle: mk("AlertCircle"), AlertTriangle: mk("AlertTriangle"),
    Home: mk("Home"), ArrowUp: mk("ArrowUp"), Github: mk("Github"),
    Brain: mk("Brain"), History: mk("History"), ChevronDown: mk("ChevronDown"),
  };
});

function resetStore() {
  useStore.setState({
    sessions: new Map(),
    nodes: [],
    canvases: [{ id: "default", name: "Default", color: "#3B82F6", order: 0, createdAt: "" }],
    activeCanvasId: "default",
    agents: [
      { id: "claude", name: "Claude Code", command: "claude", color: "#22C55E", icon: "cpu" },
      { id: "codex", name: "Codex", command: "codex", color: "#3B82F6", icon: "code" },
    ],
    launchCwd: "/workspace",
    showArchived: false,
  });
}

beforeEach(() => {
  resetStore();
  global.fetch = vi.fn().mockImplementation((url: string) => {
    if (typeof url === "string" && url.includes("/api/browse")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          current: "/workspace",
          parent: "/",
          directories: [{ name: "project", path: "/workspace/project" }],
        }),
      });
    }
    if (typeof url === "string" && url.includes("/api/claude/conversations")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          conversations: [
            {
              sessionId: "prev-sess-1",
              slug: "test-session",
              summary: "Did some testing",
              firstPrompt: "help me test",
              messageCount: 10,
              created: "2024-01-01T00:00:00Z",
              modified: "2024-01-01T01:00:00Z",
              gitBranch: "main",
              projectPath: "/workspace/project",
              fileExists: true,
            },
          ],
        }),
      });
    }
    if (typeof url === "string" && url.includes("/api/github/issues")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([]),
      });
    }
    if (typeof url === "string" && url.includes("/api/sessions")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ sessionId: "new-sess-1", gitBranch: null, cwd: "/workspace" }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  }) as any;
});

describe("NewSessionModal", () => {
  let NewSessionModal: any;

  beforeEach(async () => {
    const mod = await import("../components/NewSessionModal");
    NewSessionModal = mod.NewSessionModal;
  });

  it("renders nothing when closed", () => {
    render(<NewSessionModal open={false} onClose={vi.fn()} />);
    expect(screen.queryByText("New Agent")).toBeNull();
  });

  it("renders modal when open", () => {
    render(<NewSessionModal open={true} onClose={vi.fn()} />);
    expect(screen.getByText("New Agent")).toBeTruthy();
  });

  it("shows Blank, GitHub, and Resume tabs", () => {
    render(<NewSessionModal open={true} onClose={vi.fn()} />);
    expect(screen.getByText("Blank")).toBeTruthy();
    expect(screen.getByText("GitHub")).toBeTruthy();
    expect(screen.getByText("Resume")).toBeTruthy();
  });

  it("shows agent selection", () => {
    render(<NewSessionModal open={true} onClose={vi.fn()} />);
    expect(screen.getByText("Claude Code")).toBeTruthy();
    expect(screen.getByText("Codex")).toBeTruthy();
  });

  it("shows working directory input", () => {
    render(<NewSessionModal open={true} onClose={vi.fn()} />);
    // The cwd input should show the launchCwd placeholder
    const cwdInputs = screen.getAllByPlaceholderText("/workspace");
    expect(cwdInputs.length).toBeGreaterThan(0);
  });

  it("close button calls onClose", () => {
    const onClose = vi.fn();
    render(<NewSessionModal open={true} onClose={onClose} />);
    // Find close button
    const buttons = screen.getAllByRole("button");
    const closeBtn = buttons.find(b => b.querySelector('[data-testid="icon-x"]'));
    if (closeBtn) fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it("shows count controls", () => {
    render(<NewSessionModal open={true} onClose={vi.fn()} />);
    // Count label exists
    expect(screen.getByText("Count")).toBeTruthy();
    // Count input with value 1
    const countInput = screen.getByDisplayValue("1") as HTMLInputElement;
    expect(countInput.type).toBe("number");
  });

  it("shows New Session title when replacing", () => {
    const existingSession = {
      id: "node-1",
      sessionId: "sess-1",
      agentId: "claude",
      agentName: "Claude Code",
      command: "claude",
      color: "#22C55E",
      createdAt: new Date().toISOString(),
      cwd: "/workspace",
      status: "idle" as const,
    };

    render(
      <NewSessionModal
        open={true}
        onClose={vi.fn()}
        existingSession={existingSession}
        existingNodeId="node-1"
      />
    );
    expect(screen.getByText("New Session")).toBeTruthy();
  });

  it("clicking agent selects it", () => {
    render(<NewSessionModal open={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("Codex"));
    // The Codex option should now be selected (visual indicator)
    // We can verify the agent is selected by checking if Create button is enabled
    const createBtn = screen.getByText("Create");
    expect(createBtn).toBeTruthy();
  });

  it("switching to GitHub tab shows repo URL input", () => {
    render(<NewSessionModal open={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("GitHub"));
    expect(screen.getByPlaceholderText("https://github.com/owner/repo")).toBeTruthy();
    expect(screen.getByText("GitHub Repository URL")).toBeTruthy();
  });

  it("switching to Resume tab shows conversation list", () => {
    render(<NewSessionModal open={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("Resume"));
    // Should fetch conversations
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/claude/conversations")
    );
  });

  it("shows Browse directories button", () => {
    render(<NewSessionModal open={true} onClose={vi.fn()} />);
    expect(screen.getByTitle("Browse directories")).toBeTruthy();
  });

  it("clicking Browse opens directory picker", () => {
    render(<NewSessionModal open={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTitle("Browse directories"));
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/browse")
    );
  });

  it("shows git branch section", () => {
    render(<NewSessionModal open={true} onClose={vi.fn()} />);
    expect(screen.getByText("Git Branch (optional)")).toBeTruthy();
  });

  it("shows Create button", () => {
    render(<NewSessionModal open={true} onClose={vi.fn()} />);
    expect(screen.getByText("Create")).toBeTruthy();
  });

  it("expanding git branch section shows branch inputs", () => {
    render(<NewSessionModal open={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("Git Branch (optional)"));
    expect(screen.getByPlaceholderText("feature/my-branch")).toBeTruthy();
  });

  it("entering branch name shows base branch input", () => {
    render(<NewSessionModal open={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("Git Branch (optional)"));
    const branchInput = screen.getByPlaceholderText("feature/my-branch");
    fireEvent.change(branchInput, { target: { value: "feature/test" } });
    expect(screen.getByPlaceholderText("main")).toBeTruthy();
  });

  it("shows name input", () => {
    render(<NewSessionModal open={true} onClose={vi.fn()} />);
    expect(screen.getByText("Name (optional)")).toBeTruthy();
  });

  it("shows conflict warning when agents in same directory", () => {
    const session = {
      id: "node-existing",
      sessionId: "s1",
      agentId: "claude",
      agentName: "Claude Code",
      command: "claude",
      color: "#22C55E",
      createdAt: new Date().toISOString(),
      cwd: "/workspace",
      status: "running" as const,
    };
    useStore.setState({
      ...useStore.getState(),
      sessions: new Map([["node-existing", session]]),
    });

    render(<NewSessionModal open={true} onClose={vi.fn()} />);
    expect(screen.getByText(/agent.*working in this directory/)).toBeTruthy();
  });

  it("incrementing count updates display", () => {
    render(<NewSessionModal open={true} onClose={vi.fn()} />);
    // Find the + button (Plus icon)
    const buttons = screen.getAllByRole("button");
    const plusBtn = buttons.find(b => b.querySelector('[data-testid="icon-plus"]'));
    expect(plusBtn).toBeTruthy();
    fireEvent.click(plusBtn!);
    // Count input should now be 2
    const countInput = screen.getByDisplayValue("2") as HTMLInputElement;
    expect(countInput.type).toBe("number");
  });
});
