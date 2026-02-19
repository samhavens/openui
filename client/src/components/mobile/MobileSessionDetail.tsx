import { useEffect, useRef, useState, useCallback } from "react";
import { Send, RotateCcw, Trash2, Terminal, Check } from "lucide-react";
import { useStore } from "../../stores/useStore";
import { BottomSheet } from "./BottomSheet";

interface TailResponse {
  tail: string;
  tail_hash: number;
  bytes: number;
  status: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onOpenTerminal: () => void;
}

const MACROS = [
  { label: "y", data: "y\n" },
  { label: "n", data: "n\n" },
  { label: "continue", data: "continue\n" },
  { label: "ctrl-c", data: "\x03" },
];

export function MobileSessionDetail({ open, onClose, onOpenTerminal }: Props) {
  const { mobileSessionId, sessions, updateSession, removeSession } = useStore();
  const session = mobileSessionId ? sessions.get(mobileSessionId) : undefined;

  const [tail, setTail] = useState("");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"restart" | "kill" | "archive" | null>(null);
  const [copied, setCopied] = useState<"branch" | "cwd" | null>(null);
  const [notesValue, setNotesValue] = useState(session?.notes || "");

  const lastHashRef = useRef<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sessionId = session?.sessionId;

  // Poll tail every 3s, skip DOM update if hash unchanged
  const pollTail = useCallback(async () => {
    if (!sessionId || document.hidden) return;
    try {
      const res = await fetch(`/api/sessions/${sessionId}/tail?strip=1&bytes=8192`);
      if (res.ok) {
        const data: TailResponse = await res.json();
        if (data.tail_hash !== lastHashRef.current) {
          lastHashRef.current = data.tail_hash;
          setTail(data.tail);
        }
      }
    } catch {}
  }, [sessionId]);

  useEffect(() => {
    if (!open) return;
    pollTail();
    pollRef.current = setInterval(pollTail, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [open, pollTail]);

  // Sync notes value when session changes
  useEffect(() => {
    setNotesValue(session?.notes || "");
  }, [session?.notes]);

  const sendInput = async (data: string) => {
    if (!sessionId || !data) return;
    setSending(true);
    try {
      await fetch(`/api/sessions/${sessionId}/input`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data }),
      });
      setInput("");
    } finally {
      setSending(false);
    }
  };

  const handleSend = () => sendInput(input.includes("\n") ? input : input + "\n");

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
      snapPoints={[0.08, 0.95]}
      initialSnap={1}
    >
      <div className="px-4 pb-8">
        {/* Session header */}
        <div className="flex items-center justify-between mb-4">
          <div>
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
          <button
            className="flex items-center gap-1.5 text-xs text-zinc-400 border border-zinc-700 rounded-lg px-2.5 py-2"
            onClick={() => { onOpenTerminal(); history.pushState({ view: "terminal" }, ""); }}
          >
            <Terminal className="w-3.5 h-3.5" />
            Full
          </button>
        </div>

        {/* Tail preview */}
        <div className="bg-black/40 rounded-xl p-3 mb-4 font-mono text-xs text-zinc-300 overflow-hidden" style={{ maxHeight: 180 }}>
          {tail ? (
            <pre className="whitespace-pre-wrap break-all overflow-y-auto" style={{ maxHeight: 164 }}>
              {tail.slice(-2000)}
            </pre>
          ) : (
            <span className="text-zinc-600">No output yet…</span>
          )}
        </div>

        {/* Macro buttons */}
        <div className="flex gap-2 mb-3 overflow-x-auto no-scrollbar">
          {MACROS.map(m => (
            <button
              key={m.label}
              onClick={() => sendInput(m.data)}
              className="flex-shrink-0 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-300 min-h-[44px]"
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Input — form so iOS keyboard Return fires onSubmit reliably */}
        <form className="flex gap-2 mb-4" onSubmit={e => { e.preventDefault(); handleSend(); }}>
          <input
            type="text"
            enterKeyHint="send"
            placeholder="Send a message…"
            value={input}
            onChange={e => setInput(e.target.value)}
            className="flex-1 bg-zinc-800/60 border border-zinc-700 rounded-xl px-3 py-3 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500 min-h-[44px]"
          />
          <button
            type="submit"
            disabled={!input || sending}
            className="bg-white text-black rounded-xl w-11 flex items-center justify-center disabled:opacity-40 flex-shrink-0"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>

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

        {/* Danger actions */}
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
