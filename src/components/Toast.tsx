import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { useToasts, dismissToast } from "../toast";
import { TOAST_POP, LAYOUT_SPRING } from "../motion";

/* Renders queued toasts via a portal to `document.body` so it can be mounted
   once per early-return branch in `DetailWindow.tsx` without worrying about
   layout context. `role="status"`/`aria-live="polite"` announces new toasts
   to screen readers — they were previously silent. `layout` on each toast
   lets the remaining ones slide into the gap left by a dismissed one instead
   of jumping. */
export function ToastHost() {
  const toasts = useToasts();
  return createPortal(
    <div className="toast-stack" role="status" aria-live="polite" aria-atomic="false">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            className={`toast toast-${t.level}`}
            layout
            transition={{ layout: LAYOUT_SPRING }}
            variants={TOAST_POP}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            <span>{t.message}</span>
            <button className="toast-close" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
              ×
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>,
    document.body,
  );
}

export default ToastHost;
