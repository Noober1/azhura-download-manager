import React from "react";
import ReactDOM from "react-dom/client";
import { MotionProvider } from "./components/MotionProvider";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <MotionProvider>
      <App />
    </MotionProvider>
  </React.StrictMode>,
);
