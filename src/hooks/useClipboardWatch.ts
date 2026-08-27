import { useEffect, useRef, type RefObject } from "react";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { commands } from "../bindings";
import type { AddPayload, DownloadItem } from "../types";
import { DEFAULT_PROXY } from "../types";
import { looksLikeUrl, truncate } from "../format";
import { showToast } from "../toast";
import { notify } from "../notify";

const POLL_MS = 1200;
/** Long enough to recognize the link, short enough that the toast doesn't
 *  wrap the whole stack — `.toast-stack` is only 320px wide. */
const URL_DISPLAY_CHARS = 60;

/** IDM-style clipboard monitoring: while enabled, offers a copied http(s) link
 *  as a download instead of making the user open the Add window and paste.
 *  Opt-in (see `clipboardWatch` in settings) because a watcher that reacts to
 *  every copy is intrusive for people who don't want it. */
export function useClipboardWatch(
  enabled: boolean,
  downloadsRef: RefObject<DownloadItem[]>,
) {
  // The last clipboard value this hook has already judged — offered, or
  // rejected by one of the filters below. A ref rather than state because
  // every read and write happens inside the interval callback, and a
  // re-render per clipboard poll would be pure waste.
  const lastSeenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    // `tick` awaits twice, so a slow clipboard could otherwise let two ticks
    // overlap and both judge the same value before either records it.
    let busy = false;

    async function read(): Promise<string | null> {
      try {
        return (await readText()).trim();
      } catch {
        // An empty or otherwise inaccessible clipboard throws rather than
        // returning "" — same swallow as `useAddForm`'s prefill read.
        return null;
      }
    }

    function offer(candidate: string) {
      const payload: AddPayload = {
        url: candidate,
        allowInsecure: false,
        headers: [],
        connections: 0,
        checksum: "",
        speedLimit: 0,
        later: false,
        filename: "",
        savePath: "",
        proxy: DEFAULT_PROXY,
      };
      // `revealAddWindowCmd`, not `openAddWindow`: the latter emits
      // "window-opened", which makes the Add window re-read the clipboard —
      // by now it may hold something else entirely, and the toast would have
      // named a link it then didn't open.
      commands.revealAddWindowCmd().catch(() => {});
      emitTo("add", "prefill-add", payload).catch(() => {});
    }

    async function tick() {
      if (busy) return;
      busy = true;
      try {
        await judge();
      } finally {
        busy = false;
      }
    }

    async function judge() {
      const candidate = await read();
      if (cancelled || candidate === null) return;
      if (candidate === lastSeenRef.current) return;
      // Recorded before the filters below, so a rejected value is judged once
      // rather than on every tick for as long as it sits in the clipboard.
      lastSeenRef.current = candidate;

      if (!candidate) return;
      // The URL parser strips ASCII tab/newline from its input, so a
      // newline-joined multi-row "Copy link" would parse as one valid URL and
      // be offered as a nonsense concatenation.
      if (/\s/.test(candidate)) return;
      if (!looksLikeUrl(candidate)) return;
      // Whatever the app itself just copied off a row is already downloaded.
      if (downloadsRef.current.some((d) => d.url === candidate)) return;

      const shown = truncate(candidate, URL_DISPLAY_CHARS);
      const visible = await getCurrentWindow()
        .isVisible()
        .catch(() => true);
      if (cancelled) return;
      if (!visible) {
        // Hidden in the tray — which is where clipboard monitoring earns its
        // keep, and where an in-app toast would render into a window nobody
        // can see or click. The desktop notification is still actionable:
        // opening the Add window with "+" re-reads the clipboard, so the link
        // is already waiting in the field.
        notify("Link copied", `Open Azhura to download ${shown}`);
        return;
      }
      showToast(`Download this link? ${shown}`, "info", {
        label: "Download",
        onClick: () => offer(candidate),
      });
    }

    // Seeded without offering: turning the setting on shouldn't fire on
    // whatever happened to be in the clipboard beforehand.
    let timer: ReturnType<typeof setInterval> | undefined;
    read().then((initial) => {
      if (cancelled) return;
      lastSeenRef.current = initial;
      timer = setInterval(tick, POLL_MS);
    });

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}
