import { useCallback, useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { commands } from "../bindings";
import { showToast } from "../toast";

/** How often to re-test window visibility while the launch check is deferred.
 *  Only ever runs on an autostart launch, and stops the moment the window is
 *  revealed. */
const VISIBILITY_POLL_MS = 4000;

/** Matches the grace period `quit_app` allows on the tray-quit path: long
 *  enough for the frontend's history flush and the meta writer to land before
 *  the installer terminates the process. */
const SHUTDOWN_GRACE_MS = 1200;

/** What the update flow is currently doing.
 *
 *  `downloading` is deliberately silent — no dialog, no toast. The user finds
 *  out when it's `ready` and there's something they can actually act on;
 *  telling them mid-download only offers a wait. */
export type UpdateStage = "idle" | "checking" | "downloading" | "ready" | "installing";

export type UpdateState = {
  stage: UpdateStage;
  /** Set from `downloading` onward. Null in every other stage. */
  version: string | null;
  /** 0-100 while downloading, -1 when the server sent no content length. */
  percent: number;
};

const IDLE: UpdateState = { stage: "idle", version: null, percent: 0 };

export function useUpdateCheck() {
  const [state, setState] = useState<UpdateState>(IDLE);

  // The `Update` handle owns the downloaded package; it has to survive from the
  // silent download all the way to whenever the user finally clicks install,
  // which may be days later. A ref rather than state because nothing renders
  // from it directly.
  const updateRef = useRef<Update | null>(null);

  // Declared up front so the callbacks below can reach the latest values
  // without taking each other as dependencies. Assigned further down, once
  // the values they mirror exist.
  const installRef = useRef<() => void>(() => {});
  const stageRef = useRef<UpdateStage>("idle");
  stageRef.current = state.stage;

  /** Downloads in the background and parks at `ready`. Never installs on its
   *  own: taking the app down uninvited would kill whatever the user was
   *  downloading. */
  const downloadSilently = useCallback(async (update: Update) => {
    updateRef.current = update;
    setState({ stage: "downloading", version: update.version, percent: 0 });

    let total = 0;
    let received = 0;
    try {
      await update.download((ev) => {
        if (ev.event === "Started") {
          total = ev.data.contentLength ?? 0;
        } else if (ev.event === "Progress") {
          received += ev.data.chunkLength;
          const pct = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : -1;
          setState((s) => ({ ...s, percent: pct }));
        }
      });
    } catch {
      // Silent by design: this download was never user-initiated, so a failed
      // one shouldn't produce an error the user didn't ask for. The next
      // launch, or a manual check, tries again.
      updateRef.current = null;
      setState(IDLE);
      return;
    }

    setState({ stage: "ready", version: update.version, percent: 100 });
    showToast(`Version ${update.version} is ready to install.`, "info", {
      label: "Restart now",
      // Read off the ref rather than closing over a local `install`: this
      // toast can sit on screen while the rest of the flow moves on.
      onClick: () => installRef.current(),
    });
  }, []);

  /** `silent` is the launch check: no update simply means no UI. The manual
   *  check reports every outcome, including "you're up to date", because a
   *  button that looks like it did nothing is worse than a boring answer. */
  const runCheck = useCallback(
    async (silent: boolean) => {
      // Already downloaded and waiting — re-checking would discard a finished
      // download to start the same one over.
      if (updateRef.current && stageRef.current === "ready") {
        if (!silent) showToast("An update is already downloaded and ready.", "info");
        return;
      }

      setState({ ...IDLE, stage: "checking" });
      let update: Update | null;
      try {
        update = await check();
      } catch (e) {
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

      if (!silent) showToast(`Downloading version ${update.version} in the background…`, "info");
      downloadSilently(update);
    },
    [downloadSilently],
  );

  const checkNow = useCallback(() => runCheck(false), [runCheck]);

  const install = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;
    setState((s) => ({ ...s, stage: "installing" }));

    // The installer terminates this process, bypassing the tray-quit path
    // entirely — so run that path's preparation by hand first: pause in-flight
    // downloads so their resume sidecars are written, and let the frontend
    // flush history instead of losing whatever was still inside its debounce.
    try {
      await commands.prepareForUpdate();
      await new Promise((r) => setTimeout(r, SHUTDOWN_GRACE_MS));
    } catch {
      // Preparation is best-effort; failing it is not a reason to strand the
      // user on a stale build with an update already downloaded.
    }

    try {
      await update.install();
    } catch (e) {
      setState({ stage: "ready", version: update.version, percent: 100 });
      showToast(`Update failed to install: ${e}`, "error");
      return;
    }

    // On Windows the installer usually takes the app down itself, so this is
    // often never reached. It exists for the case where it doesn't.
    try {
      await relaunch();
    } catch {
      showToast("Update installed — restart to finish.", "info");
    }
  }, []);

  installRef.current = install;

  // One silent check per launch. Deliberately not on an interval: this app can
  // sit open for days, and re-checking on a timer would mean discarding or
  // duplicating an already-downloaded update for no benefit.
  //
  // Held until the window is actually on screen. An autostart launch
  // (`--autostart`) deliberately stays hidden in the tray, and the ready-toast
  // would otherwise fire into a window nobody can see. Forcing the window open
  // would override the very setting the user chose, so this waits for them.
  const didLaunchCheck = useRef(false);
  useEffect(() => {
    if (didLaunchCheck.current) return;
    didLaunchCheck.current = true;

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    // `isVisible` failing is treated as visible: a missed update is a worse
    // outcome than one surfaced while the window happens to be hidden, and
    // this is the ordinary (non-autostart) path.
    async function checkIfVisible(): Promise<boolean> {
      const visible = await getCurrentWindow()
        .isVisible()
        .catch(() => true);
      if (cancelled || !visible) return false;
      runCheck(true);
      return true;
    }

    checkIfVisible().then((done) => {
      if (done || cancelled) return;
      timer = setInterval(() => {
        checkIfVisible().then((ok) => {
          if (ok && timer) clearInterval(timer);
        });
      }, VISIBILITY_POLL_MS);
    });

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [runCheck]);

  return { state, checkNow, install };
}
