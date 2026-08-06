use tauri::{Emitter, Manager as _};

/// Build (or reveal, if it already exists) a "Download Details" popup for one
/// download, labeled `detail-<id>` — every row gets its own window instead of
/// all of them fighting over a single reused one. Unlike the Add window,
/// `main` is never disabled: these are non-modal inspectors the user can
/// leave open while continuing to work in the main table.
///
/// The window is built hidden; `main`'s `detail-ready` handshake (once the
/// popup's own React tree has mounted and asked for its first snapshot) is
/// what actually shows it via `show_detail_window`, so there's never a flash
/// of an empty popup.
///
/// Must be `async`: a plain (blocking) command runs inline on the same thread
/// that pumps WebView2's IPC messages — i.e. the main/UI thread. Creating a
/// *new* OS window needs to hand off to that same thread's event loop and
/// wait for it, which can't happen while that thread is busy running us, so
/// a non-async version of this command deadlocks the whole app the moment it
/// tries to build the window. Being `async` moves execution onto a tokio
/// worker thread first, so the handoff to the real UI thread can complete.
#[tauri::command]
#[specta::specta]
pub(crate) async fn open_detail_window(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let label = format!("detail-{id}");
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        return Ok(());
    }

    let main = app
        .get_webview_window("main")
        .ok_or("main window is missing")?;

    // Cascade new popups a little so stacking several isn't pixel-identical.
    let existing = app
        .webview_windows()
        .keys()
        .filter(|l| l.starts_with("detail-"))
        .count();
    let offset = 28.0 * (existing % 6) as f64;

    let mut builder =
        tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App("detail.html".into()))
            .title("Download Details")
            .inner_size(620.0, 540.0)
            .min_inner_size(520.0, 420.0)
            .decorations(false)
            .visible(false)
            .shadow(true)
            .background_color(tauri::window::Color(0x1f, 0x1f, 0x1f, 0xff))
            .owner(&main)
            .map_err(|e| e.to_string())?;

    // `outer_position()` is physical pixels but `position()` takes logical
    // ones — skipping the conversion would place the popup off-screen on any
    // scaled display (125%/150%/etc, the Windows default on most laptops).
    if let (Ok(pos), Ok(scale)) = (main.outer_position(), main.scale_factor()) {
        let logical = pos.to_logical::<f64>(scale);
        builder = builder.position(logical.x + offset, logical.y + offset);
    }

    let w = builder.build().map_err(|e| e.to_string())?;
    super::harden_webview(&w);
    Ok(())
}

/// Show + focus a detail popup once its frontend has actually rendered the
/// snapshot `main` handed it (see `detail-ready` in `App.tsx`).
#[tauri::command]
#[specta::specta]
pub(crate) fn show_detail_window(app: tauri::AppHandle, id: String) {
    if let Some(w) = app.get_webview_window(&format!("detail-{id}")) {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Destroy one detail popup (they're created on demand now, not pooled) and
/// tell `main` it's gone so it stops pushing snapshots at it.
///
/// `async` for the same reason as `open_detail_window`: tearing down an OS
/// window is thread-affine like creating one, so this can't safely run
/// inline on the IPC/UI thread either.
#[tauri::command]
#[specta::specta]
pub(crate) async fn close_detail_window(app: tauri::AppHandle, id: String) {
    if let Some(w) = app.get_webview_window(&format!("detail-{id}")) {
        let _ = w.destroy();
    }
    let _ = app.emit_to("main", "detail-closed", id);
}
