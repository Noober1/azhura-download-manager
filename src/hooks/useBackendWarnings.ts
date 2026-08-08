import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import type { BackendWarning } from "../types";
import { showToast } from "../toast";

/** Listens for the Rust backend's generic one-off warning event (currently
 *  only a failed legacy category-folder migration — see `PendingMigrationWarnings`
 *  in `src-tauri/src/categories.rs`) and routes it into a toast. Main-window
 *  only: the backend always `emit_to("main", ...)`, never the add/detail windows. */
export function useBackendWarnings() {
  useEffect(() => {
    const unlisten = listen<BackendWarning>("backend-warning", (e) => {
      showToast(e.payload.message, e.payload.level);
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);
}
