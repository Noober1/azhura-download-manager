export const PIN_MIN = 4;
export const PIN_MAX = 8;
export const LOCK_FILE_HINT = "%APPDATA%\\AzhuraDownloadManager\\lock.json";

/** Strips everything but digits and caps the length — used on every
 *  keystroke in the PIN fields so the value passed around is always a clean
 *  numeric string, never something that needs re-validating for stray
 *  characters later. */
export function sanitizePinInput(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, PIN_MAX);
}

export function isValidPin(pin: string): boolean {
  return /^\d{4,8}$/.test(pin);
}

/** Client-side validation shared by the "set"/"change" PIN dialog modes —
 *  Rust re-validates independently, this just avoids a round trip for the
 *  obvious cases. */
export function pinFormError(next: string, confirm: string): string | null {
  if (!isValidPin(next)) return "PIN must be 4–8 digits";
  if (next !== confirm) return "PINs don't match";
  return null;
}

export function formatRetry(secs: number): string {
  if (secs < 60) return `Try again in ${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s > 0 ? `Try again in ${m}m ${s}s` : `Try again in ${m}m`;
}
