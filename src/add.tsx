import React from "react";
import ReactDOM from "react-dom/client";
import { MotionConfig } from "motion/react";
import { AddWindow } from "./AddWindow";
import "./App.css";

// Entry point for the separate "Add Download" native window (add.html).
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <MotionConfig reducedMotion="user">
      <AddWindow />
    </MotionConfig>
  </React.StrictMode>,
);
