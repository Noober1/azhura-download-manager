import React from "react";
import ReactDOM from "react-dom/client";
import { MotionProvider } from "./components/MotionProvider";
import { AboutWindow } from "./AboutWindow";
import "./App.css";

// Entry point for the separate "About" native window (about.html).
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <MotionProvider>
      <AboutWindow />
    </MotionProvider>
  </React.StrictMode>,
);
