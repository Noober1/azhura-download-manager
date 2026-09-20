import { useState } from "react";
import { accelFromEvent } from "../hotkey";

/** Click-to-record field for a global-hotkey accelerator string. Focusing it
 *  starts recording: the next keydown becomes the new value (or clears it,
 *  for Backspace/Delete with no modifier), and every other keyboard listener
 *  — including the Settings dialog's own Escape-to-close — is swallowed so
 *  it can't fire on the combo being recorded. */
export function HotkeyInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  return (
    <input
      id={id}
      readOnly
      className="hotkey-input"
      value={recording ? "Press a shortcut…" : value || "Not set"}
      onFocus={() => setRecording(true)}
      onBlur={() => setRecording(false)}
      onKeyDown={(e) => {
        // Swallow everything while recording so app shortcuts (Ctrl+N, Ctrl+F…,
        // all `document` listeners) don't fire on the combo being recorded.
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "Escape") {
          e.currentTarget.blur();
          return;
        }
        if ((e.key === "Backspace" || e.key === "Delete") && !e.ctrlKey && !e.altKey && !e.metaKey) {
          onChange("");
          e.currentTarget.blur();
          return;
        }
        const accel = accelFromEvent(e.nativeEvent);
        if (accel) {
          onChange(accel);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

export default HotkeyInput;
