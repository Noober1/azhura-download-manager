import type { ReactNode } from "react";
import { motion } from "motion/react";
import { commands } from "./bindings";
import { WindowControls, useNativeShell } from "./ui";
import { useTheme } from "./theme";
import { useAddForm } from "./hooks/useAddForm";
import { LinkTab } from "./components/add/LinkTab";
import { ProxyTab } from "./components/add/ProxyTab";
import { MoreOptionsTab } from "./components/add/MoreOptionsTab";
import { AdvancedTab } from "./components/add/AdvancedTab";
import { LAYOUT_SPRING } from "./motion";
import "./App.css";

/* A single tab button. The active one gets a `motion.div` sharing
   `layoutId="tab-active"` with every other tab's — motion animates it
   sliding to the new tab instead of the highlight just jumping. */
function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className={`tab ${active ? "active" : ""}`} onClick={onClick}>
      {active && (
        <motion.div className="tab-indicator" layoutId="tab-active" transition={LAYOUT_SPRING} />
      )}
      <span className="tab-label">{children}</span>
    </button>
  );
}

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
        <TabButton active={tab === "link"} onClick={() => setTab("link")}>
          Link
        </TabButton>
        <TabButton active={tab === "proxy"} onClick={() => setTab("proxy")}>
          Proxy{form.effectiveProxy.enabled ? " · on" : ""}
        </TabButton>
        <TabButton active={tab === "more"} onClick={() => setTab("more")}>
          More Options
        </TabButton>
        <TabButton active={tab === "advanced"} onClick={() => setTab("advanced")}>
          Advanced Options{form.headerCount > 0 ? ` · ${form.headerCount}` : ""}
        </TabButton>
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
        <button onClick={() => commands.closeAddWindow()}>Cancel</button>
        <button className="primary-btn" onClick={() => form.act(false)} disabled={!state.url.trim()}>
          Download
        </button>
      </div>
    </div>
  );
}

export default AddWindow;
