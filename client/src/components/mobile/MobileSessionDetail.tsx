import { useEffect, useState } from "react";
import { RotateCcw, Trash2, Check } from "lucide-react";
import { useStore } from "../../stores/useStore";
import { BottomSheet } from "./BottomSheet";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function MobileSessionDetail({ open, onClose }: Props) {
  const { mobileSessionId, sessions, updateSession, removeSession, setMobileView } = useStore();
  const session = mobileSessionId ? sessions.get(mobileSessionId) : undefined;

  const [confirmAction, setConfirmAction] = useState<"restart" | "kill" | "archive" | null>(null);
  const [copied, setCopied] = useState<"branch" | "cwd" | null>(null);
  const [notesValue, setNotesValue] = useState(session?.notes || "");

  const sessionId = session?.sessionId;

  useEffect(() => {
    setNotesValue(session?.notes || "");
  }, [session?.notes]);

  // Reset confirm state when sheet closes
  useEffect(() => {
    if (!open) setConfirmAction(null);
  }, [open]);

  const handleRestart = async () => {
    if (!sessionId) return;
    await fetch(`/api/sessions/${sessionId}/restart`, { method: "POST" });
    setConfirmAction(null);
  };

  const handleKill = async () => {
    if (!sessionId || !mobileSessionId) return;
    await fetch(`/api/sessions/${sessionId}`, { method: "DELETE" });
    removeSession(mobileSessionId);
    setConfirmAction(null);
    onClose();
    setMobileView("dashboard");
  };

  const handleArchive = async () => {
    if (!sessionId || !mobileSessionId) return;
    await fetch(`/api/sessions/${sessionId}/archive`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: true }),
    });
    removeSession(mobileSessionId);
    setConfirmAction(null);
    onClose();
    setMobileView("dashboard");
  };

  const saveNotes = async () => {
    if (!sessionId) return;
    await fetch(`/api/sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: notesValue }),
    });
    if (mobileSessionId) updateSession(mobileSessionId, { notes: notesValue });
  };

  const copy = (type: "branch" | "cwd", value: string) => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(type);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  if (!session) return null;

  const displayName = session.customName || session.agentName;

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      snapPoints={[0.08, 0.5]}
      initialSnap={1}
    >
      <div className="px-4 pb-8">
        {/* Session header */}
        <div className="mb-4">
          <h2 className="text-white font-semibold text-base">{displayName}</h2>
          <div className="flex gap-3 mt-1">
            {session.gitBranch && (
              <button
                className="flex items-center gap-1 text-xs text-zinc-500"
                onClick={() => copy("branch", session.gitBranch!)}
              >
                {copied === "branch" ? <Check className="w-3 h-3 text-green-400" /> : null}
                {session.gitBranch}
              </button>
            )}
            {session.cwd && (
              <button
                className="flex items-center gap-1 text-xs text-zinc-600"
                onClick={() => copy("cwd", session.cwd)}
              >
                {copied === "cwd" ? <Check className="w-3 h-3 text-green-400" /> : null}
                {session.cwd.split("/").slice(-2).join("/")}
              </button>
            )}
          </div>
        </div>

        {/* Notes */}
        <div className="mb-4">
          <label className="text-xs text-zinc-500 mb-1 block">Notes</label>
          <textarea
            value={notesValue}
            onChange={e => setNotesValue(e.target.value)}
            onBlur={saveNotes}
            rows={2}
            placeholder="Add notes…"
            className="w-full bg-zinc-800/40 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500 resize-none"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          {confirmAction === "restart" ? (
            <>
              <button onClick={handleRestart} className="flex-1 bg-amber-600 text-white rounded-xl py-3 text-sm font-medium">Confirm restart</button>
              <button onClick={() => setConfirmAction(null)} className="px-4 bg-zinc-800 text-zinc-400 rounded-xl text-sm">Cancel</button>
            </>
          ) : confirmAction === "kill" ? (
            <>
              <button onClick={handleKill} className="flex-1 bg-red-600 text-white rounded-xl py-3 text-sm font-medium">Confirm kill</button>
              <button onClick={() => setConfirmAction(null)} className="px-4 bg-zinc-800 text-zinc-400 rounded-xl text-sm">Cancel</button>
            </>
          ) : confirmAction === "archive" ? (
            <>
              <button onClick={handleArchive} className="flex-1 bg-zinc-600 text-white rounded-xl py-3 text-sm font-medium">Confirm archive</button>
              <button onClick={() => setConfirmAction(null)} className="px-4 bg-zinc-800 text-zinc-400 rounded-xl text-sm">Cancel</button>
            </>
          ) : (
            <>
              <button
                onClick={() => setConfirmAction("restart")}
                className="flex-1 flex items-center justify-center gap-2 bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-xl py-3 text-sm"
              >
                <RotateCcw className="w-4 h-4" /> Restart
              </button>
              <button
                onClick={() => setConfirmAction("archive")}
                className="flex-1 flex items-center justify-center gap-2 bg-zinc-800 border border-zinc-700 text-zinc-400 rounded-xl py-3 text-sm"
              >
                <Trash2 className="w-4 h-4" /> Archive
              </button>
              <button
                onClick={() => setConfirmAction("kill")}
                className="flex items-center justify-center gap-1.5 bg-zinc-800 border border-red-900/50 text-red-400 rounded-xl px-3 py-3 text-sm"
                title="Force kill (no resume)"
              >
                Kill
              </button>
            </>
          )}
        </div>
      </div>
    </BottomSheet>
  );
}
