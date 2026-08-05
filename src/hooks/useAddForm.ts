import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { open } from "@tauri-apps/plugin-dialog";
import type { AddPayload, Prefs, ProxyConfig, ProxyScheme } from "../types";
import { formatBytes, isInsecureHttp, looksLikeUrl, mergeHeaders } from "../format";
import { categoryOf, categoryOfUrl, CATEGORY_FOLDER, type FileCategory } from "../categories";

export type ProbeInfo = { total: number | null; supportsRanges: boolean; filename: string };
export type ProbeStatus = "idle" | "loading" | "done" | "error";
export type Tab = "link" | "proxy" | "more" | "advanced";

export type AddFormState = {
  url: string;
  pendingInsecure: boolean;
  pendingLater: boolean;

  // Link tab — custom filename + live size probe
  filenameEnabled: boolean;
  filenameText: string;
  probedFilename: string;
  probeStatus: ProbeStatus;
  total: number | null;

  // More Options tab
  savePath: string;
  defaultDir: string;
  connections: number;
  perLimitMbps: number;
  checksumText: string;
  /** Remembered per-category save-path overrides, loaded from prefs.json. */
  categoryPaths: Record<string, string>;
  rememberPath: boolean;

  // Proxy tab
  proxyEnabled: boolean;
  proxyScheme: ProxyScheme;
  proxyHost: string;
  proxyPort: number;
  proxyUsername: string;
  proxyPassword: string;

  // Advanced Options tab
  userAgent: string;
  referer: string;
  cookieText: string;
  headersText: string;
};

const initialState: AddFormState = {
  url: "",
  pendingInsecure: false,
  pendingLater: false,
  filenameEnabled: false,
  filenameText: "",
  probedFilename: "",
  probeStatus: "idle",
  total: null,
  savePath: "",
  defaultDir: "",
  connections: 8,
  perLimitMbps: 0,
  checksumText: "",
  categoryPaths: {},
  rememberPath: false,
  proxyEnabled: false,
  proxyScheme: "http",
  proxyHost: "",
  proxyPort: 0,
  proxyUsername: "",
  proxyPassword: "",
  userAgent: "",
  referer: "",
  cookieText: "",
  headersText: "",
};

function reducer(state: AddFormState, patch: Partial<AddFormState>): AddFormState {
  return { ...state, ...patch };
}

/* The separate native "Add Download" window (Persepolis-style)'s form state:
   collects everything across Link / Proxy / More Options / Advanced Options
   tabs. Replaces what used to be ~20 independent useState calls with one
   reducer, `patch`, mirroring the same merge-a-partial-update pattern
   `patchItem` already uses for the main window's download rows. */
export function useAddForm() {
  const [state, patch] = useReducer(reducer, initialState);
  const [tab, setTab] = useState<Tab>("link");
  const requestIdRef = useRef(0);

  useEffect(() => {
    invoke<string>("default_download_dir")
      .then((defaultDir) => patch({ defaultDir }))
      .catch(() => {});
  }, []);

  // Remembered Connections / Speed cap defaults, and any per-category save
  // paths set from a previous session's "Remember this path" checkbox.
  useEffect(() => {
    invoke<Prefs>("load_prefs")
      .then((p) => {
        const upd: Partial<AddFormState> = { categoryPaths: p.categoryPaths ?? {} };
        if (p.connections > 0) upd.connections = p.connections;
        upd.perLimitMbps = p.speedLimitMbps;
        if (p.proxy) {
          upd.proxyEnabled = p.proxy.enabled;
          if (p.proxy.scheme) upd.proxyScheme = p.proxy.scheme;
          upd.proxyHost = p.proxy.host;
          upd.proxyPort = p.proxy.port;
          upd.proxyUsername = p.proxy.username;
          upd.proxyPassword = p.proxy.password;
        }
        patch(upd);
      })
      .catch(() => {});
  }, []);

  // A disabled checkbox left checked (from before the path was cleared) would
  // read as "will remember" when it can't actually fire on submit.
  useEffect(() => {
    if (!state.savePath.trim()) patch({ rememberPath: false });
  }, [state.savePath]);

  // Fired by the Rust side each time this (reused) window is opened via the
  // "+" button. Always refill the link field from the clipboard when it
  // holds a URL, so re-copying a different link before reopening the dialog
  // takes effect even if a previous link is still sitting in the field.
  useEffect(() => {
    const unlisten = listen("window-opened", async () => {
      let text: string;
      try {
        text = await readText();
      } catch {
        return;
      }
      const candidate = text.trim();
      if (!candidate || !looksLikeUrl(candidate)) return;
      patch({ url: candidate });
    });
    return () => {
      unlisten.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fills the form from a download the browser extension captured, instead
  // of letting it queue/download immediately — lets the user change options
  // and gives the size/filename probe below a chance to check metadata
  // before anything is committed to disk.
  function applyCapturedPayload(p: AddPayload) {
    const upd: Partial<AddFormState> = {
      url: p.url,
      pendingInsecure: false,
      pendingLater: false,
      probedFilename: "",
      total: null,
      probeStatus: "idle",
      perLimitMbps: p.speedLimit > 0 ? p.speedLimit / (1024 * 1024) : 0,
      checksumText: p.checksum ?? "",
      savePath: p.savePath ?? "",
    };
    if (p.filename.trim()) {
      upd.filenameEnabled = true;
      upd.filenameText = p.filename.trim();
    } else {
      upd.filenameEnabled = false;
      upd.filenameText = "";
    }
    if (p.connections > 0) upd.connections = p.connections;

    const byName = new Map(p.headers.map(([name, value]) => [name.toLowerCase(), value]));
    upd.userAgent = byName.get("user-agent") ?? "";
    upd.referer = byName.get("referer") ?? "";
    upd.cookieText = byName.get("cookie") ?? "";
    const rest = p.headers.filter(
      ([name]) => !["user-agent", "referer", "cookie"].includes(name.toLowerCase()),
    );
    upd.headersText = rest.map(([name, value]) => `${name}: ${value}`).join("\n");

    patch(upd);
    setTab("link");
  }

  // Warm start: the app was already running when the extension's adm://
  // link arrived.
  useEffect(() => {
    const unlisten = listen<AddPayload>("prefill-add", (e) => applyCapturedPayload(e.payload));
    return () => {
      unlisten.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cold start: the adm:// link arrived before this window had mounted, so
  // the Rust side stashed it — collect it now and reveal the window, since
  // it starts hidden.
  useEffect(() => {
    invoke<AddPayload | null>("take_pending_deep_link")
      .then((p) => {
        if (!p) return;
        applyCapturedPayload(p);
        invoke("reveal_add_window_cmd").catch(() => {});
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function runProbe(allowInsecure: boolean) {
    const u = state.url.trim();
    if (!u || !looksLikeUrl(u)) return;
    const myId = ++requestIdRef.current;
    patch({ probeStatus: "loading" });
    const headers = mergeHeaders(state.headersText, {
      userAgent: state.userAgent,
      referer: state.referer,
      cookie: state.cookieText,
    });
    invoke<ProbeInfo>("probe_url", { url: u, allowInsecure, headers, proxy: probeProxy })
      .then((info) => {
        if (requestIdRef.current !== myId) return;
        const upd: Partial<AddFormState> = {
          total: info.total,
          probedFilename: info.filename,
          probeStatus: "done",
        };
        if (!state.filenameEnabled) upd.filenameText = info.filename;
        patch(upd);
      })
      .catch(() => {
        if (requestIdRef.current !== myId) return;
        patch({ probeStatus: "error" });
      });
  }

  // What actually gets submitted and remembered: the checkbox state as-is, so
  // an incomplete proxy fails loudly in build_client rather than silently
  // going out direct.
  const effectiveProxy: ProxyConfig = useMemo(
    () => ({
      enabled: state.proxyEnabled,
      scheme: state.proxyScheme,
      host: state.proxyHost.trim(),
      port: state.proxyPort,
      username: state.proxyUsername.trim(),
      password: state.proxyPassword,
    }),
    [state.proxyEnabled, state.proxyScheme, state.proxyHost, state.proxyPort, state.proxyUsername, state.proxyPassword],
  );

  // The size probe is speculative and fires while the user is still typing, so
  // it stays direct until host and port are both complete.
  const probeProxy: ProxyConfig = useMemo(
    () => ({
      ...effectiveProxy,
      enabled: state.proxyEnabled && state.proxyHost.trim() !== "" && state.proxyPort > 0,
    }),
    [effectiveProxy, state.proxyEnabled, state.proxyHost, state.proxyPort],
  );

  // Debounced auto-probe — https only. An insecure http:// link never fires a
  // request on its own; the user must hit "Check size" to opt in explicitly.
  useEffect(() => {
    const u = state.url.trim();
    if (!u || !looksLikeUrl(u) || isInsecureHttp(u)) {
      patch({ probeStatus: "idle" });
      return;
    }
    const t = window.setTimeout(() => runProbe(false), 600);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.url,
    state.headersText,
    state.userAgent,
    state.referer,
    state.cookieText,
    state.proxyEnabled,
    state.proxyScheme,
    state.proxyHost,
    state.proxyPort,
  ]);

  const headerCount = useMemo(
    () =>
      mergeHeaders(state.headersText, {
        userAgent: state.userAgent,
        referer: state.referer,
        cookie: state.cookieText,
      }).length,
    [state.headersText, state.userAgent, state.referer, state.cookieText],
  );

  // Best guess at the file's category before it's actually downloaded: the
  // user's own filename override wins, then the probed server filename,
  // then whatever the URL itself implies. Drives the Save-path placeholder
  // and the "Remember this path for …" checkbox label below.
  const currentCategory: FileCategory = useMemo(() => {
    if (state.filenameEnabled && state.filenameText.trim()) return categoryOf(state.filenameText.trim());
    if (state.probedFilename) return categoryOf(state.probedFilename);
    return categoryOfUrl(state.url);
  }, [state.filenameEnabled, state.filenameText, state.probedFilename, state.url]);

  // Where a blank Save path will actually land: the remembered override for
  // this category if one is set, otherwise the built-in per-category folder.
  const savePathPlaceholder = useMemo(() => {
    const override = state.categoryPaths[currentCategory]?.trim();
    if (override) return override;
    if (!state.defaultDir) return "default downloads folder";
    const sep = state.defaultDir.includes("\\") ? "\\" : "/";
    return `${state.defaultDir}${sep}${CATEGORY_FOLDER[currentCategory]}`;
  }, [state.categoryPaths, currentCategory, state.defaultDir]);

  async function browseSavePath() {
    try {
      const dir = await open({ directory: true, defaultPath: state.savePath || state.defaultDir || undefined });
      if (typeof dir === "string") patch({ savePath: dir });
    } catch {
      /* user canceled or the picker is unavailable */
    }
  }

  function send(later: boolean, allowInsecure: boolean) {
    const u = state.url.trim();
    if (!u) return;
    const payload: AddPayload = {
      url: u,
      allowInsecure,
      headers: mergeHeaders(state.headersText, {
        userAgent: state.userAgent,
        referer: state.referer,
        cookie: state.cookieText,
      }),
      connections: state.connections,
      checksum: state.checksumText.trim(),
      speedLimit: state.perLimitMbps > 0 ? Math.round(state.perLimitMbps * 1024 * 1024) : 0,
      later,
      filename: state.filenameEnabled ? state.filenameText.trim() : "",
      savePath: state.savePath.trim(),
      proxy: effectiveProxy,
    };
    invoke("submit_add", { payload }); // Rust emits to main + hides this window
    invoke("save_add_defaults", {
      connections: state.connections,
      speedLimitMbps: state.perLimitMbps,
      proxy: effectiveProxy,
    }).catch(() => {});
    if (state.rememberPath && state.savePath.trim()) {
      const path = state.savePath.trim();
      invoke("set_category_path", { category: currentCategory, path }).catch(() => {});
      patch({ categoryPaths: { ...state.categoryPaths, [currentCategory]: path } });
    }
    patch({
      url: "",
      checksumText: "",
      pendingInsecure: false,
      filenameEnabled: false,
      filenameText: "",
      probedFilename: "",
      total: null,
      probeStatus: "idle",
      rememberPath: false,
    });
  }

  function act(later: boolean) {
    const u = state.url.trim();
    if (!u) return;
    if (isInsecureHttp(u)) {
      patch({ pendingLater: later, pendingInsecure: true });
      return;
    }
    send(later, false);
  }

  function sizeLabel(): string | null {
    const u = state.url.trim();
    if (!u || !looksLikeUrl(u) || isInsecureHttp(u)) return null;
    switch (state.probeStatus) {
      case "loading":
        return "Checking…";
      case "done":
        return state.total ? `Size: ${formatBytes(state.total)}` : "Size: unknown";
      case "error":
        return "Couldn't check size";
      default:
        return null;
    }
  }

  const showCheckSizeButton = looksLikeUrl(state.url.trim()) && isInsecureHttp(state.url.trim());
  const size = sizeLabel();

  return {
    state,
    patch,
    tab,
    setTab,
    effectiveProxy,
    headerCount,
    currentCategory,
    savePathPlaceholder,
    showCheckSizeButton,
    size,
    runProbe,
    browseSavePath,
    send,
    act,
  };
}
