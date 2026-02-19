import { useEffect, useRef, useState } from "react";
import { Search, WifiOff } from "lucide-react";
import { useStore } from "../../stores/useStore";
import { MobileSessionCard } from "./MobileSessionCard";

type Filter = 'all' | 'waiting_input' | 'running' | 'idle' | 'error';

const FILTER_LABELS: Record<Filter, string> = {
  all: "All",
  waiting_input: "Waiting",
  running: "Running",
  idle: "Idle",
  error: "Error",
};

interface Props {
  /** Bumped by parent when a session is created/resumed — triggers immediate poll. */
  refreshKey?: number;
}

export function MobileDashboard({ refreshKey }: Props) {
  const {
    sessions,
    addSession,
    updateSession,
    mobileStatusFilter,
    setMobileStatusFilter,
    mobileSearchQuery,
    setMobileSearchQuery,
  } = useStore();

  const [offline, setOffline] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const sessionList = Array.from(sessions.values());

  // Adaptive polling: 2s if any session is waiting_input, else 5s
  const hasWaiting = sessionList.some(s => s.status === "waiting_input");
  const pollInterval = hasWaiting ? 2000 : 5000;
  const pollIntervalRef = useRef(pollInterval);
  pollIntervalRef.current = pollInterval;

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;

    const poll = async () => {
      // Pause when document is hidden
      if (document.hidden) {
        timeoutId = setTimeout(poll, 5000);
        return;
      }

      try {
        const res = await fetch("/api/sessions");
        if (res.ok) {
          const data = await res.json();
          setOffline(false);
          setLastRefresh(new Date());
          const current = useStore.getState().sessions;
          for (const s of data) {
            if (!s.nodeId) continue;
            const existing = current.get(s.nodeId);
            if (!existing) {
              // New session — add it to the store
              addSession(s.nodeId, {
                id: s.nodeId,
                sessionId: s.sessionId,
                agentId: s.agentId,
                agentName: s.agentName,
                command: s.command,
                color: s.customColor || "#6366f1",
                createdAt: s.createdAt,
                cwd: s.cwd,
                gitBranch: s.gitBranch,
                status: s.status,
                customName: s.customName,
                notes: s.notes,
                ticketId: s.ticketId,
                ticketTitle: s.ticketTitle,
              });
            } else if (existing.status !== s.status || existing.gitBranch !== s.gitBranch) {
              updateSession(s.nodeId, { status: s.status, gitBranch: s.gitBranch });
            }
          }
        } else {
          setOffline(true);
        }
      } catch {
        setOffline(true);
      }
      timeoutId = setTimeout(poll, pollIntervalRef.current);
    };

    poll();
    return () => clearTimeout(timeoutId);
  }, [updateSession, refreshKey]);

  // Filter + search
  const filtered = sessionList.filter(s => {
    if (mobileStatusFilter !== 'all' && s.status !== mobileStatusFilter) return false;
    if (mobileSearchQuery) {
      const q = mobileSearchQuery.toLowerCase();
      const name = (s.customName || s.agentName || "").toLowerCase();
      const branch = (s.gitBranch || "").toLowerCase();
      const ticket = (s.ticketId || "").toLowerCase();
      if (!name.includes(q) && !branch.includes(q) && !ticket.includes(q)) return false;
    }
    return true;
  });

  // Sort: waiting_input first
  filtered.sort((a, b) => {
    if (a.status === "waiting_input" && b.status !== "waiting_input") return -1;
    if (b.status === "waiting_input" && a.status !== "waiting_input") return 1;
    return 0;
  });

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Offline banner */}
      {offline && (
        <div className="bg-red-900/40 border-b border-red-800/50 px-4 py-2 flex items-center gap-2">
          <WifiOff className="w-4 h-4 text-red-400 flex-shrink-0" />
          <span className="text-xs text-red-300">
            Server unreachable
            {lastRefresh && ` · Last seen ${lastRefresh.toLocaleTimeString()}`}
          </span>
        </div>
      )}

      {/* Search */}
      <div className="px-4 pt-3 pb-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            type="search"
            placeholder="Search agents..."
            value={mobileSearchQuery}
            onChange={e => setMobileSearchQuery(e.target.value)}
            className="w-full bg-zinc-800/60 border border-zinc-700 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
          />
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 px-4 pb-3 overflow-x-auto no-scrollbar">
        {(Object.keys(FILTER_LABELS) as Filter[]).map(f => {
          const count = f === 'all' ? sessionList.length : sessionList.filter(s => s.status === f).length;
          if (f !== 'all' && count === 0) return null;
          return (
            <button
              key={f}
              onClick={() => setMobileStatusFilter(f)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                mobileStatusFilter === f
                  ? 'bg-white text-black'
                  : 'bg-zinc-800 text-zinc-400'
              }`}
            >
              {FILTER_LABELS[f]} {count > 0 && <span className="opacity-70">{count}</span>}
            </button>
          );
        })}
      </div>

      {/* Session list */}
      <div className="px-4 pb-safe-bottom flex flex-col gap-3">
        {filtered.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-zinc-500 text-sm">
              {sessionList.length === 0
                ? "No agents running.\nCreate one on desktop."
                : "No agents match your filter."}
            </p>
          </div>
        ) : (
          filtered.map(s => <MobileSessionCard key={s.id} session={s} />)
        )}
      </div>
    </div>
  );
}
