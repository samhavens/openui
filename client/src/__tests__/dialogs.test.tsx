/**
 * Tests for dialog/modal components — ForkDialog, SettingsModal, ResizeHandle.
 * These components use createPortal and are tested directly without mocking themselves.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useStore } from "../stores/useStore";

// Mock framer-motion
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => {
      const {
        whileHover, whileTap, onTap, initial, animate, exit, transition, ...rest
      } = props;
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
    X: mk("X"), GitFork: mk("GitFork"), GitBranch: mk("GitBranch"),
    FolderOpen: mk("FolderOpen"), ArrowUp: mk("ArrowUp"), Home: mk("Home"),
    Loader2: mk("Loader2"), AlertCircle: mk("AlertCircle"),
    AlertTriangle: mk("AlertTriangle"), ChevronDown: mk("ChevronDown"),
    Sparkles: mk("Sparkles"), Code: mk("Code"), Cpu: mk("Cpu"),
    Zap: mk("Zap"), Rocket: mk("Rocket"), Bot: mk("Bot"),
    Brain: mk("Brain"), Wand2: mk("Wand2"), GripVertical: mk("GripVertical"),
  };
});

beforeEach(() => {
  useStore.setState({ sessions: new Map() });
  global.fetch = vi.fn().mockImplementation((url: string) => {
    if (typeof url === "string" && url.includes("/api/browse")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          current: "/workspace/project",
          parent: "/workspace",
          directories: [{ name: "src", path: "/workspace/project/src" }],
        }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  }) as any;
});

// ─────────────────────────────────────────────────────────────────────────────
// ForkDialog
// ─────────────────────────────────────────────────────────────────────────────

describe("ForkDialog", () => {
  let ForkDialog: any;

  beforeEach(async () => {
    const mod = await import("../components/ForkDialog");
    ForkDialog = mod.ForkDialog;
  });

  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    parentName: "Claude Code",
    parentColor: "#22C55E",
    parentIcon: "cpu",
    parentCwd: "/workspace/project",
    onConfirm: vi.fn(),
  };

  it("renders nothing when closed", () => {
    render(<ForkDialog {...defaultProps} open={false} />);
    expect(screen.queryByText("Fork Agent")).toBeNull();
  });

  it("renders dialog when open", () => {
    render(<ForkDialog {...defaultProps} />);
    expect(screen.getByText("Fork Agent")).toBeTruthy();
  });

  it("shows name input with default fork name", () => {
    render(<ForkDialog {...defaultProps} />);
    const nameInput = screen.getByPlaceholderText("Fork name") as HTMLInputElement;
    expect(nameInput.value).toBe("Claude Code (fork)");
  });

  it("shows color picker", () => {
    render(<ForkDialog {...defaultProps} />);
    expect(screen.getByText("Color")).toBeTruthy();
  });

  it("shows icon picker", () => {
    render(<ForkDialog {...defaultProps} />);
    expect(screen.getByText("Icon")).toBeTruthy();
  });

  it("shows directory input with parent cwd", () => {
    render(<ForkDialog {...defaultProps} />);
    const cwdInput = screen.getByPlaceholderText("/workspace/project") as HTMLInputElement;
    expect(cwdInput.value).toBe("/workspace/project");
  });

  it("shows git branch section", () => {
    render(<ForkDialog {...defaultProps} />);
    expect(screen.getByText("Git Branch (optional)")).toBeTruthy();
  });

  it("cancel button calls onClose", () => {
    const onClose = vi.fn();
    render(<ForkDialog {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
  });

  it("fork button calls onConfirm", () => {
    const onConfirm = vi.fn();
    render(<ForkDialog {...defaultProps} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText("Fork"));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Claude Code (fork)",
        color: "#22C55E",
        icon: "cpu",
      })
    );
  });

  it("shows worktree info when branch name is entered", () => {
    render(<ForkDialog {...defaultProps} />);
    // Click to open branch options
    fireEvent.click(screen.getByText("Git Branch (optional)"));
    // Enter branch name
    const branchInput = screen.getByPlaceholderText("feature/my-branch");
    fireEvent.change(branchInput, { target: { value: "feature/new-branch" } });
    // Should show base branch input
    expect(screen.getByPlaceholderText("main")).toBeTruthy();
    // Should show worktree info text
    expect(screen.getByText(/worktree will be created/)).toBeTruthy();
  });

  it("shows conflict warning when agents in same directory", () => {
    const session = {
      id: "node-1",
      sessionId: "s1",
      agentId: "claude",
      agentName: "Claude Code",
      command: "claude",
      color: "#22C55E",
      createdAt: new Date().toISOString(),
      cwd: "/workspace/project",
      status: "running" as const,
    };
    useStore.setState({ sessions: new Map([["node-1", session]]) });

    render(<ForkDialog {...defaultProps} />);
    expect(screen.getByText(/other agent.*working in this directory/)).toBeTruthy();
  });

  it("clicking Browse directories opens directory picker", () => {
    render(<ForkDialog {...defaultProps} />);
    fireEvent.click(screen.getByTitle("Browse directories"));
    // Should call fetch for /api/browse
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/browse")
    );
  });

  it("changing name updates the input", () => {
    render(<ForkDialog {...defaultProps} />);
    const nameInput = screen.getByPlaceholderText("Fork name") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "My Custom Fork" } });
    expect(nameInput.value).toBe("My Custom Fork");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SettingsModal
// ─────────────────────────────────────────────────────────────────────────────

describe("SettingsModal", () => {
  let SettingsModal: any;

  beforeEach(async () => {
    (global.fetch as any).mockImplementation((url: string) => {
      if (url === "/api/settings") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ defaultBaseBranch: "main", updateChannel: "stable" }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    const mod = await import("../components/SettingsModal");
    SettingsModal = mod.SettingsModal;
  });

  it("renders nothing when closed", () => {
    render(<SettingsModal open={false} onClose={vi.fn()} />);
    expect(screen.queryByText("Settings")).toBeNull();
  });

  it("renders settings form when open", () => {
    render(<SettingsModal open={true} onClose={vi.fn()} />);
    expect(screen.getByText("Settings")).toBeTruthy();
    expect(screen.getByText("Updates")).toBeTruthy();
    expect(screen.getByText("Git")).toBeTruthy();
  });

  it("shows update channel options", () => {
    render(<SettingsModal open={true} onClose={vi.fn()} />);
    expect(screen.getByText("Stable")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
  });

  it("shows base branch input", () => {
    render(<SettingsModal open={true} onClose={vi.fn()} />);
    const branchInput = screen.getByPlaceholderText("main");
    expect(branchInput).toBeTruthy();
  });

  it("cancel button calls onClose", () => {
    const onClose = vi.fn();
    render(<SettingsModal open={true} onClose={onClose} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
  });

  it("save button triggers fetch", () => {
    render(<SettingsModal open={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("Save"));
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/settings",
      expect.objectContaining({ method: "PUT" })
    );
  });

  it("clicking Beta changes update channel description", () => {
    render(<SettingsModal open={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("Beta"));
    expect(screen.getByText(/latest changes from main/)).toBeTruthy();
  });

  it("fetches settings on open", () => {
    render(<SettingsModal open={true} onClose={vi.fn()} />);
    expect(global.fetch).toHaveBeenCalledWith("/api/settings");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ResizeHandle
// ─────────────────────────────────────────────────────────────────────────────

describe("ResizeHandle", () => {
  let ResizeHandle: any;

  beforeEach(async () => {
    const mod = await import("../components/ResizeHandle");
    ResizeHandle = mod.ResizeHandle;
  });

  it("renders grip indicator", () => {
    render(<ResizeHandle onResize={vi.fn()} initialWidth={500} />);
    expect(screen.getByTestId("icon-gripvertical")).toBeTruthy();
  });

  it("calls onResize during mouse drag", () => {
    const onResize = vi.fn();
    const { container } = render(
      <ResizeHandle onResize={onResize} initialWidth={500} minWidth={300} maxWidth={800} />
    );

    const handle = container.firstElementChild as HTMLElement;
    // Start drag
    fireEvent.mouseDown(handle, { clientX: 500 });
    // Move mouse
    fireEvent.mouseMove(document, { clientX: 450 });
    // Should call onResize with new width (500 + (500 - 450) = 550)
    expect(onResize).toHaveBeenCalledWith(550);
  });

  it("respects minWidth", () => {
    const onResize = vi.fn();
    const { container } = render(
      <ResizeHandle onResize={onResize} initialWidth={350} minWidth={300} maxWidth={800} />
    );

    const handle = container.firstElementChild as HTMLElement;
    fireEvent.mouseDown(handle, { clientX: 500 });
    // Move mouse right (shrinking) past min
    fireEvent.mouseMove(document, { clientX: 600 });
    // Width would be 350 + (500-600) = 250, but clamped to 300
    expect(onResize).toHaveBeenCalledWith(300);
  });

  it("respects maxWidth", () => {
    const onResize = vi.fn();
    const { container } = render(
      <ResizeHandle onResize={onResize} initialWidth={700} minWidth={300} maxWidth={800} />
    );

    const handle = container.firstElementChild as HTMLElement;
    fireEvent.mouseDown(handle, { clientX: 500 });
    // Move mouse left (expanding) past max
    fireEvent.mouseMove(document, { clientX: 200 });
    // Width would be 700 + (500-200) = 1000, but clamped to 800
    expect(onResize).toHaveBeenCalledWith(800);
  });

  it("stops resizing on mouseUp", () => {
    const onResize = vi.fn();
    const { container } = render(
      <ResizeHandle onResize={onResize} initialWidth={500} />
    );

    const handle = container.firstElementChild as HTMLElement;
    fireEvent.mouseDown(handle, { clientX: 500 });
    fireEvent.mouseUp(document);
    onResize.mockClear();
    // Further mouse move should not trigger resize
    fireEvent.mouseMove(document, { clientX: 400 });
    expect(onResize).not.toHaveBeenCalled();
  });
});
