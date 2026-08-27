// ---------------------------------------------------------------------------
// Post-queue power actions (sleep / shut down once downloads finish)
// ---------------------------------------------------------------------------
//
// Armed per session from the main window's status bar, never persisted — a
// setting that survived a restart could suspend the machine days later for a
// queue the user had forgotten about.
//
// Note this is an app-level command, and app commands (unlike plugin ones)
// aren't gated by `capabilities/` — every webview can invoke it. What actually
// contains that is the strict CSP in tauri.conf.json plus `harden_webview`, so
// no remote content ever runs in one of these windows. Relaxing either of
// those means revisiting this command.

/// Absolute path into System32. A bare `Command::new("shutdown")` would go
/// through `CreateProcess`'s search order, which checks the application
/// directory before the system one — the weakest link in an otherwise
/// closed-set call.
#[cfg(windows)]
fn system32(exe: &str) -> std::path::PathBuf {
    let root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".to_string());
    std::path::Path::new(&root).join("System32").join(exe)
}

#[tauri::command]
#[specta::specta]
pub(crate) fn run_power_action(action: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::process::Command;

        // Matched against a closed set rather than interpolated anywhere: this
        // string crosses the IPC boundary and ends in a process spawn.
        let mut cmd = match action.as_str() {
            "shutdown" => {
                let mut c = Command::new(system32("shutdown.exe"));
                c.args(["/s", "/t", "0"]);
                c
            }
            // `SetSuspendState` via FFI would need SE_SHUTDOWN_NAME enabled in
            // the process token first (a normal token has it present but
            // disabled), so it would just return false and do nothing without
            // an AdjustTokenPrivileges dance. rundll32 handles that itself.
            // Caveat: this hibernates rather than sleeps when hibernation is
            // enabled on the machine — a powrprof limitation, not a bug here.
            "sleep" => {
                let mut c = Command::new(system32("rundll32.exe"));
                c.args(["powrprof.dll,SetSuspendState", "0", "1", "0"]);
                c
            }
            _ => return Err("unknown power action".to_string()),
        };

        // Spawned, not waited on: on the shutdown path the OS is going down
        // underneath us, and blocking the IPC thread on that buys nothing.
        cmd.spawn().map_err(|e| e.to_string())?;
        Ok(())
    }

    #[cfg(not(windows))]
    {
        let _ = action;
        Err("power actions are only implemented on Windows".to_string())
    }
}
