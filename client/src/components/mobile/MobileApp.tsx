import { useEffect, useState, useCallback } from "react";
import { useStore } from "../../stores/useStore";
import { MobileHeader } from "./MobileHeader";
import { MobileDashboard } from "./MobileDashboard";
import { MobileSessionDetail } from "./MobileSessionDetail";
import { MobileLiteTerminal } from "./MobileLiteTerminal";
import { MobileCreateSheet } from "./MobileCreateSheet";
import { MoreHorizontal } from "lucide-react";

export function MobileApp() {
  const { mobileView, setMobileView, setMobileSessionId, mobileSessionId, sessions } = useStore();
  const [showCreate, setShowCreate] = useState(false);
  const [showActions, setShowActions] = useState(false);
  // Bump counter to trigger a dashboard refresh after create/resume
  const [refreshKey, setRefreshKey] = useState(0);
  const handleDone = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Handle browser back button
  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      const state = e.state;
      if (!state) {
        setMobileView("dashboard");
        setMobileSessionId(null);
      } else if (state.view === "terminal") {
        setMobileView("terminal");
        if (state.sessionId) setMobileSessionId(state.sessionId);
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [setMobileView, setMobileSessionId]);

  const session = mobileSessionId ? sessions.get(mobileSessionId) : null;

  return (
    <div className="flex flex-col h-dvh bg-[#0f0f0f] overflow-hidden">
      {mobileView !== "terminal" && <MobileHeader onCreateOpen={() => setShowCreate(true)} />}

      {/* Dashboard is always mounted; terminal overlays */}
      {mobileView !== "terminal" && <MobileDashboard refreshKey={refreshKey} />}

      {/* Full-screen terminal */}
      {mobileView === "terminal" && (
        <div className="flex flex-col h-full">
          {/* Terminal header */}
          <div className="flex-none safe-top bg-[#0f0f0f] border-b border-zinc-800 px-4 py-2 flex items-center gap-2">
            <button
              className="text-zinc-400 text-lg leading-none"
              onClick={() => {
                setMobileView("dashboard");
                setMobileSessionId(null);
                history.back();
              }}
            >
              ‹
            </button>
            <span className="flex-1 text-sm text-zinc-400 font-mono truncate">
              {session ? (session.customName || session.agentName) : "Terminal"}
            </span>
            <button
              className="text-zinc-500 p-1"
              onClick={() => setShowActions(true)}
            >
              <MoreHorizontal className="w-5 h-5" />
            </button>
          </div>
          {/* flex-1 min-h-0: constrains MobileLiteTerminal to remaining height, not full 100vh */}
          <div className="flex-1 min-h-0">
            <MobileLiteTerminal />
          </div>
        </div>
      )}

      {/* Create / Resume sheet */}
      <MobileCreateSheet
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onDone={handleDone}
      />

      {/* Actions sheet (notes, restart, kill, archive) */}
      <MobileSessionDetail
        open={showActions}
        onClose={() => setShowActions(false)}
      />
    </div>
  );
}
