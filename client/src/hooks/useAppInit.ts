/**
 * useAppInit — shared initialization logic extracted from App.tsx.
 * Populates sessions, agents, canvases in the Zustand store.
 * Both desktop and mobile read from this shared state.
 */
import { useEffect, useRef } from "react";
import { useStore, type AppState } from "../stores/useStore";

type AddSession = AppState["addSession"];

export function useAppInit(addSession: AddSession) {
  const {
    setAgents,
    setLaunchCwd,
    setCanvases,
    setActiveCanvasId,
    setAutoResumeProgress,
    agents,
    activeCanvasId,
  } = useStore();

  const hasRestoredRef = useRef(false);

  // Fetch config and agents on mount
  useEffect(() => {
    fetch("/api/config")
      .then((res) => res.json())
      .then((config) => setLaunchCwd(config.launchCwd))
      .catch(console.error);

    fetch("/api/agents")
      .then((res) => res.json())
      .then((agents) => setAgents(agents))
      .catch(console.error);
  }, [setAgents, setLaunchCwd]);

  // Load canvases (with migration if needed)
  useEffect(() => {
    fetch("/api/canvases")
      .then(res => res.json())
      .then(canvases => {
        if (canvases.length === 0) {
          fetch("/api/migrate/canvases", { method: "POST" })
            .then(() => fetch("/api/canvases"))
            .then(res => res.json())
            .then(migratedCanvases => {
              setCanvases(migratedCanvases);
              const savedActiveId = localStorage.getItem("openui-active-canvas");
              const validCanvasId = savedActiveId && migratedCanvases.find((c: any) => c.id === savedActiveId)
                ? savedActiveId
                : migratedCanvases[0]?.id;
              setActiveCanvasId(validCanvasId);
            });
        } else {
          setCanvases(canvases);
          const savedActiveId = localStorage.getItem("openui-active-canvas");
          const validCanvasId = savedActiveId && canvases.find((c: any) => c.id === savedActiveId)
            ? savedActiveId
            : canvases[0]?.id;
          setActiveCanvasId(validCanvasId);
        }
      })
      .catch(console.error);
  }, [setCanvases, setActiveCanvasId]);

  // Poll auto-resume progress during startup
  useEffect(() => {
    let stopped = false;

    const poll = async () => {
      try {
        const res = await fetch("/api/auto-resume/progress");
        if (res.ok) {
          const progress = await res.json();
          setAutoResumeProgress(progress);
          if (!progress.isActive && progress.total > 0) {
            setTimeout(() => {
              if (!stopped) setAutoResumeProgress(null);
            }, 2000);
            return;
          }
          if (!progress.isActive && progress.total === 0) {
            setAutoResumeProgress(null);
            return;
          }
        }
      } catch {
        // Ignore
      }
      if (!stopped) setTimeout(poll, 1500);
    };

    poll();
    return () => { stopped = true; };
  }, [setAutoResumeProgress]);

  // Restore sessions after agents are loaded
  useEffect(() => {
    if (agents.length === 0 || hasRestoredRef.current) return;

    Promise.all([
      fetch("/api/sessions").then((res) => res.json()),
      fetch("/api/state").then((res) => res.json()),
    ])
      .then(([sessions, { nodes: savedNodes }]) => {
        sessions.forEach((session: any) => {
          const agent = agents.find((a) => a.id === session.agentId);

          addSession(session.nodeId, {
            id: session.nodeId,
            sessionId: session.sessionId,
            agentId: session.agentId,
            agentName: session.agentName,
            command: session.command,
            color: session.customColor || agent?.color || "#888",
            createdAt: session.createdAt,
            cwd: session.cwd,
            gitBranch: session.gitBranch,
            status: session.status || "idle",
            customName: session.customName,
            customColor: session.customColor,
            notes: session.notes,
            isRestored: session.isRestored,
            ticketId: session.ticketId,
            ticketTitle: session.ticketTitle,
          });
        });

        hasRestoredRef.current = true;
        return { sessions, savedNodes };
      })
      .catch(console.error);
  }, [agents, addSession, activeCanvasId]);

  return { hasRestoredRef };
}
