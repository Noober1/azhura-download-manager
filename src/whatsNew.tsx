import React from "react";
import ReactDOM from "react-dom/client";
import { MotionProvider } from "./components/MotionProvider";
import { WhatsNewWindow } from "./WhatsNewWindow";
import "./App.css";

// Entry point for the separate "What's New" native window (whats-new.html).
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <MotionProvider>
      <WhatsNewWindow />
    </MotionProvider>
  </React.StrictMode>,
);
