import { useState, useEffect, useCallback, useRef } from "react";
import { Search } from "lucide-react";
import { BottomSheet } from "./BottomSheet";
import { useStore } from "../../stores/useStore";

interface Conversation {
  sessionId: string;
  slug: string;
  summary: string;
  firstPrompt: string;
  messageCount: number;
  modified: string;
  gitBranch: string;
  projectPath: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function MobileCreateSheet({ open, onClose, onDone }: Props) {
  const { agents } = useStore();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [cwd, setCwd] = useState("~");
  const [creating, setCreating] = useState(false);
  const [resumingId, setResumingId] = useState<string | null>(null);
  // Enhanced summaries fetched from Haiku: sessionId → summary string
  const [contexts, setContexts] = useState<Map<string, string>>(new Map());
  const contextAbort = useRef<AbortController | null>(null);

  const fetchConversations = useCallback((q: string) => {
    setLoading(true);
    setContexts(new Map());
    const params = new URLSearchParams({ limit: "20" });
    if (q.trim()) params.set("q", q.trim());
    fetch(`/api/claude/conversations?${params}`)
      .then((r) => r.json())
      .then((data) => {
        const convs: Conversation[] = Array.isArray(data.conversations) ? data.conversations : [];
        setConversations(convs);
        return convs;
      })
      .then((convs) => fetchContexts(convs))
      .catch(() => setConversations([]))
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Fire parallel Haiku-summary requests for all conversations. Updates as each resolves. */
  const fetchContexts = useCallback((convs: Conversation[]) => {
    // Cancel any previous batch
    if (contextAbort.current) contextAbort.current.abort();
    const ctrl = new AbortController();
    contextAbort.current = ctrl;

    for (const conv of convs) {
      fetch(`/api/claude/conversations/${conv.sessionId}/context`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((data) => {
          if (data.summary) {
            setContexts((prev) => new Map(prev).set(conv.sessionId, data.summary));
          }
        })
        .catch(() => { /* aborted or failed — keep fallback */ });
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setSearch("");
    fetchConversations("");
    return () => { contextAbort.current?.abort(); };
  }, [open, fetchConversations]);

  // Debounced search
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => fetchConversations(search), 300);
    return () => clearTimeout(t);
  }, [search, open, fetchConversations]);

  const defaultAgent = agents.find((a) => a.id === "claude") ?? agents[0];

  const handleResume = async (conv: Conversation) => {
    setResumingId(conv.sessionId);
    try {
      const nodeId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: "claude",
          agentName: "Claude Code",
          command: `claude --resume ${conv.sessionId}`,
          cwd: conv.projectPath || "~",
          nodeId,
        }),
      });
      onDone();
      onClose();
    } finally {
      setResumingId(null);
    }
  };

  const handleCreate = async () => {
    if (!cwd.trim() || !defaultAgent) return;
    setCreating(true);
    try {
      const nodeId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: defaultAgent.id,
          agentName: defaultAgent.name,
          command: defaultAgent.command,
          cwd: cwd.trim(),
          nodeId,
        }),
      });
      onDone();
      onClose();
    } finally {
      setCreating(false);
    }
  };

  return (
    <BottomSheet open={open} onClose={onClose} snapPoints={[0.7, 0.95]} initialSnap={0}>
      <div className="px-4 pb-8 space-y-5">

        {/* New Session */}
        <section>
          <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
            New Session
          </h2>
          <div className="flex gap-2">
            <input
              className="flex-1 bg-zinc-800 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 border border-zinc-700 focus:outline-none focus:border-indigo-500"
              placeholder="Working directory"
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            <button
              onClick={handleCreate}
              disabled={!cwd.trim() || creating || !defaultAgent}
              className="bg-indigo-600 disabled:opacity-40 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shrink-0"
            >
              {creating ? "…" : "Start"}
            </button>
          </div>
        </section>

        {/* Resume */}
        <section>
          <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
            Resume Recent Session
          </h2>

          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
            <input
              className="w-full bg-zinc-800 rounded-xl pl-8 pr-3 py-2 text-sm text-white placeholder:text-zinc-500 border border-zinc-700 focus:outline-none focus:border-indigo-500"
              placeholder="Search sessions…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>

          {loading && <p className="text-sm text-zinc-500 py-2">Loading…</p>}
          {!loading && conversations.length === 0 && (
            <p className="text-sm text-zinc-500 py-2">
              {search ? "No matches." : "No recent sessions found."}
            </p>
          )}

          <div className="space-y-2">
            {conversations.map((conv) => {
              const enhancedSummary = contexts.get(conv.sessionId);
              const displaySummary = enhancedSummary ?? (conv.summary || conv.firstPrompt || "").trim();
              const isLoading = !enhancedSummary && !conv.summary && !conv.firstPrompt;

              return (
                <button
                  key={conv.sessionId}
                  onClick={() => handleResume(conv)}
                  disabled={resumingId === conv.sessionId}
                  className="w-full text-left bg-zinc-800/60 rounded-xl p-3.5 border border-zinc-700/60 active:bg-zinc-700 disabled:opacity-50"
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <span className="font-medium text-white text-sm leading-snug flex-1 truncate">
                      {conv.slug || conv.projectPath.split("/").pop() || "Session"}
                    </span>
                    <span className="text-xs text-zinc-500 shrink-0">{relativeTime(conv.modified)}</span>
                  </div>

                  {/* Summary — skeleton pulse until Haiku responds */}
                  {isLoading ? (
                    <div className="h-3 w-3/4 rounded bg-zinc-700 animate-pulse mb-2" />
                  ) : (
                    <p className="text-xs text-zinc-400 leading-relaxed line-clamp-3 mb-1.5">
                      {displaySummary}
                    </p>
                  )}

                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-xs text-zinc-600 truncate flex-1">
                      {conv.projectPath.replace(/^\/Users\/[^/]+/, "~")}
                    </span>
                    {conv.gitBranch && (
                      <span className="text-xs text-zinc-500 shrink-0">⎇ {conv.gitBranch}</span>
                    )}
                    <span className="text-xs text-indigo-400 font-medium shrink-0">
                      {resumingId === conv.sessionId ? "Starting…" : "Resume →"}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </BottomSheet>
  );
}
