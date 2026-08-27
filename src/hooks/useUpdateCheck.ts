import { useCallback, useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { showToast } from "../toast";

/** What the update flow is currently doing. `idle` covers both "haven't looked
 *  yet" and "looked, nothing there" — the difference only matters to the manual
 *  check, which reports it through a toast rather than through this state. */
export type UpdateStage = "idle" | "checking" | "available" | "downloading" | "ready";

export type UpdateState = {
  stage: UpdateStage;
  /** Set once an update is found. Null in every other stage. */
  version: string | null;
  notes: string | null;
  /** 0-100 while `stage === "downloading"`, else 0. -1 when the total size is
   *  unknown, which the dialog renders as an indeterminate bar. */
  percent: number;
};

const IDLE: UpdateState = { stage: "idle", version: null, notes: null, percent: 0 };

export function useUpdateCheck() {
  const [state, setState] = useState<UpdateState>(IDLE);

  // The `Update` handle owns the download; it has to survive across the
  // "available" -> "downloading" gap while the user reads the prompt. A ref
  // rather than state because nothing renders from it, and because putting a
  // non-plain object in state invites accidental re-render churn.
  const updateRef = useRef<Update | null>(null);

  const dismiss = useCallback(() => {
    updateRef.current = null;
    setState(IDLE);
  }, []);

  /** `silent` is the launch check: no update simply means no UI. The manual
   *  check reports every outcome, including "you're up to date", because a
   *  button that looks like it did nothing is worse than a boring answer. */
  const runCheck = useCallback(async (silent: boolean) => {
    setState({ ...IDLE, stage: "checking" });
    let update: Update | null;
    try {
      update = await check();
    } catch (e) {
      updateRef.current = null;
      setState(IDLE);
      // Offline at launch is the common case and not worth interrupting for.
      if (!silent) showToast(`Couldn't check for updates: ${e}`, "error");
      return;
    }

    if (!update) {
      updateRef.current = null;
      setState(IDLE);
      if (!silent) showToast("You're on the latest version.", "info");
      return;
    }

    updateRef.current = update;
    setState({
      stage: "available",
      version: update.version,
      notes: update.body ?? null,
      percent: 0,
    });
  }, []);

  const checkNow = useCallback(() => runCheck(false), [runCheck]);

  const install = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;

    // `contentLength` arrives with the Started event, not up front, and some
    // servers omit it entirely — hence the -1 "indeterminate" case.
    let total = 0;
    let received = 0;
    setState((s) => ({ ...s, stage: "downloading", percent: 0 }));

    try {
      await update.downloadAndInstall((ev) => {
        if (ev.event === "Started") {
          total = ev.data.contentLength ?? 0;
        } else if (ev.event === "Progress") {
          received += ev.data.chunkLength;
          const pct = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : -1;
          setState((s) => ({ ...s, percent: pct }));
        } else if (ev.event === "Finished") {
          setState((s) => ({ ...s, percent: 100 }));
        }
      });
    } catch (e) {
      updateRef.current = null;
      setState(IDLE);
      showToast(`Update failed: ${e}`, "error");
      return;
    }

    // Installed but not yet running: on Windows the installer generally takes
    // the app down itself, so this stage is often never seen. It exists for
    // the case where it doesn't, so the user isn't left on a stale build with
    // no idea a restart is needed.
    setState((s) => ({ ...s, stage: "ready", percent: 100 }));
    try {
      await relaunch();
    } catch (e) {
      showToast(`Update installed — restart to finish. (${e})`, "info");
    }
  }, []);

  // One silent check per launch. Deliberately not on an interval: this app can
  // sit open for days, and a background check that pops a dialog mid-download
  // would interrupt exactly when the user cares least.
  const didLaunchCheck = useRef(false);
  useEffect(() => {
    if (didLaunchCheck.current) return;
    didLaunchCheck.current = true;
    runCheck(true);
  }, [runCheck]);

  return { state, checkNow, install, dismiss };
}
