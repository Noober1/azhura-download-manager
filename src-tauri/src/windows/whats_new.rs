use tauri::Manager as _;

/// Build (or, if one is already open, reveal and focus) the "What's New"
/// popup — a single window, labeled `whats-new`, opened by Help ▸ What's New
/// and automatically once per new version by `useWhatsNewAutoOpen`. Owned by
/// `main` (not modal), like the About popup.
///
/// Everything shown is bundled into the frontend (`CHANGELOG.md`), so there's
/// no async data to wait on and this builds straight to visible — see
/// `about.rs` for the same reasoning.
///
/// Must be `async` for the same thread-affinity reason as `open_about_window`:
/// creating a new OS window has to hand off to the event loop thread that a
/// blocking command would be occupying.
#[tauri::command]
#[specta::specta]
pub(crate) async fn open_whats_new_window(app: tauri::AppHandle) -> Result<(), String> {
    // Locked: do nothing rather than `Err(...)` — the Help menu item attaches
    // no `.catch()`, and the auto-open hook waits for unlock anyway.
    if crate::lock::is_locked(&app) {
        return Ok(());
    }
    if let Some(w) = app.get_webview_window("whats-new") {
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }

    let main = app.get_webview_window("main").ok_or("main window is missing")?;

    let mut builder = tauri::WebviewWindowBuilder::new(
        &app,
        "whats-new",
        tauri::WebviewUrl::App("whats-new.html".into()),
    )
    .title("What's New")
    .inner_size(560.0, 620.0)
    .min_inner_size(440.0, 420.0)
    .decorations(false)
    .visible(false)
    .shadow(true)
    .background_color(tauri::window::Color(0x1f, 0x1f, 0x1f, 0xff))
    .owner(&main)
    .map_err(|e| e.to_string())?;

    // Physical-to-logical conversion, same as the other popups — skipping it
    // misplaces the window on scaled displays.
    if let (Ok(pos), Ok(scale)) = (main.outer_position(), main.scale_factor()) {
        let logical = pos.to_logical::<f64>(scale);
        builder = builder.position(logical.x + 60.0, logical.y + 40.0);
    }

    let w = builder.build().map_err(|e| e.to_string())?;
    super::harden_webview(&w);
    let _ = w.show();
    Ok(())
}

/// Destroys the What's New popup — created on demand, not pooled.
///
/// `async` for the same reason as `open_whats_new_window`.
#[tauri::command]
#[specta::specta]
pub(crate) async fn close_whats_new_window(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("whats-new") {
        let _ = w.destroy();
    }
}
