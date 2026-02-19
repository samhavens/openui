import { useEffect, useRef } from "react";
import { motion, AnimatePresence, useMotionValue, useTransform, animate, useDragControls } from "framer-motion";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Snap points as fraction of viewport height (0 = top, 1 = bottom). Default [0.5, 0.9] */
  snapPoints?: number[];
  /** Initial snap index */
  initialSnap?: number;
  children: React.ReactNode;
}

export function BottomSheet({ open, onClose, snapPoints = [0.5, 0.92], initialSnap = 0, children }: Props) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragControls = useDragControls();
  const y = useMotionValue(0);
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;

  // Snap point heights from top in px
  const snaps = snapPoints.map(p => vh * (1 - p));

  useEffect(() => {
    if (open) {
      animate(y, snaps[initialSnap], { type: "spring", stiffness: 400, damping: 40 });
    }
  }, [open]);

  const backdropOpacity = useTransform(y, [snaps[0], vh], [0.5, 0]);

  const handleDragEnd = (_: any, info: any) => {
    const currentY = y.get();
    const velocity = info.velocity.y;

    // Dismiss if dragged down fast or past bottom snap
    if (velocity > 500 || currentY > vh * 0.85) {
      onClose();
      return;
    }

    // Find nearest snap
    const nearest = snaps.reduce((prev, curr) =>
      Math.abs(curr - currentY) < Math.abs(prev - currentY) ? curr : prev
    );
    animate(y, nearest, { type: "spring", stiffness: 400, damping: 40 });
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 bg-black z-40"
            style={{ opacity: backdropOpacity }}
            onTap={onClose}
          />

          {/* Sheet */}
          <motion.div
            ref={sheetRef}
            className="fixed left-0 right-0 bottom-0 z-50 bg-[#141414] rounded-t-2xl shadow-2xl flex flex-col"
            style={{ y, top: 0 }}
            drag="y"
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={{ top: snaps[0], bottom: vh }}
            dragElastic={0.1}
            onDragEnd={handleDragEnd}
          >
            {/* Drag handle — only this area initiates the drag, so content scrolls freely */}
            <div
              className="flex-none flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing touch-none"
              onPointerDown={(e) => dragControls.start(e)}
            >
              <div className="w-10 h-1 rounded-full bg-zinc-600" />
            </div>
            {/* flex-1 + pb-safe: evaluated in CSS, reliably clears home indicator */}
            <div className="flex-1 overflow-y-auto min-h-0 pb-safe">
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
