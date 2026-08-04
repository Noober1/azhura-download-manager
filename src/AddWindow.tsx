import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { open } from "@tauri-apps/plugin-dialog";
import type { AddPayload } from "./types";
import { formatBytes, isInsecureHttp, looksLikeUrl, mergeHeaders } from "./format";
import { WindowControls, useNativeShell } from "./ui";
import { useTheme } from "./theme";
import "./App.css";

type ProbeInfo = { total: number | null; supportsRanges: boolean; filename: string };
type ProbeStatus = "idle" | "loading" | "done" | "error";
type Tab = "link" | "proxy" | "more" | "advanced";

/* The separate native "Add Download" window (Persepolis-style). Collects the
   form across Link / Proxy / More Options / Advanced Options tabs and hands
   it to the main window via the `submit_add` command. */
export function AddWindow() {
  const [tab, setTab] = useState<Tab>("link");

  const [url, setUrl] = useState("");
  const [pendingInsecure, setPendingInsecure] = useState(false);
  const [pendingLater, setPendingLater] = useState(false);

  // Link tab — custom filename + live size probe
  const [filenameEnabled, setFilenameEnabled] = useState(false);
  const [filenameText, setFilenameText] = useState("");
  const [probedFilename, setProbedFilename] = useState("");
  const [probeStatus, setProbeStatus] = useState<ProbeStatus>("idle");
  const [total, setTotal] = useState<number | null>(null);
  const requestIdRef = useRef(0);

  // More Options tab
  const [savePath, setSavePath] = useState("");
  const [defaultDir, setDefaultDir] = useState("");
  const [connections, setConnections] = useState(8);
  const [perLimitMbps, setPerLimitMbps] = useState(0);
  const [checksumText, setChecksumText] = useState("");

  // Advanced Options tab
  const [userAgent, setUserAgent] = useState("");
  const [referer, setReferer] = useState("");
  const [cookieText, setCookieText] = useState("");
  const [headersText, setHeadersText] = useState("");

  useNativeShell();
  useTheme();

  useEffect(() => {
    invoke<string>("default_download_dir")
      .then(setDefaultDir)
      .catch(() => {});
  }, []);

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
      setUrl(candidate);
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
    setUrl(p.url);
    setPendingInsecure(false);
    setPendingLater(false);

    if (p.filename.trim()) {
      setFilenameEnabled(true);
      setFilenameText(p.filename.trim());
    } else {
      setFilenameEnabled(false);
      setFilenameText("");
    }
    setProbedFilename("");
    setTotal(null);
    setProbeStatus("idle");

    if (p.connections > 0) setConnections(p.connections);
    setPerLimitMbps(p.speedLimit > 0 ? p.speedLimit / (1024 * 1024) : 0);
    setChecksumText(p.checksum ?? "");
    setSavePath(p.savePath ?? "");

    const byName = new Map(p.headers.map(([name, value]) => [name.toLowerCase(), value]));
    setUserAgent(byName.get("user-agent") ?? "");
    setReferer(byName.get("referer") ?? "");
    setCookieText(byName.get("cookie") ?? "");
    const rest = p.headers.filter(
      ([name]) => !["user-agent", "referer", "cookie"].includes(name.toLowerCase()),
    );
    setHeadersText(rest.map(([name, value]) => `${name}: ${value}`).join("\n"));

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
    const u = url.trim();
    if (!u || !looksLikeUrl(u)) return;
    const myId = ++requestIdRef.current;
    setProbeStatus("loading");
    const headers = mergeHeaders(headersText, { userAgent, referer, cookie: cookieText });
    invoke<ProbeInfo>("probe_url", { url: u, allowInsecure, headers })
      .then((info) => {
        if (requestIdRef.current !== myId) return;
        setTotal(info.total);
        setProbedFilename(info.filename);
        setProbeStatus("done");
        if (!filenameEnabled) setFilenameText(info.filename);
      })
      .catch(() => {
        if (requestIdRef.current !== myId) return;
        setProbeStatus("error");
      });
  }

  // Debounced auto-probe — https only. An insecure http:// link never fires a
  // request on its own; the user must hit "Check size" to opt in explicitly.
  useEffect(() => {
    const u = url.trim();
    if (!u || !looksLikeUrl(u) || isInsecureHttp(u)) {
      setProbeStatus("idle");
      return;
    }
    const t = window.setTimeout(() => runProbe(false), 600);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, headersText, userAgent, referer, cookieText]);

  const headerCount = useMemo(
    () => mergeHeaders(headersText, { userAgent, referer, cookie: cookieText }).length,
    [headersText, userAgent, referer, cookieText],
  );

  async function browseSavePath() {
    try {
      const dir = await open({ directory: true, defaultPath: savePath || defaultDir || undefined });
      if (typeof dir === "string") setSavePath(dir);
    } catch {
      /* user canceled or the picker is unavailable */
    }
  }

  function send(later: boolean, allowInsecure: boolean) {
    const u = url.trim();
    if (!u) return;
    const payload: AddPayload = {
      url: u,
      allowInsecure,
      headers: mergeHeaders(headersText, { userAgent, referer, cookie: cookieText }),
      connections,
      checksum: checksumText.trim(),
      speedLimit: perLimitMbps > 0 ? Math.round(perLimitMbps * 1024 * 1024) : 0,
      later,
      filename: filenameEnabled ? filenameText.trim() : "",
      savePath: savePath.trim(),
    };
    invoke("submit_add", { payload }); // Rust emits to main + hides this window
    setUrl("");
    setChecksumText("");
    setPendingInsecure(false);
    setFilenameEnabled(false);
    setFilenameText("");
    setProbedFilename("");
    setTotal(null);
    setProbeStatus("idle");
  }

  function act(later: boolean) {
    const u = url.trim();
    if (!u) return;
    if (isInsecureHttp(u)) {
      setPendingLater(later);
      setPendingInsecure(true);
      return;
    }
    send(later, false);
  }

  function sizeLabel(): string | null {
    const u = url.trim();
    if (!u || !looksLikeUrl(u) || isInsecureHttp(u)) return null;
    switch (probeStatus) {
      case "loading":
        return "Checking…";
      case "done":
        return total ? `Size: ${formatBytes(total)}` : "Size: unknown";
      case "error":
        return "Couldn't check size";
      default:
        return null;
    }
  }

  const showCheckSizeButton = looksLikeUrl(url.trim()) && isInsecureHttp(url.trim());
  const size = sizeLabel();

  return (
    <div className="add-window">
      <div className="dialog-head add-head" data-tauri-drag-region>
        <span>Add Download</span>
        <WindowControls variant="close" />
      </div>

      <div className="tabs">
        <button
          type="button"
          className={`tab ${tab === "link" ? "active" : ""}`}
          onClick={() => setTab("link")}
        >
          Link
        </button>
        <button
          type="button"
          className={`tab ${tab === "proxy" ? "active" : ""}`}
          onClick={() => setTab("proxy")}
        >
          Proxy
        </button>
        <button
          type="button"
          className={`tab ${tab === "more" ? "active" : ""}`}
          onClick={() => setTab("more")}
        >
          More Options
        </button>
        <button
          type="button"
          className={`tab ${tab === "advanced" ? "active" : ""}`}
          onClick={() => setTab("advanced")}
        >
          Advanced Options{headerCount > 0 ? ` · ${headerCount}` : ""}
        </button>
      </div>

      <div className="dialog-body">
        {pendingInsecure && (
          <div className="inline-warn">
            <strong>⚠ Insecure http://</strong> — not encrypted. Add anyway?
            <div className="inline-warn-actions">
              <button className="danger" onClick={() => send(pendingLater, true)}>
                Add anyway
              </button>
              <button onClick={() => setPendingInsecure(false)}>Back</button>
            </div>
          </div>
        )}

        <div className={`tab-panel ${tab === "link" ? "" : "tab-hidden"}`}>
          <label className="dlg-label" htmlFor="dlg-url">
            Download link
          </label>
          <input
            id="dlg-url"
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && url.trim() && !pendingInsecure) act(false);
            }}
            placeholder="https://example.com/file.zip"
            spellCheck={false}
          />

          <div className="check-row">
            <input
              type="checkbox"
              id="fn-enable"
              checked={filenameEnabled}
              onChange={(e) => setFilenameEnabled(e.currentTarget.checked)}
            />
            <label htmlFor="fn-enable">Change file name:</label>
            <input
              id="fn-text"
              disabled={!filenameEnabled}
              value={filenameText}
              onChange={(e) => setFilenameText(e.currentTarget.value)}
              spellCheck={false}
              placeholder={probedFilename || "filename"}
            />
          </div>

          <div className="link-foot">
            {showCheckSizeButton && (
              <button type="button" className="link-btn" onClick={() => runProbe(true)}>
                Check size
              </button>
            )}
            {size && <span className="size-readout">{size}</span>}
          </div>
        </div>

        <div className={`tab-panel tab-empty ${tab === "proxy" ? "" : "tab-hidden"}`}>
          <p>Proxy support is not implemented yet.</p>
        </div>

        <div className={`tab-panel ${tab === "more" ? "" : "tab-hidden"}`}>
          <div className="field-row path-row">
            <label htmlFor="savepath">Save path</label>
            <input
              id="savepath"
              value={savePath}
              onChange={(e) => setSavePath(e.currentTarget.value)}
              spellCheck={false}
              placeholder={defaultDir || "default downloads folder"}
            />
            <button type="button" onClick={browseSavePath}>
              Browse…
            </button>
          </div>
          <div className="field-row">
            <label htmlFor="conn">Connections</label>
            <select
              id="conn"
              className="conn-select"
              value={connections}
              onChange={(e) => setConnections(Number(e.currentTarget.value))}
            >
              {[1, 2, 4, 8, 16].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <label htmlFor="plim">Speed cap</label>
            <input
              id="plim"
              type="number"
              min={0}
              step={0.5}
              value={perLimitMbps}
              onChange={(e) => setPerLimitMbps(Math.max(0, Number(e.currentTarget.value) || 0))}
            />
            <span className="field-unit">MB/s · 0 = off</span>
          </div>
          <div className="field-row">
            <label htmlFor="sum">Checksum</label>
            <input
              id="sum"
              className="checksum-input"
              value={checksumText}
              onChange={(e) => setChecksumText(e.currentTarget.value)}
              spellCheck={false}
              placeholder="optional — MD5 / SHA-1 / SHA-256 / SHA-512"
            />
          </div>
        </div>

        <div className={`tab-panel ${tab === "advanced" ? "" : "tab-hidden"}`}>
          <div className="field-row">
            <label htmlFor="ua">User Agent</label>
            <input
              id="ua"
              value={userAgent}
              onChange={(e) => setUserAgent(e.currentTarget.value)}
              spellCheck={false}
              placeholder="optional"
            />
          </div>
          <div className="field-row">
            <label htmlFor="referer">Referer</label>
            <input
              id="referer"
              value={referer}
              onChange={(e) => setReferer(e.currentTarget.value)}
              spellCheck={false}
              placeholder="optional"
            />
          </div>
          <div className="field-row">
            <label htmlFor="cookie">Cookies</label>
            <input
              id="cookie"
              value={cookieText}
              onChange={(e) => setCookieText(e.currentTarget.value)}
              spellCheck={false}
              placeholder="key=value; key2=value2"
            />
          </div>
          <div className="field-row field-headers">
            <label htmlFor="hdr">Headers</label>
            <textarea
              id="hdr"
              value={headersText}
              onChange={(e) => setHeadersText(e.currentTarget.value)}
              spellCheck={false}
              rows={3}
              placeholder={"X-Custom-Header: value"}
            />
          </div>
        </div>
      </div>

      <div className="dialog-actions">
        <button onClick={() => act(true)} disabled={!url.trim()}>
          Download Later
        </button>
        <button onClick={() => invoke("close_add_window")}>Cancel</button>
        <button className="primary-btn" onClick={() => act(false)} disabled={!url.trim()}>
          Download
        </button>
      </div>
    </div>
  );
}

export default AddWindow;
