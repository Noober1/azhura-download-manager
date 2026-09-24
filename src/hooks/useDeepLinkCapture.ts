import { useEffect, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { commands } from "../bindings";
import { showToast } from "../toast";
import type { AddPayload, DownloadItem } from "../types";

/** Listens for the three ways a browser-extension capture (or the Add
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
  // that URL. Claim it if so; if an auto rule already matched (Rust stamps
  // `savePath`/`autoRule` onto the payload — see `auto_rules.rs`), queue it
  // straight away; otherwise hand it to the Add window for the normal review
  // flow.
  function routeCapture(p: AddPayload) {
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
    if (p.autoRule && p.savePath) {
      addFromPayload(p);
      showToast(`Auto rule "${p.autoRule}" → ${p.savePath}`, "info");
      return;
    }
    commands.revealAddWindowCmd().catch(() => {});
    emitTo("add", "prefill-add", p).catch(() => {});
  }

  useEffect(() => {
    const unlisten = listen<AddPayload>("deep-link-captured", (e) => routeCapture(e.payload));
    return () => {
      unlisten.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cold start: an auto rule already matched a link seen before this window
  // had mounted (see `handle_deep_link_cold_start`), so Rust stashed it
  // instead of the Add window's own `PendingDeepLink` — collect it now and
  // route it the same way a warm-start match would be.
  useEffect(() => {
    // Plain invoke(): Value-shaped command — see take_pending_deep_link.
    invoke<AddPayload | null>("take_pending_auto_add")
      .then((p) => {
        if (p) routeCapture(p);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
