import React from "react";
import ReactDOM from "react-dom/client";
import { MotionProvider } from "./components/MotionProvider";
import { DetailWindow } from "./DetailWindow";
import "./App.css";

// Entry point for the separate "Download Details" native window (detail.html).
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <MotionProvider>
      <DetailWindow />
    </MotionProvider>
  </React.StrictMode>,
);
