import { useEffect, useRef, useState } from "react";
import { altTapStep } from "../menubar";
import { isEditable } from "../ui";

/** Whether the classic Alt-tap menu bar is revealed, and the Alt-tap
 *  detector that drives it. Owns nothing about which menu is open or
 *  keyboard navigation within it — that's `MenuBar.tsx`'s job; this hook is
 *  only "is the bar up at all".
 *
 *  A tap is Alt going down and coming back up with nothing else in between
 *  (see `altTapStep` in `src/menubar.ts` for the exact state machine).
 *  `armed` lives in a ref, never state — it changes on every keystroke and
 *  must not cause a render of its own. */
export function useMenubar(anyDialogOpen: boolean): {
  visible: boolean;
  hide: () => void;
} {
  const [visible, setVisible] = useState(false);
  const armed = useRef(false);

  useEffect(() => {
    function apply(e: Parameters<typeof altTapStep>[1]) {
      const r = altTapStep(armed.current, e);
      armed.current = r.armed;
      if (r.toggle) setVisible((v) => !v);
    }

    function onKeyDown(e: KeyboardEvent) {
      if (isEditable(e.target)) return;
      if (anyDialogOpen) return;
      if (e.key === "Alt" && !e.repeat) {
        // Defensive: nothing in this app relies on Alt's own default action
        // (there's no native title bar under `decorations: false` for it to
        // affect), but this keeps WebView2 from doing anything native with
        // it. Doesn't touch Alt as a modifier — Alt+Enter still fires on the
        // `Enter` keydown, which this listener never intercepts.
        e.preventDefault();
      }
      apply({ type: "keydown", key: e.key, repeat: e.repeat });
    }
    function onKeyUp(e: KeyboardEvent) {
      if (isEditable(e.target)) return;
      if (anyDialogOpen) return;
      apply({ type: "keyup", key: e.key });
    }
    // A mouse press or the window losing focus (Alt+Tab) must cancel an
    // in-progress tap — otherwise Alt+click, or holding Alt while switching
    // away and back, would leave the machine armed for a keyup that no
    // longer means "tap".
    function onMouseDown() {
      apply({ type: "interrupt" });
    }
    function onBlur() {
      apply({ type: "interrupt" });
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("mousedown", onMouseDown);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("blur", onBlur);
    };
  }, [anyDialogOpen]);

  return { visible, hide: () => setVisible(false) };
}
