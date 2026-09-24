import { motion } from "motion/react";
import { OVERLAY_FADE, DIALOG_POP } from "../../motion";
import { useDialogA11y } from "../../hooks/useDialogA11y";

type Shortcut = { keys: string[]; label: string };
type Group = { title: string; items: Shortcut[] };

const GROUPS: Group[] = [
  {
    title: "Downloads",
    items: [
      { keys: ["Ctrl", "N"], label: "Add download" },
      { keys: ["Space"], label: "Pause / resume selection" },
      { keys: ["Delete"], label: "Delete selection" },
      { keys: ["F5"], label: "Refresh file status" },
      { keys: ["Ctrl", "C"], label: "Copy link(s)" },
      { keys: ["Alt", "Enter"], label: "Show detail" },
    ],
  },
  {
    title: "Selection",
    items: [
      { keys: ["Ctrl", "A"], label: "Select all" },
      { keys: ["↑", "↓"], label: "Move selection" },
      { keys: ["Shift", "↑", "↓"], label: "Extend selection" },
      { keys: ["Home", "End"], label: "Jump to first / last" },
      { keys: ["Escape"], label: "Clear selection" },
    ],
  },
  {
    title: "Window",
    items: [
      { keys: ["Ctrl", "B"], label: "Toggle sidebar" },
      { keys: ["Ctrl", "F"], label: "Focus search" },
      { keys: ["Ctrl", ","], label: "Settings" },
      { keys: ["Ctrl", "Shift", "X"], label: "Browser extensions" },
      { keys: ["Ctrl", "/"], label: "Keyboard shortcuts" },
      { keys: ["Ctrl", "L"], label: "Lock app (when a PIN is set)" },
      { keys: ["Alt"], label: "Show menu bar" },
    ],
  },
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const panelRef = useDialogA11y<HTMLDivElement>(onClose);

  return (
    <motion.div
      className="overlay"
      onClick={onClose}
      variants={OVERLAY_FADE}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <motion.div
        ref={panelRef}
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        variants={DIALOG_POP}
        initial="initial"
        animate="animate"
        exit="exit"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-dialog-title"
        tabIndex={-1}
      >
        <div className="dialog-head" id="shortcuts-dialog-title">
          Keyboard shortcuts
        </div>
        <div className="dialog-body">
          {GROUPS.map((group) => (
            <div key={group.title} className="shortcut-group">
              <div className="dialog-section-title">{group.title}</div>
              <dl className="shortcut-list">
                {group.items.map((s) => (
                  <div className="shortcut-row" key={s.label}>
                    <dt>{s.label}</dt>
                    <dd>
                      {s.keys.map((k, i) => (
                        <span key={k}>
                          <kbd>{k}</kbd>
                          {i < s.keys.length - 1 ? " + " : ""}
                        </span>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
        <div className="dialog-actions">
          <button className="primary-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default ShortcutsDialog;
