import { invoke } from "@tauri-apps/api/core";
import { WindowControls, useNativeShell } from "./ui";
import { useTheme } from "./theme";
import { useAddForm } from "./hooks/useAddForm";
import { LinkTab } from "./components/add/LinkTab";
import { ProxyTab } from "./components/add/ProxyTab";
import { MoreOptionsTab } from "./components/add/MoreOptionsTab";
import { AdvancedTab } from "./components/add/AdvancedTab";
import "./App.css";

/* The separate native "Add Download" window (Persepolis-style). Collects the
   form across Link / Proxy / More Options / Advanced Options tabs and hands
   it to the main window via the `submit_add` command. */
export function AddWindow() {
  useNativeShell();
  useTheme();

  const form = useAddForm();
  const { state, patch, tab, setTab } = form;

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
          Proxy{form.effectiveProxy.enabled ? " · on" : ""}
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
          Advanced Options{form.headerCount > 0 ? ` · ${form.headerCount}` : ""}
        </button>
      </div>

      <div className="dialog-body">
        {state.pendingInsecure && (
          <div className="inline-warn">
            <strong>⚠ Insecure http://</strong> — not encrypted. Add anyway?
            <div className="inline-warn-actions">
              <button className="danger" onClick={() => form.send(state.pendingLater, true)}>
                Add anyway
              </button>
              <button onClick={() => patch({ pendingInsecure: false })}>Back</button>
            </div>
          </div>
        )}

        <LinkTab
          active={tab === "link"}
          state={state}
          patch={patch}
          act={form.act}
          runProbe={form.runProbe}
          showCheckSizeButton={form.showCheckSizeButton}
          size={form.size}
        />
        <ProxyTab active={tab === "proxy"} state={state} patch={patch} />
        <MoreOptionsTab
          active={tab === "more"}
          state={state}
          patch={patch}
          currentCategory={form.currentCategory}
          savePathPlaceholder={form.savePathPlaceholder}
          onBrowseSavePath={form.browseSavePath}
        />
        <AdvancedTab active={tab === "advanced"} state={state} patch={patch} />
      </div>

      <div className="dialog-actions">
        <button onClick={() => form.act(true)} disabled={!state.url.trim()}>
          Download Later
        </button>
        <button onClick={() => invoke("close_add_window")}>Cancel</button>
        <button className="primary-btn" onClick={() => form.act(false)} disabled={!state.url.trim()}>
          Download
        </button>
      </div>
    </div>
  );
}

export default AddWindow;
