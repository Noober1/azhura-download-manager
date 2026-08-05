pub(crate) mod add;
pub(crate) mod detail;

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::{Emitter, Manager as _};

use crate::engine::control::Manager;

/// Set when the tray "Quit" item fires, so `CloseRequested`'s hide-to-tray
/// intercept lets the real close through instead of looping back to hidden.
pub(crate) struct Quitting(pub(crate) AtomicBool);

/// Show + focus the (hidden-at-startup) "Add Download" window — it's owned by
/// `main` (see `setup()`), so it's always above `main` in z-order without
/// needing an explicit always-on-top flag. Also disable `main` so clicking it
/// is a no-op until the add window closes (a real, OS-level modal — not just
/// visual stacking).
/// Bring `main` back from the tray: clear the modal-disable left over from
/// the Add window trick, undo a minimize, show, and focus.
///
/// The disable is only cleared when the Add window isn't actually on screen.
/// A *visible* Add window holds a real, OS-level modal disable on `main`, and
/// this function is reachable from the tray (left-click, "Show", and the
/// per-download entries) while that dialog is open — re-enabling `main` there
/// would leave both windows interactive at once.
pub(crate) fn reveal_main_window(app: &tauri::AppHandle) {
    let add = app
        .get_webview_window("add")
        .filter(|w| w.is_visible().unwrap_or(false));

    if let Some(m) = app.get_webview_window("main") {
        if add.is_none() {
            let _ = m.set_enabled(true);
        }
        let _ = m.unminimize();
        let _ = m.show();
        let _ = m.set_focus();
    }

    // `main` can't take input while the modal is up, so hand focus to the
    // dialog that's actually blocking it rather than leaving it ambiguous.
    if let Some(w) = add {
        let _ = w.set_focus();
    }
}

/// Send `main` (and the owned Add/Details windows, if open) to the tray
/// without destroying any webview — downloads and the React scheduler keep
/// running, they're just not visible.
pub(crate) fn hide_to_tray(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("add") {
        let _ = w.hide();
    }
    for (label, w) in app.webview_windows() {
        if label.starts_with("detail-") {
            let _ = w.hide();
        }
    }
    if let Some(m) = app.get_webview_window("main") {
        let _ = m.set_enabled(true);
        let _ = m.hide();
    }
}

/// Tray "Quit": pause every in-flight download so its resume sidecar is
/// flushed immediately (mirrors `pause_download`), give the periodic meta
/// writer a moment to catch up, then actually exit.
pub(crate) fn quit_app(app: &tauri::AppHandle) {
    app.state::<Quitting>().0.store(true, Ordering::Relaxed);
    for c in app.state::<Manager>().downloads.lock().unwrap().values() {
        c.paused.store(true, Ordering::Relaxed);
    }
    // Lets the frontend flush its download history immediately instead of
    // waiting out its debounce, which would otherwise eat most of the grace
    // period below.
    let _ = app.emit_to("main", "app-quitting", ());
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(1000)).await;
        handle.exit(0);
    });
}

/// Strip the browser-isms out of a WebView2 host: the find bar (Ctrl+F), reload
/// (F5/Ctrl+R), print, caret browsing (F7), zoom, the link-hover status bubble,
/// the default context menu, pinch-zoom and swipe-to-navigate. Without this the
/// app behaves like a web page in a frame no matter what the JS layer does,
/// because these are host accelerators, not page key events.
pub(crate) fn harden_webview(window: &tauri::WebviewWindow) {
    #[cfg(windows)]
    {
        let _ = window.with_webview(|webview| unsafe {
            use webview2_com::Microsoft::Web::WebView2::Win32::{
                ICoreWebView2Settings3, ICoreWebView2Settings5, ICoreWebView2Settings6,
            };
            use windows::core::Interface;
            let Ok(core) = webview.controller().CoreWebView2() else { return };
            let Ok(settings) = core.Settings() else { return };
            let _ = settings.SetAreDefaultContextMenusEnabled(false);
            let _ = settings.SetIsStatusBarEnabled(false);
            let _ = settings.SetIsZoomControlEnabled(false);
            #[cfg(not(debug_assertions))]
            let _ = settings.SetAreDevToolsEnabled(false);
            if let Ok(s) = settings.cast::<ICoreWebView2Settings3>() {
                let _ = s.SetAreBrowserAcceleratorKeysEnabled(false);
            }
            if let Ok(s) = settings.cast::<ICoreWebView2Settings5>() {
                let _ = s.SetIsPinchZoomEnabled(false);
            }
            if let Ok(s) = settings.cast::<ICoreWebView2Settings6>() {
                let _ = s.SetIsSwipeNavigationEnabled(false);
            }
        });
    }
    #[cfg(not(windows))]
    let _ = window;
}
