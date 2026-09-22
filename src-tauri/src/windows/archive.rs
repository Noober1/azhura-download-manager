use std::sync::Mutex;

use tauri::{Emitter, Manager as _};

use crate::archive::ArchiveRequest;

/// Holds the "Preview contents" request between `open_archive_window`
/// (called from the Add window, before the preview window's own React tree
/// has mounted) and that window's own `take_archive_request` call once it
/// has — the same stash-and-collect handshake `PendingDeepLink` uses for the
/// Add window's deep-link prefill.
#[derive(Default)]
pub(crate) struct PendingArchiveRequest(Mutex<Option<ArchiveRequest>>);

/// Build (or, if one is already open, reveal and refresh) the "Preview
/// archive" popup for `req`, labeled `archive-preview` — a single window,
/// unlike the per-download `detail-<id>` popups, since only one preview is
/// ever relevant at a time. Owned by the Add window (not `main`) so it
/// floats above the modal Add dialog it was opened from, and is destroyed
/// (not hidden-and-reused) when closed — see `close_archive_window`.
///
/// Built hidden: the frontend calls `show_archive_window` itself once it has
/// taken the stashed request and has at least a "Scanning…" state to show,
/// so there's never a flash of an empty popup. When reusing an
/// already-open window instead, there's no such gap to avoid — it's shown
/// immediately, and `archive-window-opened` tells its already-mounted React
/// tree to collect the new request and re-scan.
///
/// Must be `async`: a plain (blocking) command runs inline on the same
/// thread that pumps WebView2's IPC messages — i.e. the main/UI thread.
/// Creating a *new* OS window needs to hand off to that same thread's event
/// loop and wait for it, which can't happen while that thread is busy
/// running us, so a non-async version of this command deadlocks the whole
/// app the moment it tries to build the window.
#[tauri::command]
#[specta::specta]
pub(crate) async fn open_archive_window(app: tauri::AppHandle, req: ArchiveRequest) -> Result<(), String> {
    if crate::lock::is_locked(&app) {
        return Err("App is locked".into());
    }
    app.state::<PendingArchiveRequest>().0.lock().unwrap().replace(req);

    if let Some(w) = app.get_webview_window("archive-preview") {
        let _ = w.show();
        let _ = w.set_focus();
        let _ = app.emit_to("archive-preview", "archive-window-opened", ());
        return Ok(());
    }

    let add = app.get_webview_window("add").ok_or("add window is missing")?;

    let mut builder = tauri::WebviewWindowBuilder::new(
        &app,
        "archive-preview",
        tauri::WebviewUrl::App("archive.html".into()),
    )
    .title("Archive Contents")
    .inner_size(720.0, 620.0)
    .min_inner_size(560.0, 420.0)
    .decorations(false)
    .visible(false)
    .shadow(true)
    .background_color(tauri::window::Color(0x1f, 0x1f, 0x1f, 0xff))
    .owner(&add)
    .map_err(|e| e.to_string())?;

    // Same physical-to-logical conversion as `open_detail_window` — skipping
    // it misplaces the popup on any scaled display (125%/150%/etc).
    if let (Ok(pos), Ok(scale)) = (add.outer_position(), add.scale_factor()) {
        let logical = pos.to_logical::<f64>(scale);
        builder = builder.position(logical.x + 32.0, logical.y + 32.0);
    }

    let w = builder.build().map_err(|e| e.to_string())?;
    super::harden_webview(&w);
    Ok(())
}

/// Show + focus the preview popup once its own React tree has taken the
/// stashed request and has something to display.
#[tauri::command]
#[specta::specta]
pub(crate) fn show_archive_window(app: tauri::AppHandle) {
    if crate::lock::is_locked(&app) {
        return;
    }
    if let Some(w) = app.get_webview_window("archive-preview") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[tauri::command]
#[specta::specta]
pub(crate) fn take_archive_request(state: tauri::State<'_, PendingArchiveRequest>) -> Option<ArchiveRequest> {
    state.0.lock().unwrap().take()
}

/// Destroys the preview popup — created on demand, not pooled like the Add
/// window, so there's nothing to hide-and-reuse here; the next "Preview
/// contents" click just builds a fresh one.
///
/// `async` for the same reason as `open_archive_window`: tearing down an OS
/// window is thread-affine like creating one.
#[tauri::command]
#[specta::specta]
pub(crate) async fn close_archive_window(app: tauri::AppHandle) {
    close_if_open(&app);
}

/// Shared by the explicit "Close" button path above and by every place the
/// Add window itself closes — a preview window is only ever meaningful
/// alongside the dialog it was opened from, so it shouldn't outlive it.
pub(crate) fn close_if_open(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("archive-preview") {
        let _ = w.destroy();
    }
}
