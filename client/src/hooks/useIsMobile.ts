import { useEffect } from "react";
import { useStore } from "../stores/useStore";

/**
 * Detects mobile viewport via matchMedia and keeps the store in sync.
 * Respects forceDesktop override from localStorage.
 * Mount this once at the app root.
 */
export function useIsMobile() {
  const { setIsMobile, forceDesktop } = useStore();

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");

    const update = (matches: boolean) => {
      setIsMobile(matches && !forceDesktop);
    };

    update(mq.matches);

    const handler = (e: MediaQueryListEvent) => update(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [forceDesktop, setIsMobile]);
}
