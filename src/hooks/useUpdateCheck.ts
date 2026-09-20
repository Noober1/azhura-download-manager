import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { commands, type UpdateInfo } from "../bindings";
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
 *  `downloading` is deliberately silent from here on out — no dialog, no
 *  progress. The user finds out when it's `ready` and there's something they
 *  can actually act on; telling them mid-download only offers a wait. (A
 *  manual check does get one toast right as the download starts — see the
 *  `update-downloading` listener below — but nothing more until it's ready.) */
export type UpdateStage = "idle" | "checking" | "downloading" | "ready" | "installing";

export type UpdateState = {
  stage: UpdateStage;
  /** Set from `downloading` onward. Null in every other stage. */
  version: string | null;
  /** The feed marked this release `critical` — see `download_update` in
   *  `update.rs`, which computes it (only a literal `true` counts). Such an
   *  update is not left sitting behind a link the user can ignore. */
  critical: boolean;
};

const IDLE: UpdateState = { stage: "idle", version: null, critical: false };

/** Checking, downloading and installing all happen in Rust now (see
 *  `src-tauri/src/update.rs`) — the JS updater plugin's own `install()`
 *  always relaunches the app and, in its default mode, shows an installer
 *  window, neither of which a silent "install on quit" can tolerate. This
 *  hook is left driving the *flow* (when to check, what to show) while Rust
 *  owns the update package itself, from download through to the installer
 *  spawn.
 *
 *  `onRequestInstall` fires when the user accepts the ready-toast (or a
 *  critical update arrives). It asks for the restart rather than performing
 *  it: restarting interrupts whatever is downloading, so the decision
 *  belongs behind a confirmation the caller owns (it's the one that knows
 *  how many downloads are in flight). */
export function useUpdateCheck(onRequestInstall: () => void) {
  const [state, setState] = useState<UpdateState>(IDLE);

  // Declared up front so the callbacks below can reach the latest values
  // without taking each other as dependencies.
  const requestInstallRef = useRef(onRequestInstall);
  requestInstallRef.current = onRequestInstall;
  const stageRef = useRef<UpdateStage>("idle");
  stageRef.current = state.stage;

  // Set by `checkNow` right before it asks Rust to check — read by the
  // `update-downloading` listener below to decide whether this particular
  // download deserves the "Downloading version X…" toast. The silent launch
  // check never sets this, so it stays exactly as quiet as it always has.
  const manualRef = useRef(false);

  /** `silent` is the launch check: no update simply means no UI. The manual
   *  check reports every outcome, including "you're up to date", because a
   *  button that looks like it did nothing is worse than a boring answer. */
  const runCheck = useCallback(async (silent: boolean) => {
    // Already downloaded and waiting — re-checking would discard a finished
    // download to start the same one over.
    if (stageRef.current === "ready") {
      if (!silent) showToast("An update is already downloaded and ready.", "info");
      return;
    }

    setState({ stage: "checking", version: null, critical: false });
    let info: UpdateInfo | null;
    try {
      info = await commands.downloadUpdate();
    } catch (e) {
      setState(IDLE);
      // Offline at launch is the common case and not worth interrupting for.
      if (!silent) showToast(`Couldn't check for updates: ${e}`, "error");
      return;
    }

    if (!info) {
      setState(IDLE);
      if (!silent) showToast("You're on the latest version.", "info");
      return;
    }

    setState({ stage: "ready", version: info.version, critical: info.critical });

    // A critical update is never left behind a link the user can ignore. It
    // still goes through the prompt rather than restarting underneath them —
    // the dialog just won't take no for an answer (see `critical` in
    // UpdateRestartDialog).
    if (info.critical) {
      requestInstallRef.current();
      return;
    }

    showToast(`Version ${info.version} is ready to install.`, "info", {
      label: "Restart now",
      // Opens the confirmation rather than installing outright — this toast
      // can be clicked while a download is mid-flight. Read off the ref
      // because the toast outlives the render that created it.
      onClick: () => requestInstallRef.current(),
    });
  }, []);

  const checkNow = useCallback(() => {
    manualRef.current = true;
    return runCheck(false);
  }, [runCheck]);

  const install = useCallback(async () => {
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

    // `install_pending_update` spawns the installer and exits this process
    // itself (`std::process::exit(0)`) on success — nothing after this call
    // normally runs. It only returns (with an error) when the spawn failed.
    try {
      await commands.installPendingUpdate();
    } catch (e) {
      setState((s) => ({ ...s, stage: "ready" }));
      showToast(`Update failed to install: ${e}`, "error");
    }
  }, []);

  // Rust emits this right before the (possibly slow) download starts, once
  // `downloadUpdate` has already confirmed a real update is available. The
  // launch check never shows anything for it; a manual check gets the same
  // "downloading in the background" toast the old JS-side flow always gave.
  useEffect(() => {
    const unlisten = listen<UpdateInfo>("update-downloading", (e) => {
      const { version, critical } = e.payload;
      setState({ stage: "downloading", version, critical });
      if (manualRef.current) {
        showToast(`Downloading version ${version} in the background…`, "info");
      }
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

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

      // A pending update survives across restarts (it's a file on disk, not
      // an in-memory handle) — check for one before re-hitting the feed, so
      // a launch right after a missed silent install doesn't re-download.
      const pending = await commands.pendingUpdate();
      if (pending) {
        setState({ stage: "ready", version: pending.version, critical: pending.critical });
        if (pending.critical) requestInstallRef.current();
      } else {
        runCheck(true);
      }
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
