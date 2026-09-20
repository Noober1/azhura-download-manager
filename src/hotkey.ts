type KeyLike = Pick<KeyboardEvent, "ctrlKey" | "altKey" | "shiftKey" | "metaKey" | "code">;

/** Keyboard event → global-hotkey accelerator ("Ctrl+Alt+D"), or null when
 *  it isn't a usable combo: modifier-only presses, unsupported keys, or no
 *  Ctrl/Alt/Win modifier (a bare or Shift-only key would fire while typing
 *  in every other app). */
export function accelFromEvent(e: KeyLike): string | null {
  let key: string | null = null;
  const m = /^Key([A-Z])$/.exec(e.code) ?? /^Digit(\d)$/.exec(e.code);
  if (m) key = m[1];
  else if (/^F([1-9]|1[0-2])$/.test(e.code)) key = e.code;
  if (!key || !(e.ctrlKey || e.altKey || e.metaKey)) return null;
  const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super"].filter(
    Boolean,
  );
  return [...mods, key].join("+");
}
