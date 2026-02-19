import { useEffect, useState, useCallback } from "react";
import { useStore } from "../../stores/useStore";
import { MobileHeader } from "./MobileHeader";
import { MobileDashboard } from "./MobileDashboard";
import { MobileSessionDetail } from "./MobileSessionDetail";
import { MobileLiteTerminal } from "./MobileLiteTerminal";
import { MobileCreateSheet } from "./MobileCreateSheet";

export function MobileApp() {
  const { mobileView, setMobileView, setMobileSessionId, mobileSessionId, sessions } = useStore();
  const [showCreate, setShowCreate] = useState(false);
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
      } else if (state.view === "detail") {
        setMobileView("detail");
        if (state.sessionId) setMobileSessionId(state.sessionId);
      } else if (state.view === "terminal") {
        setMobileView("terminal");
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [setMobileView, setMobileSessionId]);

  const detailOpen = mobileView === "detail";
  const session = mobileSessionId ? sessions.get(mobileSessionId) : null;

  return (
    <div className="flex flex-col h-screen bg-[#0f0f0f] overflow-hidden">
      {mobileView !== "terminal" && <MobileHeader onCreateOpen={() => setShowCreate(true)} />}

      {/* Dashboard is always mounted; detail/terminal overlay */}
      {mobileView !== "terminal" && <MobileDashboard refreshKey={refreshKey} />}

      {/* Full-screen terminal */}
      {mobileView === "terminal" && (
        <div className="flex flex-col h-full">
          {/* Minimal terminal header */}
          <div className="safe-top bg-[#0f0f0f] border-b border-zinc-800 px-4 py-2 flex items-center gap-2">
            <button
              className="text-zinc-400 text-lg leading-none"
              onClick={() => {
                setMobileView("detail");
                history.back();
              }}
            >
              ‹
            </button>
            <span className="text-sm text-zinc-400 font-mono">
              {session ? (session.customName || session.agentName) : "Terminal"}
            </span>
          </div>
          <MobileLiteTerminal />
        </div>
      )}

      {/* Create / Resume sheet */}
      <MobileCreateSheet
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onDone={handleDone}
      />

      {/* Detail bottom sheet */}
      <MobileSessionDetail
        open={detailOpen}
        onClose={() => {
          setMobileView("dashboard");
          history.back();
        }}
        onOpenTerminal={() => setMobileView("terminal")}
      />
    </div>
  );
}
