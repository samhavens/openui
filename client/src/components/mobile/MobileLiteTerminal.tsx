import { useEffect, useRef, useState, useCallback } from "react";
import { Send, Wifi, WifiOff } from "lucide-react";
import { useStore } from "../../stores/useStore";

interface TailResponse {
  tail: string;
  tail_hash: number;
  bytes: number;
  status: string;
}

export function MobileLiteTerminal() {
  const { mobileSessionId, sessions } = useStore();
  const session = mobileSessionId ? sessions.get(mobileSessionId) : undefined;
  const sessionId = session?.sessionId;

  const [output, setOutput] = useState("");
  const [input, setInput] = useState("");
  const [liveMode, setLiveMode] = useState(false);
  const [sending, setSending] = useState(false);

  const lastHashRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-scroll unless user scrolled up
  const scrollToBottom = useCallback(() => {
    if (!userScrolledRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [output, scrollToBottom]);

  // Poll /tail
  const pollTail = useCallback(async () => {
    if (!sessionId || document.hidden || liveMode) return;
    try {
      const res = await fetch(`/api/sessions/${sessionId}/tail?strip=1&bytes=65536`);
      if (res.ok) {
        const data: TailResponse = await res.json();
        if (data.tail_hash !== lastHashRef.current) {
          lastHashRef.current = data.tail_hash;
          setOutput(data.tail);
        }
      }
    } catch {}
  }, [sessionId, liveMode]);

  useEffect(() => {
    if (liveMode) return;
    pollTail();
    pollRef.current = setInterval(pollTail, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [liveMode, pollTail]);

  // Live WebSocket mode
  useEffect(() => {
    if (!liveMode || !sessionId) return;

    const token = localStorage.getItem("openui-token");
    const wsUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?sessionId=${sessionId}${token ? `&token=${token}` : ""}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "output") {
          setOutput(prev => (prev + msg.data).slice(-200000));
        }
      } catch {}
    };

    ws.onerror = () => setLiveMode(false);

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [liveMode, sessionId]);

  const handleSend = async () => {
    if (!sessionId || !input) return;
    setSending(true);
    try {
      await fetch(`/api/sessions/${sessionId}/input`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: input + "\n" }),
      });
      setInput("");
    } finally {
      setSending(false);
    }
  };

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    userScrolledRef.current = scrollHeight - scrollTop - clientHeight > 50;
  };

  if (!session) return null;

  return (
    <div className="flex flex-col h-full bg-black">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 bg-[#0f0f0f]">
        <span className="text-xs text-zinc-500 font-mono">
          {session.customName || session.agentName}
        </span>
        <button
          onClick={() => setLiveMode(v => !v)}
          className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border ${
            liveMode
              ? "bg-green-500/15 border-green-500/30 text-green-400"
              : "bg-zinc-800 border-zinc-700 text-zinc-400"
          }`}
        >
          {liveMode ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
          {liveMode ? "Live" : "Polling"}
        </button>
      </div>

      {/* Output */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-3 py-2 font-mono text-xs text-zinc-300"
      >
        <pre className="whitespace-pre-wrap break-all">{output || "Loading…"}</pre>
      </div>

      {/* Input — form so iOS keyboard Return fires onSubmit reliably */}
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
          disabled={!input || sending}
          className="bg-white text-black rounded-xl w-11 flex items-center justify-center disabled:opacity-40 flex-shrink-0"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}
