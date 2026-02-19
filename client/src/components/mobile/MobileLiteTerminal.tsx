import { useEffect, useRef, useState, useCallback } from "react";
import { Send } from "lucide-react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { useStore } from "../../stores/useStore";

interface TailResponse {
  tail: string;
  status: string;
  currentTool?: string;
  toolInput?: any;
}

interface Macro {
  label: string;
  data: string;
  variant?: "primary" | "danger" | "default";
}

const FALLBACK_MACROS: Macro[] = [
  { label: "y", data: "y\r" },
  { label: "n", data: "n\r" },
  { label: "continue", data: "continue\r" },
  { label: "ctrl-c", data: "\x03", variant: "danger" },
];

const ARROW_DOWN = "\x1b[B";
const ENTER = "\r";

function parseNumberedOptions(tailText: string): Macro[] | null {
  const recent = tailText.slice(-1500);
  // ❯/› must be directly before the number (same line, only whitespace between).
  // This prevents matching a standalone ❯ (Claude Code's prompt cursor) paired
  // with random digits from spinner animations.
  const matches = [
    ...recent.matchAll(/(?:^|\n)[ \t]*([❯›]?)[ \t]*(\d+)[.)]\s+(.+)/gm),
  ];
  if (matches.length < 2) return null;

  // Only count ❯/› as a selector indicator if the cursor is on the SAME match
  // as a number (i.e., group 1 is non-empty in a match that also has group 2).
  const isSelector =
    matches.some((m) => m[1] && m[2]) ||
    /enter to confirm/i.test(recent);

  const cursorOnNum = matches.find((m) => m[1])
    ? matches.find((m) => m[1])![2]
    : "1";

  const seen = new Set<string>();
  const items: { num: string; label: string }[] = [];
  for (const m of matches) {
    const num = m[2];
    if (seen.has(num)) continue;
    seen.add(num);
    let label = m[3].trim().replace(/\s{2,}/g, " ");
    if (label.length > 30) label = label.slice(0, 28) + "…";
    items.push({ num, label });
  }

  if (items.length < 2) return null;

  // Only show buttons for interactive selectors (❯ cursor or "enter to confirm").
  // Plain numbered lists in output are not actionable prompts.
  if (!isSelector) return null;

  const cursorIdx = items.findIndex((i) => i.num === cursorOnNum);
  return items.map((item, idx) => {
    const moves = idx - (cursorIdx >= 0 ? cursorIdx : 0);
    const arrows = moves > 0 ? ARROW_DOWN.repeat(moves) : "";
    return {
      label: item.label,
      data: arrows + ENTER,
      variant: idx === 0 ? ("primary" as const) : ("default" as const),
    };
  });
}

function computeMacros(
  status: string | undefined,
  currentTool: string | undefined,
  toolInput: any,
  tailText: string,
): { macros: Macro[]; context?: string } {
  if (status === "waiting_input" && currentTool) {
    if (currentTool === "AskUserQuestion" && toolInput?.questions?.[0]?.options) {
      const options = toolInput.questions[0].options as { label: string }[];
      const macros: Macro[] = options.map((opt, i) => ({
        label: opt.label,
        data: `${i + 1}\r`,
        variant: i === 0 ? "primary" as const : "default" as const,
      }));
      return { macros, context: "Question" };
    }
    return {
      macros: [
        { label: "Allow", data: "\r", variant: "primary" },
        { label: "Deny", data: "\x1b", variant: "danger" },
      ],
      context: `Permission: ${currentTool}`,
    };
  }

  if (status === "running") {
    return {
      macros: [{ label: "Interrupt", data: "\x03", variant: "danger" }],
    };
  }

  if (tailText) {
    const parsed = parseNumberedOptions(tailText);
    if (parsed) {
      return { macros: parsed, context: "Choose" };
    }
  }

  if (status === "waiting_input" || status === "idle") {
    return { macros: [] };
  }

  return { macros: FALLBACK_MACROS };
}

const VARIANT_CLASSES: Record<string, string> = {
  primary: "bg-green-800 border-green-700 text-green-200",
  danger: "bg-red-900/60 border-red-800 text-red-300",
  default: "bg-zinc-800 border-zinc-700 text-zinc-300",
};

export function MobileLiteTerminal() {
  const { mobileSessionId, sessions } = useStore();
  const session = mobileSessionId ? sessions.get(mobileSessionId) : undefined;
  const sessionId = session?.sessionId;

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [macros, setMacros] = useState<Macro[]>([]);
  const [macroContext, setMacroContext] = useState<string | undefined>();

  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const mountedRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Poll for status to drive macro buttons
  const pollStatus = useCallback(async () => {
    if (!sessionId || document.hidden) return;
    try {
      const res = await fetch(`/api/sessions/${sessionId}/tail?strip=1&bytes=2048`);
      if (res.ok) {
        const data: TailResponse = await res.json();
        const { macros: m, context } = computeMacros(data.status, data.currentTool, data.toolInput, data.tail);
        setMacros(m);
        setMacroContext(context);
      }
    } catch {}
  }, [sessionId]);

  useEffect(() => {
    pollStatus();
    pollRef.current = setInterval(pollStatus, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [pollStatus]);

  // xterm.js + WebSocket setup
  useEffect(() => {
    if (!terminalRef.current || !sessionId) return;

    if (mountedRef.current) return;
    mountedRef.current = true;

    while (terminalRef.current.firstChild) {
      terminalRef.current.removeChild(terminalRef.current.firstChild);
    }

    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: "bar",
      fontSize: 10,
      fontFamily: '"SF Mono", Menlo, "JetBrains Mono", "Fira Code", monospace',
      fontWeight: "400",
      lineHeight: 1.3,
      letterSpacing: 0,
      theme: {
        background: "#0d0d0d",
        foreground: "#d4d4d4",
        cursor: "#4ade80",
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
      scrollback: 5000,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);

    term.open(terminalRef.current);
    term.write("\x1b[0m\x1b[?25h");

    setTimeout(() => fitAddon.fit(), 50);

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    const token = localStorage.getItem("openui-token");
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${location.host}/ws?sessionId=${sessionId}${token ? `&token=${token}` : ""}`;

    let ws: WebSocket | null = null;
    let isFirstMessage = true;

    const connectWs = () => {
      if (!mountedRef.current) return;

      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (fitAddonRef.current) fitAddonRef.current.fit();
        if (xtermRef.current && ws) {
          ws.send(JSON.stringify({
            type: "resize",
            cols: xtermRef.current.cols,
            rows: xtermRef.current.rows,
          }));
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "output") {
            if (isFirstMessage) {
              isFirstMessage = false;
              term.write("\x1b[2J\x1b[H\x1b[0m");
              term.write(msg.data);
              setTimeout(() => {
                if (mountedRef.current) term.scrollToBottom();
              }, 50);
            } else {
              term.write(msg.data);
            }
          }
        } catch (e) {
          term.write(event.data);
        }
      };

      ws.onerror = () => {};
      ws.onclose = () => {};
    };

    const connectTimeout = setTimeout(connectWs, 100);

    term.onData((data) => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        if (fitAddonRef.current) fitAddonRef.current.fit();
        if (ws?.readyState === WebSocket.OPEN && xtermRef.current) {
          ws.send(JSON.stringify({
            type: "resize",
            cols: xtermRef.current.cols,
            rows: xtermRef.current.rows,
          }));
        }
      });
    });

    resizeObserver.observe(terminalRef.current);

    return () => {
      mountedRef.current = false;
      clearTimeout(connectTimeout);
      resizeObserver.disconnect();
      ws?.close();
      wsRef.current = null;
      term.dispose();
    };
  }, [sessionId]);

  const sendViaWs = (data: string) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "input", data }));
    }
  };

  const sendMacro = (data: string) => {
    // Split trailing \r so the PTY processes text before the carriage return
    // (same issue as handleSend — bulk "text\r" writes don't trigger ink's submit)
    if (data.length > 1 && data.endsWith("\r")) {
      sendViaWs(data.slice(0, -1));
      setTimeout(() => sendViaWs("\r"), 50);
    } else {
      sendViaWs(data);
    }
    // Poll immediately so macro buttons update without waiting 3s
    setTimeout(pollStatus, 500);
  };

  const handleSend = () => {
    if (!sessionId || !input.trim()) return;
    setSending(true);
    sendViaWs(input);
    // Delay \r so PTY processes the text before the carriage return
    setTimeout(() => {
      sendViaWs("\r");
      setSending(false);
    }, 50);
    setInput("");
  };

  if (!session) return null;

  return (
    <div className="flex flex-col h-full bg-black">
      {/* Terminal */}
      <div
        ref={terminalRef}
        className="flex-1 overflow-hidden"
        style={{
          padding: "4px",
          backgroundColor: "#0d0d0d",
          minHeight: "200px",
          boxSizing: "border-box",
        }}
      />

      {/* Macro buttons */}
      {macros.length > 0 && (
        <div className="border-t border-zinc-800 bg-[#0f0f0f] px-3 pt-2 pb-1">
          {macroContext && (
            <div className="text-[10px] text-zinc-500 mb-1 px-0.5">{macroContext}</div>
          )}
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {macros.map(m => (
              <button
                key={m.label}
                onClick={() => sendMacro(m.data)}
                className={`flex-shrink-0 px-3 py-2 border rounded-lg text-xs min-h-[36px] ${
                  VARIANT_CLASSES[m.variant || "default"]
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input bar */}
      <form
        className="safe-bottom border-t border-zinc-800 bg-[#0f0f0f] px-3 py-2 flex gap-2"
        onSubmit={e => { e.preventDefault(); handleSend(); }}
      >
        <input
          type="text"
          enterKeyHint="send"
          placeholder="Input…"
          value={input}
          onChange={e => setInput(e.target.value)}
          className="flex-1 bg-zinc-800/60 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none font-mono min-h-[44px]"
        />
        <button
          type="submit"
          disabled={sending}
          className="bg-white text-black rounded-xl w-11 flex items-center justify-center disabled:opacity-40 flex-shrink-0"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}
