use tauri::Manager as _;

/// Build (or, if one is already open, reveal and focus) the "About" popup —
/// a single window, labeled `about`, triggered by clicking the app name in
/// `main`'s status bar. Owned by `main` (not modal — `main` stays usable
/// while it's open, like the per-download detail popups).
///
/// Unlike the Archive Preview window, there's no async data to wait on —
/// everything shown (version, license, repo link) is either static or a
/// near-instant local read — so this builds straight to `.visible(true)`
/// rather than the build-hidden/`show_*`-once-ready handshake `archive.rs`
/// uses to avoid a flash of empty content while a real network scan runs.
///
/// Must be `async`: a plain (blocking) command runs inline on the same
/// thread that pumps WebView2's IPC messages, and creating a *new* OS window
/// needs to hand off to that same thread's event loop — see the identical
/// reasoning in `open_archive_window` and `open_detail_window`.
#[tauri::command]
#[specta::specta]
pub(crate) async fn open_about_window(app: tauri::AppHandle) -> Result<(), String> {
    // Locked: do nothing rather than `Err(...)` — neither call site in
    // `App.tsx` attaches a `.catch()`, so an error here would surface as an
    // uncaught promise rejection instead of anything the user'd notice.
    if crate::lock::is_locked(&app) {
        return Ok(());
    }
    if let Some(w) = app.get_webview_window("about") {
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }

    let main = app.get_webview_window("main").ok_or("main window is missing")?;

    let mut builder =
        tauri::WebviewWindowBuilder::new(&app, "about", tauri::WebviewUrl::App("about.html".into()))
            .title("About")
            .inner_size(480.0, 520.0)
            .min_inner_size(420.0, 460.0)
            .decorations(false)
            .visible(false)
            .shadow(true)
            .background_color(tauri::window::Color(0x1f, 0x1f, 0x1f, 0xff))
            .owner(&main)
            .map_err(|e| e.to_string())?;

    // Same physical-to-logical conversion `open_detail_window`/
    // `open_archive_window` use — skipping it misplaces the popup on any
    // scaled display (125%/150%/etc).
    if let (Ok(pos), Ok(scale)) = (main.outer_position(), main.scale_factor()) {
        let logical = pos.to_logical::<f64>(scale);
        builder = builder.position(logical.x + 60.0, logical.y + 40.0);
    }

    let w = builder.build().map_err(|e| e.to_string())?;
    super::harden_webview(&w);
    let _ = w.show();
    Ok(())
}

/// Destroys the About popup — created on demand, not pooled, so the next
/// click just builds a fresh one.
///
/// `async` for the same reason as `open_about_window`: tearing down an OS
/// window is thread-affine like creating one.
#[tauri::command]
#[specta::specta]
pub(crate) async fn close_about_window(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("about") {
        let _ = w.destroy();
    }
}
