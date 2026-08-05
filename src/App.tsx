import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";
import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type {
  AddPayload,
  AppSettings,
  DownloadEvent,
  DownloadItem,
  DlState,
  HistoryEntry,
  HistoryLoad,
  ResumableInfo,
  Category,
  Theme,
  TrayDownload,
  DetailAction,
} from "./types";
import { DEFAULT_PROXY } from "./types";
import {
  isInsecureHttp,
  formatBytes,
  formatSpeed,
  fallbackName,
  pctOf,
  truncate,
  statusClass,
  statusLabel,
  isResumable,
  formatDateAdded,
} from "./format";
import { Icon, WindowControls, useNativeShell, isEditable } from "./ui";
import { FileIcon } from "./fileIcons";
import { FILE_CATEGORIES, CATEGORY_LABEL, categoryOf } from "./categories";
import { broadcastTheme, normalizeTheme, useTheme } from "./theme";
import { initNotifications, notify, setNotificationsEnabled } from "./notify";
import "./App.css";

const TERMINAL_STATES = ["completed", "error", "canceled"] as const;
/** Sent by the browser extension; re-captured on demand rather than stored. */
const CREDENTIAL_HEADERS = ["cookie", "authorization", "proxy-authorization"];

type SortKey = "name" | "added" | "status" | "size" | "downloaded" | "pct" | "speed";
/** Sort order for the Status column: what needs attention floats to the top. */
const STATUS_RANK: Record<DlState, number> = {
  downloading: 0,
  verifying: 1,
  queued: 2,
  paused: 3,
  error: 4,
  canceled: 5,
  completed: 6,
};

/** Presets offered in the context menu's "Speed cap" submenu, in bytes/sec. */
const SPEED_PRESETS: { label: string; bytes: number }[] = [
  { label: "Unlimited", bytes: 0 },
  { label: "128 KB/s", bytes: 128 * 1024 },
  { label: "256 KB/s", bytes: 256 * 1024 },
  { label: "512 KB/s", bytes: 512 * 1024 },
  { label: "1 MB/s", bytes: 1 * 1024 * 1024 },
  { label: "2 MB/s", bytes: 2 * 1024 * 1024 },
  { label: "5 MB/s", bytes: 5 * 1024 * 1024 },
  { label: "10 MB/s", bytes: 10 * 1024 * 1024 },
];
const CONNECTION_PRESETS = [1, 2, 4, 8, 16];

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
    proxy: { ...d.proxy, password: "" },
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
    addedAt: d.addedAt,
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
    proxy: e.proxy ?? DEFAULT_PROXY,
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
    addedAt: e.addedAt || e.finishedAt || Date.now(),
  };
}

function App() {
  const [maxConcurrent, setMaxConcurrent] = useState(3);
  const [globalLimitMbps, setGlobalLimitMbps] = useState(0);
  const [minimizeToTray, setMinimizeToTray] = useState(false);
  const [theme, setTheme] = useState<Theme>("system");
  const [notifications, setNotifications] = useState(true);
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [version, setVersion] = useState("");

  const [category, setCategory] = useState<Category>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const anchorRef = useRef<string | null>(null); // shift-range anchor
  const tableWrapRef = useRef<HTMLElement>(null);
  // Rubber-band drag-select over the table: `dragStart` arms the window
  // mouse listeners below, `marquee` is the visible rectangle. `didDragRef`
  // distinguishes an actual drag from a plain click (mouseup always fires
  // right before click, so the click handlers check it to skip re-selecting).
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [marquee, setMarquee] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const dragBaseSelRef = useRef<Set<string>>(new Set());
  const didDragRef = useRef(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showExtensions, setShowExtensions] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DownloadItem[] | null>(null);
  const [deleteWithFile, setDeleteWithFile] = useState(false);
  // Ids of every open "Download Details" popup. Main keeps pushing snapshots
  // to each one as long as its id is in this set.
  const [detailIds, setDetailIds] = useState<Set<string>>(new Set());
  const lastDetailSentRef = useRef<Map<string, string>>(new Map());
  // Column sort for the table; defaults to Date Added (newest first). null
  // (reachable by cycling a column's sort back off) falls back to insertion order.
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" } | null>({
    key: "added",
    dir: "desc",
  });
  // Custom… speed-cap dialog, opened from the context menu's submenu.
  const [speedCapDialog, setSpeedCapDialog] = useState<{ items: DownloadItem[]; mbps: number } | null>(
    null,
  );
  // Confirmation for changing connections on a download that's currently
  // running — the worker pool is fixed for the life of a run, so applying a
  // new count means pausing and re-queuing it.
  const [connRestart, setConnRestart] = useState<{ items: DownloadItem[]; value: number } | null>(
    null,
  );
  // Ids paused specifically to restart with a new connection count — lets
  // the "paused" event handler re-queue them instead of leaving them paused.
  const pendingRestartRef = useRef<Set<string>>(new Set());

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
  // Downloads that have completed since the queue was last empty, so draining
  // it can report "all N complete" instead of just the final filename.
  const completedBurstRef = useRef(0);

  useNativeShell();
  useTheme();

  // The main window starts hidden (`visible: false` in tauri.conf.json) so
  // there's no white flash before React paints; show it right after the
  // first frame instead.
  useEffect(() => {
    const w = getCurrentWindow();
    const raf = requestAnimationFrame(() => {
      w.show()
        .then(() => w.setFocus())
        .catch(() => {});
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  // Restore persisted settings (scheduler knobs + tray behavior) from a
  // previous session; they otherwise reset to defaults every launch.
  useEffect(() => {
    invoke<AppSettings>("load_settings")
      .then((s) => {
        setMaxConcurrent(s.maxConcurrent);
        setGlobalLimitMbps(s.globalLimitMbps);
        setMinimizeToTray(s.minimizeToTray);
        setTheme(normalizeTheme(s.theme));
        setNotifications(s.notifications);
        setNotificationsEnabled(s.notifications);
        if (s.globalLimitMbps > 0) {
          invoke("set_global_speed_limit", {
            bytesPerSec: Math.round(s.globalLimitMbps * 1024 * 1024),
          });
        }
      })
      .catch(() => {});
  }, []);

  // Asked for once per launch. A denial silently disables toasts rather than
  // surfacing an error the user can't act on from here.
  useEffect(() => {
    initNotifications();
  }, []);

  useEffect(() => {
    getVersion()
      .then(setVersion)
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
          proxy: DEFAULT_PROXY,
          total: it.total,
          downloaded: it.downloaded,
          speed: 0,
          usedConnections: it.connections,
          numPieces: 0,
          pieceSize: 0,
          conns: [],
          state: "paused",
          addedAt: it.addedAt ?? Date.now(),
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

  // One summary toast when the queue drains, instead of leaving the user to
  // count individual "complete" toasts. Only fires past two downloads — a
  // single one already got its own toast and doesn't need a second.
  useEffect(() => {
    const pending = downloads.filter((d) =>
      ["downloading", "verifying", "queued"].includes(d.state),
    ).length;
    if (pending > 0) return;
    const n = completedBurstRef.current;
    completedBurstRef.current = 0;
    if (n > 1) notify("All downloads complete", `${n} downloads finished.`);
  }, [downloads]);

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
        // A restart requested by applyConnections (§ context menu) pauses the
        // run just to pick up a new connection count — re-queue it instead of
        // leaving it sitting paused.
        if (pendingRestartRef.current.delete(id)) {
          patchItem(id, { state: "queued", speed: 0 });
        } else {
          patchItem(id, { state: "paused", speed: 0 });
        }
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
        completedBurstRef.current += 1;
        notify("Download complete", msg.data.filename);
        break;
      case "error": {
        patchItem(id, {
          state: "error",
          error: msg.data.message,
          speed: 0,
          finishedAt: Date.now(),
        });
        // The patch above hasn't landed in `downloads` yet, so read the name
        // from the ref rather than waiting a render for it.
        const name = downloadsRef.current.find((d) => d.id === id)?.filename ?? "Download";
        notify("Download failed", `${name} — ${msg.data.message}`);
        break;
      }
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
        proxy: item.proxy,
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
      proxy: p.proxy ?? DEFAULT_PROXY,
      total: null,
      downloaded: 0,
      speed: 0,
      usedConnections: 1,
      numPieces: 0,
      pieceSize: 0,
      conns: [],
      state: p.later ? "paused" : "queued",
      addedAt: Date.now(),
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
          notify(
            "Waiting for browser",
            `${d.filename} needs a fresh sign-in — its original page was reopened in your browser.`,
          );
          return { ...restart, state: "paused" as const, awaitingCapture: true };
        }
        return restart;
      }),
    );
  }

  // Context menu "Speed cap": updates the row(s) so a not-yet-started
  // download picks up the new cap at its next `start_download` call, and — for
  // anything currently running — pushes it live via `set_download_speed_limit`
  // so the change is visible within a couple of seconds instead of waiting for
  // a restart.
  function applySpeedCap(items: DownloadItem[], bytes: number) {
    const ids = new Set(items.map((i) => i.id));
    setDownloads((ds) => ds.map((d) => (ids.has(d.id) ? { ...d, speedLimit: bytes } : d)));
    items
      .filter((i) => i.state === "downloading" || i.state === "verifying")
      .forEach((i) =>
        invoke("set_download_speed_limit", { id: i.id, bytesPerSec: bytes }).catch(() => {}),
      );
  }

  // Context menu "Connections": the worker pool is fixed for the life of a
  // run, so a row that's currently downloading needs the user's say-so to
  // pause + re-queue it (see the "paused" case in handleEvent, which detects
  // `pendingRestartRef` and re-queues instead of leaving it paused). Anything
  // not running just picks up the new count at its next start.
  function applyConnections(items: DownloadItem[], n: number) {
    const ids = new Set(items.map((i) => i.id));
    setDownloads((ds) => ds.map((d) => (ids.has(d.id) ? { ...d, connections: n } : d)));
    const running = items.filter((i) => i.state === "downloading");
    if (running.length > 0) {
      setConnRestart({ items: running, value: n });
    }
  }

  function confirmConnRestart() {
    if (!connRestart) return;
    connRestart.items.forEach((i) => {
      pendingRestartRef.current.add(i.id);
      invoke("pause_download", { id: i.id }).catch(() => {});
    });
    setConnRestart(null);
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

  // Opens (or reveals) a "Download Details" popup for `id` — a double-click,
  // a context-menu action, or the tray's per-download menu item all funnel
  // through here. The popup hands itself back via `detail-ready` once its own
  // React tree has mounted; that's what actually seeds and shows it (below),
  // so there's no race with the window-creation round-trip.
  function openDetail(id: string) {
    invoke("open_detail_window", { id }).catch(() => {});
  }

  // A popup announces itself once it's mounted and ready for its first
  // snapshot. Track it, push the current snapshot, then reveal the window —
  // ordering it this way means the popup never shows an empty state first.
  useEffect(() => {
    const unlisten = listen<string>("detail-ready", async (e) => {
      const id = e.payload;
      setDetailIds((prev) => new Set(prev).add(id));
      const item = downloadsRef.current.find((d) => d.id === id) ?? null;
      lastDetailSentRef.current.set(id, JSON.stringify(item));
      await emitTo(`detail-${id}`, "detail-data", item).catch(() => {});
      invoke("show_detail_window", { id }).catch(() => {});
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  // Keeps every open detail popup's snapshot in sync with its targeted row.
  // A `null` payload tells it the row was removed. Skips a popup whose
  // snapshot hasn't actually changed, so N open popups don't each eat a push
  // on every one of the ~7/sec progress patches.
  useEffect(() => {
    if (detailIds.size === 0) return;
    detailIds.forEach((id) => {
      const item = downloads.find((d) => d.id === id) ?? null;
      const json = JSON.stringify(item);
      if (lastDetailSentRef.current.get(id) === json) return;
      lastDetailSentRef.current.set(id, json);
      emitTo(`detail-${id}`, "detail-data", item).catch(() => {});
    });
  }, [downloads, detailIds]);

  useEffect(() => {
    const unlisten = listen<string>("detail-closed", (e) => {
      const id = e.payload;
      setDetailIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      lastDetailSentRef.current.delete(id);
    });
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
        theme,
        notifications,
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

  // Applies here and pushes the change to the Add / Details windows, which
  // hold their own copy of the stylesheet.
  function setThemeSetting(v: Theme) {
    setTheme(v);
    broadcastTheme(v);
    persistSettings({ theme: v });
  }

  function setNotificationsSetting(v: boolean) {
    setNotifications(v);
    setNotificationsEnabled(v);
    persistSettings({ notifications: v });
  }

  // Derived
  const activeItems = downloads.filter((d) =>
    ["downloading", "verifying", "queued", "paused"].includes(d.state),
  );
  const finishedItems = downloads.filter((d) =>
    ["completed", "error", "canceled"].includes(d.state),
  );
  const shown =
    category === "active"
      ? activeItems
      : category === "finished"
        ? finishedItems
        : category === "all"
          ? downloads
          : downloads.filter((d) => categoryOf(d.filename) === category);

  // Counts for the sidebar's "File type" section, tallied once per downloads
  // change rather than filtering the whole list six times.
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const d of downloads) {
      const c = categoryOf(d.filename);
      counts[c] = (counts[c] ?? 0) + 1;
    }
    return counts;
  }, [downloads]);

  // `shown` ordered by the active column sort, or left as-is (newest first)
  // when `sort` is null. `Array.prototype.sort` is stable, so ties keep
  // insertion order either way.
  const rows = useMemo(() => {
    if (!sort) return shown;
    const dir = sort.dir === "asc" ? 1 : -1;
    const key = sort.key;
    function value(d: DownloadItem): number | string {
      switch (key) {
        case "name":
          return d.filename;
        case "added":
          return d.addedAt;
        case "status":
          return STATUS_RANK[d.state];
        case "size":
          return d.total ?? -1;
        case "downloaded":
          return d.downloaded;
        case "pct":
          return pctOf(d) ?? -1;
        case "speed":
          return d.speed;
      }
    }
    return [...shown].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      if (typeof va === "string" || typeof vb === "string") {
        return dir * String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: "base" });
      }
      return dir * (va - vb);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, sort]);

  function toggleSort(key: SortKey) {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  }

  const totalSpeed = downloads
    .filter((d) => d.state === "downloading")
    .reduce((s, d) => s + d.speed, 0);
  const activeCount = downloads.filter(
    (d) => d.state === "downloading" || d.state === "verifying",
  ).length;
  const queuedCount = downloads.filter((d) => d.state === "queued").length;

  const selectedItems = downloads.filter((d) => selectedIds.has(d.id));
  const resumableSel = selectedItems.filter(isResumable);
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
    if (didDragRef.current) {
      didDragRef.current = false;
      return;
    }
    if (e.shiftKey && anchorRef.current) {
      const ids = rows.map((d) => d.id);
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

  function scrollRowIntoView(id: string) {
    document.querySelector(`.drow[data-id="${id}"]`)?.scrollIntoView({ block: "nearest" });
  }

  // Arms a rubber-band drag: only for the primary button, and not when the
  // mousedown started on the header (sorting owns that click). Ctrl/Shift
  // held at drag start adds to the existing selection instead of replacing it.
  function handleTableMouseDown(e: ReactMouseEvent) {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest("thead")) return;
    didDragRef.current = false;
    dragBaseSelRef.current =
      e.ctrlKey || e.metaKey || e.shiftKey ? new Set(selectedIds) : new Set();
    setDragStart({ x: e.clientX, y: e.clientY });
  }

  // Tracks an armed drag across the window (the cursor can leave the table
  // mid-drag) until mouseup. A plain click never moves past the 4px
  // threshold, so it never marks `didDragRef` and never touches selection —
  // `selectRow` and the table's onClick handle that case normally.
  useEffect(() => {
    if (!dragStart) return;
    const startX = dragStart.x;
    const startY = dragStart.y;

    function onMouseMove(e: MouseEvent) {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!didDragRef.current && Math.hypot(dx, dy) < 4) return;
      didDragRef.current = true;

      const wrap = tableWrapRef.current;
      const wrapRect = wrap?.getBoundingClientRect();

      const boxLeft = Math.min(startX, e.clientX);
      const boxTop = Math.min(startY, e.clientY);
      const boxRight = Math.max(startX, e.clientX);
      const boxBottom = Math.max(startY, e.clientY);

      if (wrapRect) {
        const clampedLeft = Math.max(boxLeft, wrapRect.left);
        const clampedTop = Math.max(boxTop, wrapRect.top);
        const clampedRight = Math.min(boxRight, wrapRect.right);
        const clampedBottom = Math.min(boxBottom, wrapRect.bottom);
        setMarquee({
          left: clampedLeft,
          top: clampedTop,
          width: Math.max(0, clampedRight - clampedLeft),
          height: Math.max(0, clampedBottom - clampedTop),
        });
      }

      const hits = new Set(dragBaseSelRef.current);
      document.querySelectorAll<HTMLElement>(".drow").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.bottom > boxTop && r.top < boxBottom) {
          const id = el.dataset.id;
          if (id) hits.add(id);
        }
      });
      setSelectedIds(hits);

      if (wrap && wrapRect) {
        const edge = 20;
        if (e.clientY < wrapRect.top + edge) wrap.scrollTop -= 16;
        else if (e.clientY > wrapRect.bottom - edge) wrap.scrollTop += 16;
      }
    }

    function onMouseUp() {
      setDragStart(null);
      setMarquee(null);
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [dragStart]);

  // Keyboard shortcuts for the selection: Ctrl/Cmd+A selects everything shown,
  // Escape clears, Delete opens the confirmation dialog for the current
  // selection, arrow keys/Home/End move a single-row cursor (Shift extends
  // the range from the anchor), Enter opens the detail popup for one row.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isEditable(e.target)) return;
      // A modal dialog or the context menu owns keyboard input while open —
      // their own handlers deal with Escape.
      if (pendingDelete || showSettings || showExtensions || menu || speedCapDialog || connRestart) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelectedIds(new Set(rows.map((d) => d.id)));
        return;
      }
      if (e.key === "Escape") {
        setSelectedIds(new Set());
        return;
      }
      if (e.key === "Delete") {
        requestDelete(selectedItems);
        return;
      }
      if (rows.length === 0) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const ids = rows.map((d) => d.id);
        const from = anchorRef.current ? ids.indexOf(anchorRef.current) : -1;
        const base = from === -1 ? (e.key === "ArrowDown" ? -1 : ids.length) : from;
        const next = Math.min(ids.length - 1, Math.max(0, base + (e.key === "ArrowDown" ? 1 : -1)));
        const nextId = ids[next];
        if (e.shiftKey && from !== -1) {
          const [lo, hi] = from < next ? [from, next] : [next, from];
          setSelectedIds(new Set(ids.slice(lo, hi + 1)));
        } else {
          setSelectedIds(new Set([nextId]));
          anchorRef.current = nextId;
        }
        scrollRowIntoView(nextId);
        return;
      }
      if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        const ids = rows.map((d) => d.id);
        const targetId = e.key === "Home" ? ids[0] : ids[ids.length - 1];
        const from = anchorRef.current ? ids.indexOf(anchorRef.current) : -1;
        if (e.shiftKey && from !== -1) {
          const targetIdx = e.key === "Home" ? 0 : ids.length - 1;
          const [lo, hi] = from < targetIdx ? [from, targetIdx] : [targetIdx, from];
          setSelectedIds(new Set(ids.slice(lo, hi + 1)));
        } else {
          setSelectedIds(new Set([targetId]));
          anchorRef.current = targetId;
        }
        scrollRowIntoView(targetId);
        return;
      }
      if (e.key === "Enter" && singleSelected) {
        e.preventDefault();
        openDetail(singleSelected.id);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    rows,
    selectedItems,
    singleSelected,
    pendingDelete,
    showSettings,
    showExtensions,
    menu,
    speedCapDialog,
    connRestart,
  ]);

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

          <div className="side-title">File type</div>
          {FILE_CATEGORIES.map((c) => (
            <button
              key={c}
              className={`cat ${category === c ? "active" : ""}`}
              onClick={() => setCategory(c)}
            >
              {CATEGORY_LABEL[c]} <span className="cat-n">{categoryCounts[c] ?? 0}</span>
            </button>
          ))}
        </aside>

        <main
          className="table-wrap"
          ref={tableWrapRef}
          onMouseDown={handleTableMouseDown}
          onClick={(e) => {
            if (didDragRef.current) {
              didDragRef.current = false;
              return;
            }
            const t = e.target as HTMLElement;
            if (!t.closest(".drow")) setSelectedIds(new Set());
          }}
        >
          <table className="dtable">
            <thead>
              <tr>
                <SortTh className="col-name" label="Name" sortKey="name" sort={sort} onSort={toggleSort} />
                <SortTh
                  className="col-added"
                  label="Date Added"
                  sortKey="added"
                  sort={sort}
                  onSort={toggleSort}
                />
                <SortTh
                  className="col-status"
                  label="Status"
                  sortKey="status"
                  sort={sort}
                  onSort={toggleSort}
                />
                <SortTh className="col-num" label="Size" sortKey="size" sort={sort} onSort={toggleSort} />
                <SortTh
                  className="col-num"
                  label="Downloaded"
                  sortKey="downloaded"
                  sort={sort}
                  onSort={toggleSort}
                />
                <SortTh
                  className="col-pct"
                  label="Percentage"
                  sortKey="pct"
                  sort={sort}
                  onSort={toggleSort}
                />
                <SortTh
                  className="col-num col-speed"
                  label="Speed"
                  sortKey="speed"
                  sort={sort}
                  onSort={toggleSort}
                />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty-cell">
                    No downloads here — click <strong>+</strong> to add one.
                  </td>
                </tr>
              )}
              {rows.map((item) => {
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

      {marquee && <div className="marquee" style={marquee} />}

      {/* ---- Status bar ---- */}
      <div className="statusbar">
        <span>Azhura Download Manager{version ? ` v${version}` : ""}</span>
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
              <div className="field-row">
                <label htmlFor="theme">Color theme</label>
                <select
                  id="theme"
                  value={theme}
                  onChange={(e) => setThemeSetting(e.currentTarget.value as Theme)}
                >
                  <option value="system">Use system setting</option>
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                </select>
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
              <div className="check-row">
                <input
                  type="checkbox"
                  id="notify"
                  checked={notifications}
                  onChange={(e) => setNotificationsSetting(e.currentTarget.checked)}
                />
                <label htmlFor="notify">Show desktop notifications</label>
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
          canOpen={canReveal}
          canCopy={selectedItems.length > 0}
          canDelete={deletableSel.length > 0}
          canShowDetail={!!singleSelected}
          canModify={selectedItems.length > 0}
          currentSpeedLimit={singleSelected?.speedLimit ?? null}
          currentConnections={singleSelected?.connections ?? null}
          onResume={() => resumeMany(resumableSel)}
          onPause={() => pauseMany(pausableSel)}
          onCancel={() => cancelMany(cancelableSel)}
          onOpen={() => singleSelected && openPath(singleSelected.path).catch(() => {})}
          onReveal={() =>
            singleSelected && revealItemInDir(singleSelected.path).catch(() => {})
          }
          onCopyLink={() => writeText(selectedItems.map((i) => i.url).join("\n"))}
          onShowDetail={() => singleSelected && openDetail(singleSelected.id)}
          onSpeedCap={(bytes) => applySpeedCap(selectedItems, bytes)}
          onCustomSpeedCap={() =>
            setSpeedCapDialog({
              items: selectedItems,
              mbps: singleSelected ? singleSelected.speedLimit / (1024 * 1024) : 0,
            })
          }
          onConnections={(n) => applyConnections(selectedItems, n)}
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

      {/* ---- Custom speed cap dialog ---- */}
      {speedCapDialog && (
        <div className="overlay" onClick={() => setSpeedCapDialog(null)}>
          <div className="dialog dialog-sm" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-head">Speed cap</div>
            <div className="dialog-body">
              <div className="field-row">
                <label htmlFor="custom-cap">Limit</label>
                <input
                  id="custom-cap"
                  type="number"
                  min={0}
                  step={0.5}
                  autoFocus
                  value={speedCapDialog.mbps}
                  onChange={(e) =>
                    setSpeedCapDialog({
                      ...speedCapDialog,
                      mbps: Math.max(0, Number(e.currentTarget.value) || 0),
                    })
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      applySpeedCap(speedCapDialog.items, Math.round(speedCapDialog.mbps * 1024 * 1024));
                      setSpeedCapDialog(null);
                    }
                  }}
                />
                <span className="field-unit">MB/s · 0 = unlimited</span>
              </div>
            </div>
            <div className="dialog-actions">
              <button onClick={() => setSpeedCapDialog(null)}>Cancel</button>
              <button
                className="primary-btn"
                onClick={() => {
                  applySpeedCap(speedCapDialog.items, Math.round(speedCapDialog.mbps * 1024 * 1024));
                  setSpeedCapDialog(null);
                }}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Connections-change restart confirmation ---- */}
      {connRestart && (
        <div className="overlay" onClick={() => setConnRestart(null)}>
          <div className="dialog dialog-sm" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-head">Apply new connection count?</div>
            <div className="dialog-body">
              <p className="detail-note">
                {connRestart.items.length > 1
                  ? `${connRestart.items.length} downloads are running.`
                  : "This download is running."}{" "}
                Restarting resumes from where it left off — no progress is lost.
              </p>
            </div>
            <div className="dialog-actions">
              <button onClick={() => setConnRestart(null)}>Apply on next start</button>
              <button className="primary-btn" onClick={confirmConnRestart}>
                Restart now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* A sortable column header: click cycles asc → desc → default (unsorted)
   for its own key, and starts at asc when switching from a different key. */
function SortTh({
  className,
  label,
  sortKey,
  sort,
  onSort,
}: {
  className: string;
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; dir: "asc" | "desc" } | null;
  onSort: (key: SortKey) => void;
}) {
  const active = sort?.key === sortKey;
  const ariaSort = active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none";
  return (
    <th
      className={`${className} sortable`}
      aria-sort={ariaSort}
      onClick={() => onSort(sortKey)}
    >
      {label}
      {active && <span className="sort-arrow">{sort!.dir === "asc" ? "▲" : "▼"}</span>}
    </th>
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
      data-id={item.id}
      onClick={onSelect}
      onDoubleClick={onOpenDetail}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContext(e);
      }}
    >
      <td className="col-name" title={item.path || item.url}>
        <span className="name-cell">
          <FileIcon name={item.filename} />
          <span className="name-text">{item.filename}</span>
        </span>
      </td>
      <td className="col-added">{formatDateAdded(item.addedAt)}</td>
      <td className="col-status">
        {/* One state class only — `.mode-tag.missing` and `.mode-tag.completed`
            have equal specificity, so both applying would be order-dependent. */}
        <span className={`mode-tag ${statusClass(item)}`}>{statusLabel(item)}</span>
      </td>
      <td className="col-num">{item.total ? formatBytes(item.total) : "—"}</td>
      <td className="col-num">{formatBytes(item.downloaded)}</td>
      <td className="col-pct">{pct !== null ? `${pct.toFixed(0)}%` : "—"}</td>
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
  canOpen,
  canCopy,
  canDelete,
  canShowDetail,
  canModify,
  currentSpeedLimit,
  currentConnections,
  onResume,
  onPause,
  onCancel,
  onOpen,
  onReveal,
  onCopyLink,
  onShowDetail,
  onSpeedCap,
  onCustomSpeedCap,
  onConnections,
  onDelete,
  onClose,
}: {
  x: number;
  y: number;
  resumableCount: number;
  pausableCount: number;
  cancelableCount: number;
  canReveal: boolean;
  canOpen: boolean;
  canCopy: boolean;
  canDelete: boolean;
  canShowDetail: boolean;
  canModify: boolean;
  currentSpeedLimit: number | null;
  currentConnections: number | null;
  onResume: () => void;
  onPause: () => void;
  onCancel: () => void;
  onOpen: () => void;
  onReveal: () => void;
  onCopyLink: () => void;
  onShowDetail: () => void;
  onSpeedCap: (bytes: number) => void;
  onCustomSpeedCap: () => void;
  onConnections: (n: number) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [flip, setFlip] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const nx = x + rect.width > window.innerWidth ? Math.max(0, window.innerWidth - rect.width - 4) : x;
    const ny =
      y + rect.height > window.innerHeight ? Math.max(0, window.innerHeight - rect.height - 4) : y;
    setPos({ x: nx, y: ny });
    // Flyouts open to the right by default (180px wide); flip them to the
    // left instead if that would run off the screen.
    setFlip(nx + rect.width + 180 > window.innerWidth);
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
    <div className={`ctx-menu ${flip ? "flip" : ""}`} style={{ left: pos.x, top: pos.y }} ref={ref}>
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
      <button type="button" className="ctx-item" disabled={!canOpen} onClick={() => run(onOpen)}>
        Open
      </button>
      <button type="button" className="ctx-item" disabled={!canReveal} onClick={() => run(onReveal)}>
        Open containing folder
      </button>
      <button type="button" className="ctx-item" disabled={!canCopy} onClick={() => run(onCopyLink)}>
        Copy link
      </button>
      <div className="ctx-sep" />
      <div className={`ctx-item ctx-sub ${!canModify ? "disabled" : ""}`}>
        Speed cap
        <span className="ctx-caret">▸</span>
        <div className="ctx-flyout">
          {SPEED_PRESETS.map((p) => (
            <button
              key={p.bytes}
              type="button"
              className="ctx-item"
              disabled={!canModify}
              onClick={() => run(() => onSpeedCap(p.bytes))}
            >
              <span className="ctx-check">{currentSpeedLimit === p.bytes ? "•" : ""}</span>
              {p.label}
            </button>
          ))}
          <div className="ctx-sep" />
          <button
            type="button"
            className="ctx-item"
            disabled={!canModify}
            onClick={() => run(onCustomSpeedCap)}
          >
            Custom…
          </button>
        </div>
      </div>
      <div className={`ctx-item ctx-sub ${!canModify ? "disabled" : ""}`}>
        Connections
        <span className="ctx-caret">▸</span>
        <div className="ctx-flyout">
          {CONNECTION_PRESETS.map((n) => (
            <button
              key={n}
              type="button"
              className="ctx-item"
              disabled={!canModify}
              onClick={() => run(() => onConnections(n))}
            >
              <span className="ctx-check">{currentConnections === n ? "•" : ""}</span>
              {n}
            </button>
          ))}
        </div>
      </div>
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
