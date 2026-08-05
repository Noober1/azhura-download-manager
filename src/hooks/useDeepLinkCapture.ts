import { useEffect, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import type { AddPayload, DownloadItem } from "../types";

/** Listens for the two ways a browser-extension capture (or the Add
 *  window's own submit) reaches `main`. */
export function useDeepLinkCapture(
  downloadsRef: RefObject<DownloadItem[]>,
  addFromPayload: (p: AddPayload) => void,
  patchItem: (id: string, patch: Partial<DownloadItem>) => void,
) {
  // Payloads arrive here only via the Add window's "Download"/"Download
  // Later" buttons (`submit_add`) — a captured download from the extension
  // is routed to the Add window for review first, not straight to this
  // listener (see AddWindow.tsx's `applyCapturedPayload`).
  useEffect(() => {
    const unlisten = listen<AddPayload>("add-download", (e) => addFromPayload(e.payload));
    return () => {
      unlisten.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Every extension capture lands here first, because this window is the only
  // side that knows whether a row is waiting to re-acquire credentials for
  // that URL. Claim it if so; otherwise hand it to the Add window for the
  // normal review flow.
  useEffect(() => {
    const unlisten = listen<AddPayload>("deep-link-captured", (e) => {
      const p = e.payload;
      const url = p.url.trim();
      const waiting = downloadsRef.current.find((d) => d.awaitingCapture && d.url === url);
      if (waiting) {
        patchItem(waiting.id, {
          headers: p.headers,
          allowInsecure: p.allowInsecure,
          awaitingCapture: false,
          state: "queued",
          error: undefined,
        });
        return;
      }
      invoke("reveal_add_window_cmd").catch(() => {});
      emitTo("add", "prefill-add", p).catch(() => {});
    });
    return () => {
      unlisten.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
