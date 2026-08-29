import React from "react";
import ReactDOM from "react-dom/client";
import { MotionProvider } from "./components/MotionProvider";
import { ArchiveWindow } from "./ArchiveWindow";
import "./App.css";

// Entry point for the separate "Archive Contents" native window (archive.html).
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <MotionProvider>
      <ArchiveWindow />
    </MotionProvider>
  </React.StrictMode>,
);
