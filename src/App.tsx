import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type {
  AddPayload,
  AppSettings,
  DownloadEvent,
  DownloadItem,
  HistoryEntry,
  HistoryLoad,
  ResumableInfo,
  Category,
  TrayDownload,
  DetailAction,
} from "./types";
import {
  isInsecureHttp,
  formatBytes,
  formatSpeed,
  fallbackName,
  pctOf,
  truncate,
  statusClass,
  statusLabel,
} from "./format";
import { Icon, WindowControls, useSuppressContextMenu } from "./ui";
import "./App.css";

const TERMINAL_STATES = ["completed", "error", "canceled"] as const;
/** Sent by the browser extension; re-captured on demand rather than stored. */
const CREDENTIAL_HEADERS = ["cookie", "authorization", "proxy-authorization"];

function toHistoryEntry(d: DownloadItem): HistoryEntry {
  const headers = d.headers.filter(([k]) => !CREDENTIAL_HEADERS.includes(k.toLowerCase()));
  return {
    id: d.id,
    url: d.url,
    headers,
    allowInsecure: d.allowInsecure,
    checksum: d.checksum,
    speedLimit: d.speedLimit,
    filename: d.filename,
    filenameOverride: d.filenameOverride,
    path: d.path,
    savePath: d.savePath,
    total: d.total,
    downloaded: d.downloaded,
    connections: d.connections,
    usedConnections: d.usedConnections,
    state: d.state,
    error: d.error ?? null,
    referer: d.referer ?? headers.find(([k]) => k.toLowerCase() === "referer")?.[1] ?? "",
    // Dropping a credential header means a redownload can't just replay this
    // request — it has to wait for the extension to capture a fresh one.
    needsAuth: d.needsAuth || headers.length !== d.headers.length,
    finishedAt: d.finishedAt ?? 0,
  };
}

function fromHistoryEntry(e: HistoryEntry): DownloadItem {
  return {
    id: e.id,
    url: e.url,
    headers: e.headers,
    connections: e.connections,
    allowInsecure: e.allowInsecure,
    checksum: e.checksum,
    speedLimit: e.speedLimit,
    filename: e.filename,
    filenameOverride: e.filenameOverride,
    path: e.path,
    savePath: e.savePath,
    total: e.total,
    downloaded: e.downloaded,
    speed: 0,
    usedConnections: e.usedConnections,
    numPieces: 0,
    pieceSize: 0,
    conns: [],
    state: e.state,
    error: e.error ?? undefined,
    missing: e.missing,
    fromHistory: true,
    referer: e.referer,
    needsAuth: e.needsAuth,
    finishedAt: e.finishedAt,
  };
}

function App() {
  const [maxConcurrent, setMaxConcurrent] = useState(3);
  const [globalLimitMbps, setGlobalLimitMbps] = useState(0);
  const [minimizeToTray, setMinimizeToTray] = useState(false);
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);

  const [category, setCategory] = useState<Category>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const anchorRef = useRef<string | null>(null); // shift-range anchor
  const [showSettings, setShowSettings] = useState(false);
  const [showExtensions, setShowExtensions] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DownloadItem[] | null>(null);
  const [deleteWithFile, setDeleteWithFile] = useState(false);
  // Id of the download shown in the "Download Details" popup, or null when
  // it's closed. Main keeps pushing snapshots to it as long as this is set.
  const [detailId, setDetailId] = useState<string | null>(null);

  // Stays false until the history file has been read, so the save effect can't
  // fire against the empty initial state and wipe the file before the load
  // lands. Refs (not state) because they must survive StrictMode's remount.
  const historyReadyRef = useRef(false);
  const lastSavedHistoryRef = useRef<string | null>(null);
  const downloadsRef = useRef<DownloadItem[]>([]);
  downloadsRef.current = downloads;
  const lastTraySentRef = useRef<string | null>(null);
  // Guards against piling up pushes if one command outlives the 1s interval.
  const traySendingRef = useRef(false);

  useSuppressContextMenu();

  // Restore persisted settings (scheduler knobs + tray behavior) from a
  // previous session; they otherwise reset to defaults every launch.
  useEffect(() => {
    invoke<AppSettings>("load_settings")
      .then((s) => {
        setMaxConcurrent(s.maxConcurrent);
        setGlobalLimitMbps(s.globalLimitMbps);
        setMinimizeToTray(s.minimizeToTray);
        if (s.globalLimitMbps > 0) {
          invoke("set_global_speed_limit", {
            bytesPerSec: Math.round(s.globalLimitMbps * 1024 * 1024),
          });
        }
      })
      .catch(() => {});
  }, []);

  // Restore a previous session: unfinished downloads from their resume
  // sidecars, plus finished ones from the persisted history. Loaded together
  // so the merge happens in a single state update — a row whose sidecar is
  // still live must win over its history copy, since only the sidecar can
  // actually be resumed.
  useEffect(() => {
    Promise.all([
      invoke<HistoryLoad>("load_history"),
      invoke<ResumableInfo[]>("list_resumable"),
    ])
      .then(([history, items]) => {
        const resumable: DownloadItem[] = items.map((it) => ({
          id: crypto.randomUUID(),
          url: it.url,
          headers: [],
          connections: it.connections,
          allowInsecure: isInsecureHttp(it.url),
          checksum: "",
          speedLimit: 0,
          filename: it.filename,
          filenameOverride: "",
          path: it.path,
          savePath: it.savePath ?? "",
          total: it.total,
          downloaded: it.downloaded,
          speed: 0,
          usedConnections: it.connections,
          numPieces: 0,
          pieceSize: 0,
          conns: [],
          state: "paused",
        }));

        const livePaths = new Set(resumable.map((r) => r.path));
        const restoredHistory: DownloadItem[] = history.entries
          .filter((e) => !e.path || !livePaths.has(e.path))
          .map(fromHistoryEntry);

        setDownloads((prev) => {
          // Rows can be added while these promises are in flight (a cold-start
          // deep link the user confirms quickly), so merge into `prev` rather
          // than replacing it.
          const knownPaths = new Set(prev.map((d) => d.path).filter(Boolean));
          const knownIds = new Set(prev.map((d) => d.id));
          return [
            // Resumable ids are regenerated every launch, so they can only be
            // deduped by path; history ids are stable and its path may be "".
            ...resumable.filter((r) => !knownPaths.has(r.path)),
            ...restoredHistory.filter(
              (h) => !knownIds.has(h.id) && (!h.path || !knownPaths.has(h.path)),
            ),
            ...prev,
          ];
        });

        // Seed the dirty check with what's already on disk, using the same
        // mapper the save effect uses so field-shape differences can't look
        // like a change. A file we couldn't parse leaves the gate shut, so a
        // read failure never cascades into overwriting the survivors.
        lastSavedHistoryRef.current = JSON.stringify(restoredHistory.map(toHistoryEntry));
        historyReadyRef.current = history.readable;
      })
      .catch(() => {});
  }, []);

  // Scheduler: keep at most `maxConcurrent` downloads active.
  useEffect(() => {
    const active = downloads.filter(
      (d) => d.state === "downloading" || d.state === "verifying",
    ).length;
    const slots = maxConcurrent - active;
    if (slots <= 0) return;
    downloads
      .filter((d) => d.state === "queued")
      .slice(0, slots)
      .forEach((item) => startRun(item));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [downloads, maxConcurrent]);

  function historyPayload(items: DownloadItem[]) {
    return items
      .filter((d) => (TERMINAL_STATES as readonly string[]).includes(d.state))
      .map(toHistoryEntry);
  }

  // Persist finished downloads. Debounced because `downloads` churns ~7x/sec
  // per active download from progress events; the debounce also collapses
  // bursts of terminal transitions into one write, so two saves can't be
  // in flight at once and land out of order.
  useEffect(() => {
    if (!historyReadyRef.current) return;
    const entries = historyPayload(downloads);
    const json = JSON.stringify(entries);
    if (json === lastSavedHistoryRef.current) return;
    const t = setTimeout(() => {
      lastSavedHistoryRef.current = json;
      invoke("save_history", { entries }).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [downloads]);

  // The tray's Quit gives the app a short grace period before exiting, which
  // the debounce above would otherwise swallow — flush immediately instead.
  useEffect(() => {
    const un = listen("app-quitting", () => {
      if (!historyReadyRef.current) return;
      const entries = historyPayload(downloadsRef.current);
      lastSavedHistoryRef.current = JSON.stringify(entries);
      invoke("save_history", { entries }).catch(() => {});
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  function patchItem(id: string, patch: Partial<DownloadItem>) {
    setDownloads((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  function handleEvent(id: string, msg: DownloadEvent) {
    switch (msg.event) {
      case "started":
        patchItem(id, {
          filename: msg.data.filename,
          path: msg.data.path,
          total: msg.data.total,
          usedConnections: msg.data.connections,
          numPieces: msg.data.numPieces,
          pieceSize: msg.data.pieceSize,
          state: "downloading",
        });
        break;
      case "progress": {
        const patch: Partial<DownloadItem> = {
          downloaded: msg.data.downloaded,
          total: msg.data.total,
          speed: msg.data.speedBps,
        };
        if (msg.data.connections.length > 0) patch.conns = msg.data.connections;
        patchItem(id, patch);
        break;
      }
      case "paused":
        patchItem(id, { state: "paused", speed: 0 });
        break;
      case "canceled":
        patchItem(id, { state: "canceled", speed: 0, finishedAt: Date.now() });
        break;
      case "verifying":
        patchItem(id, { state: "verifying", speed: 0 });
        break;
      case "finished":
        patchItem(id, {
          state: "completed",
          speed: 0,
          path: msg.data.path,
          filename: msg.data.filename,
          missing: false,
          fromHistory: false,
          finishedAt: Date.now(),
        });
        break;
      case "error":
        patchItem(id, {
          state: "error",
          error: msg.data.message,
          speed: 0,
          finishedAt: Date.now(),
        });
        break;
    }
  }

  async function startRun(item: DownloadItem) {
    const resume = item.usedConnections > 1 && !!item.path;
    patchItem(item.id, { state: "downloading", error: undefined, startedAt: Date.now() });

    const onEvent = new Channel<DownloadEvent>();
    onEvent.onmessage = (msg) => handleEvent(item.id, msg);

    try {
      await invoke("start_download", {
        id: item.id,
        url: item.url,
        allowInsecure: item.allowInsecure,
        headers: item.headers,
        connections: item.connections,
        resume,
        resumePath: resume ? item.path : null,
        expectedChecksum: item.checksum || null,
        speedLimit: item.speedLimit > 0 ? item.speedLimit : null,
        filename: !resume && item.filenameOverride ? item.filenameOverride : null,
        savePath: item.savePath || null,
        onEvent,
      });
    } catch (e) {
      patchItem(item.id, { state: "error", error: String(e) });
    }
  }

  // Payloads arrive from the separate "Add Download" window via a Tauri event.
  function addFromPayload(p: AddPayload) {
    const u = p.url.trim();
    if (!u) return;
    const id = crypto.randomUUID();
    const item: DownloadItem = {
      id,
      url: u,
      headers: p.headers,
      connections: p.connections,
      allowInsecure: p.allowInsecure,
      checksum: p.checksum.trim(),
      speedLimit: p.speedLimit > 0 ? p.speedLimit : 0,
      // Cosmetic only, until the "started" event reports the real name the
      // backend chose — must NOT be sent to start_download as if it were a
      // user override (see filenameOverride).
      filename: p.filename.trim() || fallbackName(u),
      filenameOverride: p.filename.trim(),
      path: "",
      savePath: p.savePath.trim(),
      total: null,
      downloaded: 0,
      speed: 0,
      usedConnections: 1,
      numPieces: 0,
      pieceSize: 0,
      conns: [],
      state: p.later ? "paused" : "queued",
    };
    setDownloads((ds) => [item, ...ds]);
    anchorRef.current = id;
    setSelectedIds(new Set([id]));
  }

  // Payloads arrive here only via the Add window's "Download"/"Download
  // Later" buttons (`submit_add`) — a captured download from the extension
  // is routed to the Add window for review first, not straight to this
  // listener (see AddWindow.tsx's `applyCapturedPayload`).
  useEffect(() => {
    const unlisten = listen<AddPayload>("add-download", (e) => addFromPayload(e.payload));
    return () => {
      unlisten.then((f) => f());
    };
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
  }, []);

  async function revealExtension(flavor: "chrome" | "firefox") {
    try {
      const dir = await invoke<string>("extension_dir", { flavor });
      const sep = dir.includes("\\") ? "\\" : "/";
      await revealItemInDir(`${dir.replace(/[\\/]+$/, "")}${sep}manifest.json`);
      if (flavor === "chrome") {
        // Windows only resolves registered protocols via plain openUrl(); "chrome://"
        // isn't one (only Chrome itself understands it), so it has to be launched
        // directly with the URL as an argument instead. There's no equivalent for
        // Gecko: the browser could be Firefox, Zen, LibreWolf… under any exe name,
        // so that side just gets the address to paste.
        await openUrl("chrome://extensions", "chrome.exe");
      }
    } catch (e) {
      console.error(e);
    }
  }

  function pauseMany(items: DownloadItem[]) {
    items.forEach((i) => invoke("pause_download", { id: i.id }));
  }
  function cancelMany(items: DownloadItem[]) {
    items.forEach((i) => invoke("cancel_download", { id: i.id }));
  }
  function resumeMany(items: DownloadItem[]) {
    const ids = new Set(items.map((i) => i.id));
    setDownloads((ds) =>
      ds.map((d) => {
        if (!ids.has(d.id)) return d;
        const base = { ...d, state: "queued" as const, error: undefined };
        // A genuine paused row still has its resume sidecar — leave `path`
        // alone so it continues where it left off.
        if (!d.missing && !d.fromHistory && !d.awaitingCapture) return base;
        // Rows from history never have a live sidecar (if one existed,
        // list_resumable would have produced the row and won the merge), so
        // resuming them has to start over. Clearing `path` is what makes
        // startRun compute resume === false.
        const restart = {
          ...base,
          path: "",
          downloaded: 0,
          total: null,
          missing: false,
          fromHistory: false,
          awaitingCapture: false,
          conns: [],
          numPieces: 0,
          usedConnections: d.connections,
        };
        // Credentials were stripped before persisting, so replaying this
        // request would just 401/403. Park it until the extension captures a
        // fresh one — `awaitingCapture` keeps it out of the scheduler, and
        // resuming again simply reopens the page to retry.
        if (d.needsAuth && d.referer) {
          openUrl(d.referer).catch(() => {});
          return { ...restart, state: "paused" as const, awaitingCapture: true };
        }
        return restart;
      }),
    );
  }
  async function removeMany(items: DownloadItem[], deleteFile: boolean) {
    await Promise.allSettled(
      items
        .filter((i) => i.path)
        .map((i) => {
          // For anything short of "completed", `path` points at the temp
          // file, not a real file the user asked to keep — without its
          // resume metadata (always dropped on delete) it can never be
          // resumed again, so leaving it behind would just be orphaned
          // disk space. Only a completed download's checkbox choice matters.
          // A missing row is the exception: nothing of ours is at `path` any
          // more, so deleting it could only hit a file that later took over
          // that name.
          const removeFile = i.missing ? false : i.state === "completed" ? deleteFile : true;
          return invoke("delete_download", { path: i.path, deleteFile: removeFile }).catch(() => {
            /* ignore */
          });
        }),
    );
    const ids = new Set(items.map((i) => i.id));
    setDownloads((ds) => ds.filter((d) => !ids.has(d.id)));
    setSelectedIds((prev) => new Set([...prev].filter((id) => !ids.has(id))));
  }
  // Single seam every delete entry point (toolbar, context menu, Delete key)
  // routes through. `items` is the full candidate selection — the dialog
  // splits out any running downloads itself so it can explain why they're
  // excluded, and defaults "Delete source file also" to off.
  function requestDelete(items: DownloadItem[]) {
    const deletable = items.filter((d) => d.state !== "downloading" && d.state !== "verifying");
    if (deletable.length === 0) return;
    setDeleteWithFile(false);
    setPendingDelete(items);
  }
  function confirmDelete() {
    if (!pendingDelete) return;
    const deletable = pendingDelete.filter(
      (d) => d.state !== "downloading" && d.state !== "verifying",
    );
    removeMany(deletable, deleteWithFile);
    setPendingDelete(null);
  }

  // Opens the "Download Details" popup targeted at `id` — a double-click, a
  // context-menu action, or the tray's per-download menu item all funnel
  // through here.
  //
  // The snapshot is pushed *before* the window is revealed, and awaited: the
  // popup's webview is reused rather than recreated, so it still holds the
  // previously viewed download. Letting the effect below deliver the new one
  // would race the `open_detail_window` round-trip and flash the old row's
  // name and progress bars first.
  async function openDetail(id: string) {
    setDetailId(id);
    const item = downloadsRef.current.find((d) => d.id === id) ?? null;
    await emitTo("detail", "detail-data", item).catch(() => {});
    invoke("open_detail_window").catch(() => {});
  }

  // Keeps the (possibly hidden) detail window's snapshot in sync with the
  // targeted row. A `null` payload tells it the row was removed.
  useEffect(() => {
    if (!detailId) return;
    const item = downloads.find((d) => d.id === detailId) ?? null;
    emitTo("detail", "detail-data", item).catch(() => {});
  }, [downloads, detailId]);

  useEffect(() => {
    const unlisten = listen("detail-closed", () => setDetailId(null));
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  // Clicking a download entry in the tray's menu restores main and opens
  // detail for that row. The "…and N more" sentinel has no real download
  // behind it, so it's ignored here — the tray click handler already
  // restored the window.
  useEffect(() => {
    const unlisten = listen<string>("tray-open-detail", (e) => {
      if (e.payload === "more") return;
      openDetail(e.payload);
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  // Action buttons in the detail popup emit here rather than calling
  // pause/cancel/resume commands directly, since main owns all download state.
  useEffect(() => {
    const unlisten = listen<DetailAction>("detail-action", (e) => {
      const item = downloadsRef.current.find((d) => d.id === e.payload.id);
      if (!item) return;
      if (e.payload.action === "pause") pauseMany([item]);
      else if (e.payload.action === "cancel") cancelMany([item]);
      else if (e.payload.action === "resume") resumeMany([item]);
    });
    return () => {
      unlisten.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pushes a live download list into the tray's dropdown roughly once a
  // second — far coarser than the ~7/sec progress patches, and skipped
  // entirely when nothing actually changed since the last push.
  useEffect(() => {
    const t = setInterval(() => {
      const active = downloadsRef.current.filter(
        (d) => d.state === "downloading" || d.state === "verifying",
      );
      const shown = active.slice(0, 10);
      const items: TrayDownload[] = shown.map((d) => {
        const pct = pctOf(d);
        const pctLabel = pct !== null ? `${pct.toFixed(0)}%` : "—";
        const speedLabel = d.state === "downloading" ? formatSpeed(d.speed) : "verifying";
        return { id: d.id, label: `${truncate(d.filename, 38)} · ${pctLabel} · ${speedLabel}` };
      });
      if (active.length > shown.length) {
        items.push({ id: "more", label: `…and ${active.length - shown.length} more` });
      }
      const totalActiveSpeed = active
        .filter((d) => d.state === "downloading")
        .reduce((s, d) => s + d.speed, 0);
      const tooltip = active.length
        ? `Azhura Download Manager — ${active.length} active · ${formatSpeed(totalActiveSpeed)}`
        : "Azhura Download Manager";

      // Only record the payload as delivered once the command actually
      // succeeded. Marking it up front would strand a failed push whenever
      // the payload is stable — notably the idle `{items: [], …}` one, which
      // never changes again, leaving the tray listing finished downloads.
      const payload = JSON.stringify({ items, tooltip });
      if (payload === lastTraySentRef.current || traySendingRef.current) return;
      traySendingRef.current = true;
      invoke("update_tray_downloads", { items, tooltip })
        .then(() => {
          lastTraySentRef.current = payload;
        })
        .catch(() => {
          /* leave the ref alone so the next tick retries */
        })
        .finally(() => {
          traySendingRef.current = false;
        });
    }, 1000);
    return () => clearInterval(t);
  }, []);

  function handleRowContext(e: ReactMouseEvent, item: DownloadItem) {
    if (!selectedIds.has(item.id)) {
      anchorRef.current = item.id;
      setSelectedIds(new Set([item.id]));
    }
    setMenu({ x: e.clientX, y: e.clientY });
  }

  function persistSettings(overrides: Partial<AppSettings> = {}) {
    invoke("save_settings", {
      settings: {
        maxConcurrent,
        globalLimitMbps,
        minimizeToTray,
        ...overrides,
      } as AppSettings,
    });
  }

  function setMaxActive(n: number) {
    const v = Math.min(10, Math.max(1, Math.round(n)));
    setMaxConcurrent(v);
    persistSettings({ maxConcurrent: v });
  }

  function setGlobalLimit(mbps: number) {
    const v = Math.max(0, mbps || 0);
    setGlobalLimitMbps(v);
    invoke("set_global_speed_limit", { bytesPerSec: Math.round(v * 1024 * 1024) });
    persistSettings({ globalLimitMbps: v });
  }

  function setMinimizeToTraySetting(v: boolean) {
    setMinimizeToTray(v);
    persistSettings({ minimizeToTray: v });
  }

  // Derived
  const activeItems = downloads.filter((d) =>
    ["downloading", "verifying", "queued", "paused"].includes(d.state),
  );
  const finishedItems = downloads.filter((d) =>
    ["completed", "error", "canceled"].includes(d.state),
  );
  const shown =
    category === "active" ? activeItems : category === "finished" ? finishedItems : downloads;

  const totalSpeed = downloads
    .filter((d) => d.state === "downloading")
    .reduce((s, d) => s + d.speed, 0);
  const activeCount = downloads.filter(
    (d) => d.state === "downloading" || d.state === "verifying",
  ).length;
  const queuedCount = downloads.filter((d) => d.state === "queued").length;

  const selectedItems = downloads.filter((d) => selectedIds.has(d.id));
  // `missing` and `fromHistory` have to be in the union explicitly: a
  // completed-but-missing row matches none of the three states below, and
  // without it the redownload path would be unreachable.
  const resumableSel = selectedItems.filter(
    (d) =>
      d.missing ||
      d.fromHistory ||
      d.awaitingCapture ||
      ["paused", "error", "canceled"].includes(d.state),
  );
  const pausableSel = selectedItems.filter((d) => d.state === "downloading");
  const cancelableSel = pausableSel;
  const deletableSel = selectedItems.filter(
    (d) => d.state !== "downloading" && d.state !== "verifying",
  );
  const singleSelected = selectedItems.length === 1 ? selectedItems[0] : null;
  const canReveal =
    !!singleSelected &&
    singleSelected.state === "completed" &&
    !!singleSelected.path &&
    !singleSelected.missing;

  function selectRow(id: string, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) {
    if (e.shiftKey && anchorRef.current) {
      const ids = shown.map((d) => d.id);
      const a = ids.indexOf(anchorRef.current);
      const b = ids.indexOf(id);
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSelectedIds(new Set(ids.slice(lo, hi + 1)));
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      anchorRef.current = id;
      return;
    }
    setSelectedIds(new Set([id]));
    anchorRef.current = id;
  }

  // Keyboard shortcuts for the selection: Ctrl/Cmd+A selects everything shown,
  // Escape clears, Delete opens the confirmation dialog for the current selection.
  useEffect(() => {
    function isEditable(t: EventTarget | null) {
      const el = t as HTMLElement | null;
      return !!el?.closest('input, textarea, [contenteditable="true"]');
    }
    function onKeyDown(e: KeyboardEvent) {
      if (isEditable(e.target)) return;
      // A modal dialog or the context menu owns keyboard input while open —
      // their own handlers deal with Escape.
      if (pendingDelete || showSettings || showExtensions || menu) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelectedIds(new Set(shown.map((d) => d.id)));
      } else if (e.key === "Escape") {
        setSelectedIds(new Set());
      } else if (e.key === "Delete") {
        requestDelete(selectedItems);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, selectedItems, pendingDelete, showSettings, showExtensions, menu]);

  return (
    <div className="app">
      {/* ---- Top toolbar ---- */}
      <div className="topbar" data-tauri-drag-region>
        <button
          className="tbtn primary"
          title="Add download"
          onClick={() => invoke("open_add_window")}
        >
          <Icon name="add" />
        </button>
        <span className="tsep" />
        <button
          className="tbtn"
          title={`Resume${resumableSel.length > 1 ? ` (${resumableSel.length})` : ""}`}
          disabled={resumableSel.length === 0}
          onClick={() => resumeMany(resumableSel)}
        >
          <Icon name="resume" />
        </button>
        <button
          className="tbtn"
          title={`Pause${pausableSel.length > 1 ? ` (${pausableSel.length})` : ""}`}
          disabled={pausableSel.length === 0}
          onClick={() => pauseMany(pausableSel)}
        >
          <Icon name="pause" />
        </button>
        <button
          className="tbtn"
          title={`Cancel${cancelableSel.length > 1 ? ` (${cancelableSel.length})` : ""}`}
          disabled={cancelableSel.length === 0}
          onClick={() => cancelMany(cancelableSel)}
        >
          <Icon name="cancel" />
        </button>
        <button
          className="tbtn danger"
          title={`Delete${deletableSel.length > 1 ? ` (${deletableSel.length})` : ""}`}
          disabled={deletableSel.length === 0}
          onClick={() => requestDelete(selectedItems)}
        >
          <Icon name="trash" />
        </button>
        <span className="tsep" />
        <button className="tbtn" title="Settings" onClick={() => setShowSettings(true)}>
          <Icon name="settings" />
        </button>

        <div className="topbar-status">
          <span className="ts-speed">{formatSpeed(totalSpeed)}</span>
          <span className="ts-counts">
            {activeCount} active · {queuedCount} queued
            {selectedIds.size > 1 ? ` · ${selectedIds.size} selected` : ""}
          </span>
        </div>
        <button
          className="tbtn"
          title="Install browser extension"
          onClick={() => setShowExtensions(true)}
        >
          <Icon name="puzzle" />
        </button>
        <WindowControls variant="full" />
      </div>

      {/* ---- Body: sidebar + table ---- */}
      <div className="body">
        <aside className="sidebar">
          <div className="side-title">Category</div>
          <button
            className={`cat ${category === "all" ? "active" : ""}`}
            onClick={() => setCategory("all")}
          >
            All Downloads <span className="cat-n">{downloads.length}</span>
          </button>
          <button
            className={`cat ${category === "active" ? "active" : ""}`}
            onClick={() => setCategory("active")}
          >
            Active <span className="cat-n">{activeItems.length}</span>
          </button>
          <button
            className={`cat ${category === "finished" ? "active" : ""}`}
            onClick={() => setCategory("finished")}
          >
            Finished <span className="cat-n">{finishedItems.length}</span>
          </button>
        </aside>

        <main
          className="table-wrap"
          onClick={(e) => {
            const t = e.target as HTMLElement;
            if (!t.closest(".drow")) setSelectedIds(new Set());
          }}
        >
          <table className="dtable">
            <thead>
              <tr>
                <th className="col-name">Name</th>
                <th className="col-status">Status</th>
                <th className="col-num">Size</th>
                <th className="col-num">Downloaded</th>
                <th className="col-pct">Percentage</th>
                <th className="col-num col-speed">Speed</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty-cell">
                    No downloads here — click <strong>+</strong> to add one.
                  </td>
                </tr>
              )}
              {shown.map((item) => {
                const pct = pctOf(item);
                const selectedRow = selectedIds.has(item.id);
                return (
                  <Row
                    key={item.id}
                    item={item}
                    pct={pct}
                    selected={selectedRow}
                    onSelect={(e) => selectRow(item.id, e)}
                    onContext={(e) => handleRowContext(e, item)}
                    onOpenDetail={() => openDetail(item.id)}
                  />
                );
              })}
            </tbody>
          </table>
        </main>
      </div>

      {/* ---- Settings dialog ---- */}
      {showSettings && (
        <div className="overlay" onClick={() => setShowSettings(false)}>
          <div className="dialog dialog-sm" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-head">Settings</div>
            <div className="dialog-body">
              <div className="field-row">
                <label htmlFor="maxc">Max active downloads</label>
                <input
                  id="maxc"
                  type="number"
                  min={1}
                  max={10}
                  value={maxConcurrent}
                  onChange={(e) => {
                    const n = Number(e.currentTarget.value);
                    if (Number.isFinite(n)) setMaxActive(n);
                  }}
                />
              </div>
              <div className="field-row">
                <label htmlFor="glim">Global speed limit</label>
                <input
                  id="glim"
                  type="number"
                  min={0}
                  step={0.5}
                  value={globalLimitMbps}
                  onChange={(e) => setGlobalLimit(Number(e.currentTarget.value))}
                />
                <span className="field-unit">MB/s · 0 = unlimited (live)</span>
              </div>
              <div className="check-row">
                <input
                  type="checkbox"
                  id="min-tray"
                  checked={minimizeToTray}
                  onChange={(e) => setMinimizeToTraySetting(e.currentTarget.checked)}
                />
                <label htmlFor="min-tray">Minimize to tray</label>
              </div>
            </div>
            <div className="dialog-actions">
              <button className="primary-btn" onClick={() => setShowSettings(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Browser extension dialog ---- */}
      {showExtensions && (
        <div className="overlay" onClick={() => setShowExtensions(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-head">Browser extension</div>
            <div className="dialog-body">
              <p className="detail-note">
                Adds “Download with ADM” to your browser’s right-click menu. Pick the build
                that matches your browser — they ship as separate folders.
              </p>

              <div className="ext-row">
                <div>
                  <div className="ext-name">Chrome, Edge, Brave, Opera</div>
                  <div className="ext-hint">
                    Opens <code>chrome://extensions</code> — turn on Developer mode, then
                    “Load unpacked” and pick the revealed folder.
                  </div>
                </div>
                <button className="primary-btn" onClick={() => revealExtension("chrome")}>
                  Install
                </button>
              </div>

              <div className="ext-row">
                <div>
                  <div className="ext-name">Firefox, Zen, LibreWolf</div>
                  <div className="ext-hint">
                    Open <code>about:debugging#/runtime/this-firefox</code> → “Load Temporary
                    Add-on” → pick <code>manifest.json</code> in the revealed folder. See the
                    folder’s README to make it permanent.
                  </div>
                </div>
                <div className="ext-actions">
                  <button className="primary-btn" onClick={() => revealExtension("firefox")}>
                    Install
                  </button>
                  <button
                    className="link-btn"
                    onClick={() => writeText("about:debugging#/runtime/this-firefox")}
                  >
                    Copy address
                  </button>
                </div>
              </div>
            </div>
            <div className="dialog-actions">
              <button className="primary-btn" onClick={() => setShowExtensions(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Row context menu ---- */}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          resumableCount={resumableSel.length}
          pausableCount={pausableSel.length}
          cancelableCount={cancelableSel.length}
          canReveal={canReveal}
          canCopy={selectedItems.length > 0}
          canDelete={deletableSel.length > 0}
          canShowDetail={!!singleSelected}
          onResume={() => resumeMany(resumableSel)}
          onPause={() => pauseMany(pausableSel)}
          onCancel={() => cancelMany(cancelableSel)}
          onReveal={() =>
            singleSelected && revealItemInDir(singleSelected.path).catch(() => {})
          }
          onCopyLink={() => writeText(selectedItems.map((i) => i.url).join("\n"))}
          onShowDetail={() => singleSelected && openDetail(singleSelected.id)}
          onDelete={() => requestDelete(selectedItems)}
          onClose={() => setMenu(null)}
        />
      )}

      {/* ---- Delete confirmation ---- */}
      {pendingDelete && (
        <DeleteDialog
          items={pendingDelete}
          deleteWithFile={deleteWithFile}
          onToggleDeleteWithFile={setDeleteWithFile}
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}

/* A single row in the download table. Double-click (any state) opens the
   "Download Details" popup — see `onOpenDetail` — which now owns everything
   that used to expand inline here (per-connection bars, paths, etc). */
function Row({
  item,
  pct,
  selected,
  onSelect,
  onContext,
  onOpenDetail,
}: {
  item: DownloadItem;
  pct: number | null;
  selected: boolean;
  onSelect: (e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => void;
  onContext: (e: ReactMouseEvent) => void;
  onOpenDetail: () => void;
}) {
  return (
    <tr
      className={`drow ${selected ? "selected" : ""}`}
      onClick={onSelect}
      onDoubleClick={onOpenDetail}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContext(e);
      }}
    >
      <td className="col-name" title={item.path || item.url}>
        {item.filename}
      </td>
      <td className="col-status">
        {/* One state class only — `.mode-tag.missing` and `.mode-tag.completed`
            have equal specificity, so both applying would be order-dependent. */}
        <span className={`mode-tag ${statusClass(item)}`}>{statusLabel(item)}</span>
      </td>
      <td className="col-num">{item.total ? formatBytes(item.total) : "—"}</td>
      <td className="col-num">{formatBytes(item.downloaded)}</td>
      <td className="col-pct">
        <div className="cell-pct">
          <div className="mini-track">
            <div
              className={`mini-bar ${
                item.state === "completed" && !item.missing ? "done" : ""
              } ${item.state === "error" || item.state === "canceled" ? "error" : ""} ${
                pct === null && item.state === "downloading" ? "indeterminate" : ""
              }`}
              style={pct !== null ? { width: `${pct}%` } : undefined}
            />
          </div>
          <span className="pct-num">{pct !== null ? `${pct.toFixed(0)}%` : "—"}</span>
        </div>
      </td>
      <td className="col-num col-speed">
        {item.state === "downloading" ? formatSpeed(item.speed) : "—"}
      </td>
    </tr>
  );
}

/* Fixed-position right-click menu for the selected row(s). Clamps itself to
   stay inside the window and dismisses on outside click, Escape, scroll, or
   the window losing focus. */
function ContextMenu({
  x,
  y,
  resumableCount,
  pausableCount,
  cancelableCount,
  canReveal,
  canCopy,
  canDelete,
  canShowDetail,
  onResume,
  onPause,
  onCancel,
  onReveal,
  onCopyLink,
  onShowDetail,
  onDelete,
  onClose,
}: {
  x: number;
  y: number;
  resumableCount: number;
  pausableCount: number;
  cancelableCount: number;
  canReveal: boolean;
  canCopy: boolean;
  canDelete: boolean;
  canShowDetail: boolean;
  onResume: () => void;
  onPause: () => void;
  onCancel: () => void;
  onReveal: () => void;
  onCopyLink: () => void;
  onShowDetail: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const nx = x + rect.width > window.innerWidth ? Math.max(0, window.innerWidth - rect.width - 4) : x;
    const ny =
      y + rect.height > window.innerHeight ? Math.max(0, window.innerHeight - rect.height - 4) : y;
    setPos({ x: nx, y: ny });
  }, [x, y]);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  function run(action: () => void) {
    action();
    onClose();
  }

  return (
    <div className="ctx-menu" style={{ left: pos.x, top: pos.y }} ref={ref}>
      <button
        type="button"
        className="ctx-item"
        disabled={resumableCount === 0}
        onClick={() => run(onResume)}
      >
        Resume{resumableCount > 1 ? ` (${resumableCount})` : ""}
      </button>
      <button
        type="button"
        className="ctx-item"
        disabled={pausableCount === 0}
        onClick={() => run(onPause)}
      >
        Pause{pausableCount > 1 ? ` (${pausableCount})` : ""}
      </button>
      <button
        type="button"
        className="ctx-item"
        disabled={cancelableCount === 0}
        onClick={() => run(onCancel)}
      >
        Stop{cancelableCount > 1 ? ` (${cancelableCount})` : ""}
      </button>
      <div className="ctx-sep" />
      <button
        type="button"
        className="ctx-item"
        disabled={!canShowDetail}
        onClick={() => run(onShowDetail)}
      >
        Show detail
      </button>
      <button type="button" className="ctx-item" disabled={!canReveal} onClick={() => run(onReveal)}>
        Open containing folder
      </button>
      <button type="button" className="ctx-item" disabled={!canCopy} onClick={() => run(onCopyLink)}>
        Copy link
      </button>
      <div className="ctx-sep" />
      <button
        type="button"
        className="ctx-item danger"
        disabled={!canDelete}
        onClick={() => run(onDelete)}
      >
        Delete…
      </button>
    </div>
  );
}

/* Confirms a single or batch delete, offering to also remove the source
   file(s) from disk (unchecked by default). Running downloads in `items` are
   excluded from the action but called out so the user knows why. */
function DeleteDialog({
  items,
  deleteWithFile,
  onToggleDeleteWithFile,
  onCancel,
  onConfirm,
}: {
  items: DownloadItem[];
  deleteWithFile: boolean;
  onToggleDeleteWithFile: (v: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  const deletable = items.filter((d) => d.state !== "downloading" && d.state !== "verifying");
  const skipped = items.length - deletable.length;
  const shownNames = deletable.slice(0, 5);
  const moreCount = deletable.length - shownNames.length;
  // A missing row has no temp file left to warn about.
  const hasIncomplete = deletable.some((d) => d.state !== "completed" && !d.missing);

  return (
    <div className="overlay" onClick={onCancel}>
      <div className="dialog dialog-sm" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          {deletable.length === 1 ? `Delete "${deletable[0].filename}"?` : `Delete ${deletable.length} downloads?`}
        </div>
        <div className="dialog-body">
          {deletable.length > 1 && (
            <ul className="del-list">
              {shownNames.map((d) => (
                <li key={d.id} title={d.filename}>
                  {d.filename}
                </li>
              ))}
              {moreCount > 0 && <li>…and {moreCount} more</li>}
            </ul>
          )}
          {skipped > 0 && (
            <p className="detail-note">
              {skipped} running download{skipped > 1 ? "s are" : " is"} not included — pause or
              stop {skipped > 1 ? "them" : "it"} first.
            </p>
          )}
          <label className="check-row">
            <input
              type="checkbox"
              checked={deleteWithFile}
              onChange={(e) => onToggleDeleteWithFile(e.currentTarget.checked)}
            />
            Delete source file also
          </label>
          <p className="detail-note">
            {deleteWithFile
              ? "Files are removed permanently, not sent to the Recycle Bin."
              : "Applies to completed downloads only — this doesn't send anything to the Recycle Bin."}
          </p>
          {hasIncomplete && (
            <p className="detail-note">
              Partial downloads are never resumable once removed, so their temp file is always
              deleted regardless of the checkbox above.
            </p>
          )}
        </div>
        <div className="dialog-actions">
          <button onClick={onCancel}>Cancel</button>
          <button className="danger" onClick={onConfirm}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
