import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { commands } from "./bindings";
import { WindowControls, useNativeShell } from "./ui";
import { useTheme } from "./theme";
import "./App.css";

const REPO_URL = "https://github.com/Noober1/azhura-download-manager";

/* The separate native "About" popup, opened by clicking the app name in
   main's status bar. Purely static content — version, description, tech
   stack, license, repo link — so unlike Archive Preview/Details there's no
   loading state to show. */
export function AboutWindow() {
  useNativeShell();
  useTheme();

  const [version, setVersion] = useState("");

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => {});
  }, []);

  function close() {
    commands.closeAboutWindow();
  }

  function openRepo() {
    openUrl(REPO_URL).catch(() => {});
  }

  return (
    <div className="add-window about-window">
      <div className="dialog-head add-head" data-tauri-drag-region>
        <span>About</span>
        <WindowControls variant="close" />
      </div>

      <div className="dialog-body about-body">
        <div className="about-name">Azhura Download Manager</div>
        <div className="about-version tabular">{version ? `Version ${version}` : ""}</div>

        <p className="about-desc">
          Download files from the internet faster, tidier, and more in control than a
          browser's own downloader — multi-connection downloads, pause/resume, scheduling,
          and a browser extension to grab links straight from the page.
        </p>

        <div className="about-row">
          <span className="about-label">Built with</span>
          <span className="about-value">Tauri 2 · Rust · React · TypeScript · Vite</span>
        </div>
        <div className="about-row">
          <span className="about-label">License</span>
          <span className="about-value">MIT License · Copyright (c) 2026 Azhura</span>
        </div>
        <div className="about-row">
          <span className="about-label">Source</span>
          <button type="button" className="about-link" onClick={openRepo}>
            {REPO_URL.replace("https://", "")}
          </button>
        </div>
      </div>

      <div className="dialog-actions">
        <button className="primary-btn" onClick={close}>
          Close
        </button>
      </div>
    </div>
  );
}

export default AboutWindow;
