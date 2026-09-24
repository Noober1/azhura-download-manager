import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import changelogMd from "../CHANGELOG.md?raw";
import { commands } from "./bindings";
import { parseChangelog, splitInline } from "./changelog";
import { WindowControls, useNativeShell } from "./ui";
import { useTheme } from "./theme";
import "./App.css";

const ENTRIES = parseChangelog(changelogMd);

function Inline({ text }: { text: string }) {
  return (
    <>
      {splitInline(text).map((seg, i) => {
        if (seg.kind === "code") return <code key={i}>{seg.text}</code>;
        if (seg.kind === "bold") return <strong key={i}>{seg.text}</strong>;
        return seg.text;
      })}
    </>
  );
}

/* The separate native "What's New" popup: the bundled CHANGELOG.md, newest
   version first. Opened by Help ▸ What's New and once per new version by
   `useWhatsNewAutoOpen` in main. */
export function WhatsNewWindow() {
  useNativeShell();
  useTheme();

  const [version, setVersion] = useState("");

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => {});
  }, []);

  function close() {
    commands.closeWhatsNewWindow();
  }

  return (
    <div className="add-window about-window">
      <div className="dialog-head add-head" data-tauri-drag-region>
        <span>What's New</span>
        <WindowControls variant="close" />
      </div>

      <div className="dialog-body whats-new-body">
        {ENTRIES.length === 0 && <p className="wn-empty">No release notes available.</p>}
        {ENTRIES.map((entry) => (
          <article className="wn-entry" key={entry.version}>
            <h2 className="wn-version">
              Version {entry.version}
              {entry.version === version && <span className="wn-current">Installed</span>}
            </h2>
            <div className="wn-date tabular">{entry.date ?? "Unreleased"}</div>
            {entry.sections.map((section, si) => (
              <div key={si}>
                {section.title && <h3 className="wn-section">{section.title}</h3>}
                <ul className="wn-list">
                  {section.items.map((item, ii) => (
                    <li key={ii}>
                      <Inline text={item} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </article>
        ))}
      </div>

      <div className="dialog-actions">
        <button className="primary-btn" onClick={close}>
          Close
        </button>
      </div>
    </div>
  );
}

export default WhatsNewWindow;
