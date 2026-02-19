import { GitBranch, Folder, MessageSquare } from "lucide-react";
import { useStore, type AgentSession } from "../../stores/useStore";

const STATUS_STYLES: Record<string, string> = {
  waiting_input: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  running: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  idle: "bg-zinc-700/50 text-zinc-400 border-zinc-700/40",
  error: "bg-red-500/15 text-red-400 border-red-500/20",
  disconnected: "bg-zinc-800/50 text-zinc-600 border-zinc-700/30",
  tool_calling: "bg-purple-500/15 text-purple-400 border-purple-500/20",
};

const STATUS_LABELS: Record<string, string> = {
  waiting_input: "Waiting",
  running: "Running",
  idle: "Idle",
  error: "Error",
  disconnected: "Disconnected",
  tool_calling: "Using tool",
};

interface Props {
  session: AgentSession;
}

export function MobileSessionCard({ session }: Props) {
  const { setMobileView, setMobileSessionId } = useStore();

  const displayName = session.customName || session.agentName;
  const statusStyle = STATUS_STYLES[session.status] || STATUS_STYLES.idle;
  const statusLabel = STATUS_LABELS[session.status] || session.status;

  const openDetail = () => {
    setMobileSessionId(session.id);
    setMobileView("terminal");
    history.pushState({ view: "terminal", sessionId: session.id }, "");
  };

  const openRespond = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMobileSessionId(session.id);
    setMobileView("terminal");
    history.pushState({ view: "terminal", sessionId: session.id }, "");
  };

  return (
    <div
      className="bg-[#1a1a1a] border border-zinc-800 rounded-xl p-4 active:bg-zinc-800/50 transition-colors cursor-pointer"
      style={{ minHeight: 72 }}
      onClick={openDetail}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: session.customColor || session.color || "#888" }}
            />
            <span className="font-medium text-sm text-white truncate">{displayName}</span>
            <span className={`px-1.5 py-0.5 rounded-full text-xs border flex-shrink-0 ${statusStyle}`}>
              {statusLabel}
            </span>
          </div>

          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {session.gitBranch && (
              <span className="flex items-center gap-1 text-xs text-zinc-500">
                <GitBranch className="w-3 h-3" />
                <span className="truncate max-w-[120px]">{session.gitBranch}</span>
              </span>
            )}
            {session.cwd && (
              <span className="flex items-center gap-1 text-xs text-zinc-600">
                <Folder className="w-3 h-3" />
                <span className="truncate max-w-[140px]">{session.cwd.split("/").slice(-2).join("/")}</span>
              </span>
            )}
            {session.ticketId && (
              <span className="text-xs text-zinc-600">#{session.ticketId}</span>
            )}
          </div>
        </div>

        {session.status === "waiting_input" && (
          <button
            className="flex-shrink-0 flex items-center gap-1.5 bg-amber-500 text-black text-xs font-semibold px-3 py-2 rounded-lg min-h-[44px]"
            onClick={openRespond}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Respond
          </button>
        )}
      </div>
    </div>
  );
}
