use tauri::{Emitter, Manager as _};

fn reveal_add_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("add") {
        let _ = w.show();
        let _ = w.set_focus();
    }
    if let Some(m) = app.get_webview_window("main") {
        let _ = m.set_enabled(false);
    }
}

/// Reveal the Add window for the "+" button case, and let it know it was
/// just opened so it can check the clipboard for a URL to prefill.
#[tauri::command]
#[specta::specta]
pub(crate) fn open_add_window(app: tauri::AppHandle) {
    reveal_add_window(&app);
    let _ = app.emit_to("add", "window-opened", ());
}

/// Reveal the Add window without the clipboard-prefill side effect above —
/// used once the Add window has already been prefilled from a captured
/// download (extension deep link) and just needs to become visible.
#[tauri::command]
#[specta::specta]
pub(crate) fn reveal_add_window_cmd(app: tauri::AppHandle) {
    reveal_add_window(&app);
}

/// Receive the form data from the add window, hand it to the main window,
/// hide the add window (kept alive for reuse), and re-enable + focus the main
/// window.
// Deliberately plain `#[tauri::command]` — no `#[specta::specta]`. This
// crate's `specta` (rc.25) overflows the stack while exporting a
// `serde_json::Value`-shaped command (verified in isolation: removing just
// this and `take_pending_deep_link` from the specta command list is what
// fixes it). `payload` really is opaque here — it's forwarded byte-for-byte
// to `main`'s `add-download` listener — so nothing is lost by leaving it on
// the plain invoke path; see `run()` in `lib.rs` for how the two handlers
// are combined.
#[tauri::command]
pub(crate) fn submit_add(app: tauri::AppHandle, payload: serde_json::Value) -> Result<(), String> {
    app.emit_to("main", "add-download", payload)
        .map_err(|e| e.to_string())?;
    if let Some(w) = app.get_webview_window("add") {
        let _ = w.hide();
    }
    if let Some(m) = app.get_webview_window("main") {
        let _ = m.set_enabled(true);
        let _ = m.set_focus();
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub(crate) fn close_add_window(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("add") {
        let _ = w.hide();
    }
    if let Some(m) = app.get_webview_window("main") {
        let _ = m.set_enabled(true);
        let _ = m.set_focus();
    }
}
