import React from "react";
import ReactDOM from "react-dom/client";
import { MotionProvider } from "./components/MotionProvider";
import { AddWindow } from "./AddWindow";
import "./App.css";

// Entry point for the separate "Add Download" native window (add.html).
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <MotionProvider>
      <AddWindow />
    </MotionProvider>
  </React.StrictMode>,
);
