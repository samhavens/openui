import { Monitor, Plus } from "lucide-react";
import { useStore } from "../../stores/useStore";

interface Props {
  onCreateOpen: () => void;
}

export function MobileHeader({ onCreateOpen }: Props) {
  const { sessions, setForceDesktop } = useStore();

  const sessionList = Array.from(sessions.values());
  const waiting = sessionList.filter(s => s.status === "waiting_input").length;
  const running = sessionList.filter(s => s.status === "running").length;
  const idle = sessionList.filter(s => s.status === "idle").length;

  return (
    <header className="safe-top bg-[#0f0f0f] border-b border-zinc-800 px-4 pt-2 pb-3">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-white text-base tracking-tight">OpenUI</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="flex items-center gap-1 text-xs text-indigo-400 border border-indigo-500/40 rounded-lg px-2.5 py-1.5"
            onClick={onCreateOpen}
          >
            <Plus className="w-3.5 h-3.5" />
            New
          </button>
          <button
            className="flex items-center gap-1.5 text-xs text-zinc-500 border border-zinc-700 rounded-lg px-2.5 py-1.5"
            onClick={() => setForceDesktop(true)}
          >
            <Monitor className="w-3.5 h-3.5" />
            Desktop
          </button>
        </div>
      </div>

      {/* Status summary chips */}
      <div className="flex gap-2">
        {waiting > 0 && (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-400 border border-amber-500/20">
            {waiting} waiting
          </span>
        )}
        {running > 0 && (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/15 text-blue-400 border border-blue-500/20">
            {running} running
          </span>
        )}
        {idle > 0 && (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-zinc-700/50 text-zinc-400 border border-zinc-700/50">
            {idle} idle
          </span>
        )}
        {sessionList.length === 0 && (
          <span className="text-xs text-zinc-600">No agents running</span>
        )}
      </div>
    </header>
  );
}
