import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { UnlockResult } from "../bindings";
import { formatRetry, isValidPin, sanitizePinInput, LOCK_FILE_HINT } from "../lock";
import { WindowControls } from "../ui";

type LockScreenProps =
  | { loading: true }
  | { loading?: false; onUnlock: (pin: string) => Promise<UnlockResult>; initialRetrySecs: number };

/** Full-screen overlay shown whenever the app is locked — rendered inside
 *  `main` (not a separate window) so every download hook stays mounted and
 *  running behind it. `loading` covers the gap before the first
 *  `lock_status` reply arrives, so nothing flashes unlocked for a frame. */
export function LockScreen(props: LockScreenProps) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(props.loading ? 0 : props.initialRetrySecs);
  const [showForgot, setShowForgot] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (retry <= 0) return;
    const t = setInterval(() => setRetry((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [retry]);

  // `autoFocus` fires while the window may still be hidden in the tray — the
  // window becoming visible again (unhiding from the tray, or refocusing
  // after Alt-Tab) is what actually needs to move focus back to the PIN
  // field, since the DOM never lost it in the first place.
  useEffect(() => {
    const unlisten = getCurrentWindow().onFocusChanged(({ payload }) => {
      if (payload) inputRef.current?.focus();
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  if (props.loading) {
    return (
      <div className="lock-screen">
        <div className="lock-top" data-tauri-drag-region>
          <WindowControls variant="full" />
        </div>
      </div>
    );
  }

  const { onUnlock } = props;

  function submit() {
    if (!isValidPin(pin) || busy || retry > 0) return;
    setBusy(true);
    setError(null);
    onUnlock(pin)
      .then((result) => {
        setBusy(false);
        if (result.ok) return;
        setPin("");
        setRetry(result.retryAfterSecs);
        setError(result.retryAfterSecs > 0 ? null : "Wrong PIN");
        inputRef.current?.focus();
      })
      .catch(() => {
        setBusy(false);
        setPin("");
        inputRef.current?.focus();
      });
  }

  return (
    <div
      className="lock-screen"
      onKeyDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => {
        const target = e.target as HTMLElement;
        if (!target.closest("input, button")) {
          e.preventDefault();
          inputRef.current?.focus();
        }
      }}
    >
      <div className="lock-top" data-tauri-drag-region>
        <WindowControls variant="full" />
      </div>
      <div className="lock-center">
        <div className="lock-app-name">Azhura Download Manager</div>
        <div className="lock-prompt">Enter PIN to unlock</div>
        <input
          ref={inputRef}
          className="lock-pin-input"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={8}
          autoFocus
          value={pin}
          disabled={busy}
          onChange={(e) => setPin(sanitizePinInput(e.currentTarget.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
        <button
          className="primary-btn lock-unlock-btn"
          disabled={!isValidPin(pin) || busy || retry > 0}
          onClick={submit}
        >
          Unlock
        </button>
        {retry > 0 ? (
          <div className="lock-error">{formatRetry(retry)}</div>
        ) : (
          error && <div className="lock-error">{error}</div>
        )}
        <button className="lock-forgot" onClick={() => setShowForgot((v) => !v)}>
          Forgot PIN?
        </button>
        {showForgot && (
          <div className="lock-forgot-hint">
            Delete {LOCK_FILE_HINT} and restart the app. Your downloads and settings are kept.
          </div>
        )}
      </div>
    </div>
  );
}

export default LockScreen;
