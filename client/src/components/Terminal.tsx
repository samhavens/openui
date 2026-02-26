import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { useStore, AgentStatus } from "../stores/useStore";
import { ChevronDown } from "lucide-react";

interface TerminalProps {
  sessionId: string;
  color: string;
  nodeId: string;
}

export function Terminal({ sessionId, color, nodeId }: TerminalProps) {
  const updateSession = useStore((state) => state.updateSession);
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const mountedRef = useRef(false);
  const [showScrollButton, setShowScrollButton] = useState(false);

  useEffect(() => {
    if (!terminalRef.current || !sessionId) return;

    // Prevent double mount in strict mode
    if (mountedRef.current) return;
    mountedRef.current = true;

    // Clear container completely
    while (terminalRef.current.firstChild) {
      terminalRef.current.removeChild(terminalRef.current.firstChild);
    }

    // Create terminal
    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: "bar",
      fontSize: 12,
      fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", Menlo, monospace',
      fontWeight: "400",
      lineHeight: 1.4,
      letterSpacing: 0,
      theme: {
        background: "#0d0d0d",
        foreground: "#d4d4d4",
        cursor: color,
        cursorAccent: "#0d0d0d",
        selectionBackground: "#3b3b3b",
        selectionForeground: "#ffffff",
        black: "#1a1a1a",
        red: "#f87171",
        green: "#4ade80",
        yellow: "#fbbf24",
        blue: "#60a5fa",
        magenta: "#c084fc",
        cyan: "#22d3ee",
        white: "#d4d4d4",
        brightBlack: "#525252",
        brightRed: "#fca5a5",
        brightGreen: "#86efac",
        brightYellow: "#fcd34d",
        brightBlue: "#93c5fd",
        brightMagenta: "#d8b4fe",
        brightCyan: "#67e8f9",
        brightWhite: "#ffffff",
      },
      allowProposedApi: true,
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);

    term.open(terminalRef.current);

    // Reset all terminal attributes before receiving buffered content
    term.write("\x1b[0m\x1b[?25h");

    // Auto-focus so user can type immediately
    term.focus();

    setTimeout(() => fitAddon.fit(), 50);

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Track scroll position via DOM — term.onScroll fires with viewport row index
    // which is unreliable; the .xterm-viewport element is the real scrollable element.
    const viewport = terminalRef.current.querySelector(".xterm-viewport") as HTMLElement | null;

    const checkAtBottom = (): boolean => {
      if (!viewport) return true;
      return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 40;
    };

    const onViewportScroll = () => setShowScrollButton(!checkAtBottom());
    viewport?.addEventListener("scroll", onViewportScroll);

    // Connect WebSocket with small delay to allow session to be ready
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws?sessionId=${sessionId}`;

    let ws: WebSocket | null = null;
    let isFirstMessage = true;

    // Split large writes into 8KB chunks so the browser event loop can breathe
    // between chunks (xterm internally queues write() calls sequentially).
    const writeChunked = (data: string, onDone?: () => void) => {
      const CHUNK = 8192;
      if (data.length <= CHUNK) { term.write(data, onDone); return; }
      let i = 0;
      const next = () => {
        if (i >= data.length) { onDone?.(); return; }
        term.write(data.slice(i, i + CHUNK), next);
        i += CHUNK;
      };
      next();
    };

    const connectWs = () => {
      if (!mountedRef.current) return;

      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        // Fit terminal first to get accurate dimensions
        if (fitAddonRef.current) {
          fitAddonRef.current.fit();
        }
        // Send accurate dimensions to PTY
        if (xtermRef.current) {
          ws?.send(JSON.stringify({ type: "resize", cols: xtermRef.current.cols, rows: xtermRef.current.rows }));
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "output") {
            // On first message (buffered history), reset terminal state first
            if (isFirstMessage) {
              isFirstMessage = false;
              // Clear screen, reset attributes, move cursor home
              term.write("\x1b[2J\x1b[H\x1b[0m");
              // Chunk history write to avoid blocking the UI, scroll after done
              writeChunked(msg.data, () => {
                if (mountedRef.current) {
                  term.scrollToBottom();
                  setShowScrollButton(false);
                }
              });
            } else {
              term.write(msg.data, () => {
                if (mountedRef.current && checkAtBottom()) {
                  setShowScrollButton(false);
                }
              });
            }
          } else if (msg.type === "status") {
            // Handle status updates from plugin hooks
            updateSession(nodeId, {
              status: msg.status as AgentStatus,
              isRestored: msg.isRestored,
              currentTool: msg.currentTool,
              ...(msg.gitBranch ? { gitBranch: msg.gitBranch } : {}),
              longRunningTool: msg.longRunningTool || false,
            });
          } else if (msg.type === "auth_required") {
            // OAuth detected during session start — show auth banner
            useStore.getState().setAuthRequired(msg.url);
          } else if (msg.type === "auth_complete") {
            // Auth completed — dismiss banner
            useStore.getState().clearAuthRequired();
          }
        } catch (e) {
          term.write(event.data);
        }
      };

      ws.onerror = () => {
        // Silently handle errors - don't spam the terminal
      };

      ws.onclose = () => {
        // Only show if not intentionally closed
      };
    };

    // Small delay to let server session be ready
    const connectTimeout = setTimeout(connectWs, 100);

    term.onData((data) => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        if (fitAddonRef.current) {
          fitAddonRef.current.fit();
        }
        if (ws?.readyState === WebSocket.OPEN && xtermRef.current) {
          ws.send(JSON.stringify({
            type: "resize",
            cols: xtermRef.current.cols,
            rows: xtermRef.current.rows
          }));
        }
      });
    });

    resizeObserver.observe(terminalRef.current);

    return () => {
      mountedRef.current = false;
      clearTimeout(connectTimeout);
      resizeObserver.disconnect();
      viewport?.removeEventListener("scroll", onViewportScroll);
      ws?.close();
      term.dispose();
    };
  }, [sessionId, color, nodeId, updateSession]);

  return (
    <div className="relative w-full h-full">
      <div
        ref={terminalRef}
        className="w-full h-full overflow-hidden"
        style={{
          padding: "12px",
          backgroundColor: "#0d0d0d",
          minHeight: "200px",
          boxSizing: "border-box"
        }}
      />
      {showScrollButton && (
        <button
          onClick={() => {
            xtermRef.current?.scrollToBottom();
            setShowScrollButton(false);
          }}
          className="absolute bottom-4 right-4 flex items-center justify-center w-7 h-7 rounded-full bg-zinc-700 hover:bg-zinc-600 text-white opacity-80 hover:opacity-100 transition-all"
          title="Scroll to bottom"
        >
          <ChevronDown className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
