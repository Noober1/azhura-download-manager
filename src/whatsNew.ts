export const WHATS_NEW_SEEN_KEY = "adm-whats-new-seen";

export function shouldShowWhatsNew(seen: string | null, current: string): boolean {
  return current !== "" && seen !== current;
}

export function loadSeenVersion(): string | null {
  try {
    return localStorage.getItem(WHATS_NEW_SEEN_KEY);
  } catch {
    return null;
  }
}

export function saveSeenVersion(version: string): void {
  try {
    localStorage.setItem(WHATS_NEW_SEEN_KEY, version);
  } catch {
    // Per-install convenience only — losing it just shows the window again.
  }
}
