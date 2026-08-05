// Download engine.
// v3: dynamic segmentation via a shared piece queue. The file is split into
// many small pieces; N workers each pull the next piece as soon as they finish
// one, so fast connections naturally do more work and no connection sits idle
// while a slow one finishes. Per-piece completion is persisted for resume.

mod categories;
mod commands;
mod config;
mod deeplink;
mod engine;
mod paths;
mod tray;
mod windows;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager as _};

use categories::CATEGORY_FOLDERS;
use config::prefs::PrefsState;
use config::settings::SettingsState;
use deeplink::{deep_link_from_args, handle_deep_link, handle_deep_link_cold_start, PendingDeepLink};
use engine::control::Manager;
use paths::downloads_base;
use tray::{rebuild_tray_menu, TrayMenuState};
use windows::{harden_webview, quit_app, reveal_main_window, Quitting};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // Must be registered before other plugins: routes an `adm://` URL passed
    // to a second launch into this (already running) instance instead of
    // spawning a duplicate process.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(link) = deep_link_from_args(argv) {
                handle_deep_link(app, &link);
            } else {
                // Plain second launch (no deep link) while we're already
                // running, possibly hidden in the tray — surface the window
                // instead of doing nothing.
                reveal_main_window(app);
            }
        }));
    }

    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(Manager::default())
        .manage(PendingDeepLink::default())
        .manage(SettingsState(Mutex::new(config::settings::load_settings_from_disk())))
        .manage(PrefsState(Mutex::new(config::prefs::load_prefs_from_disk())))
        .manage(Quitting(AtomicBool::new(false)))
        .manage(TrayMenuState::default())
        .setup(|app| {
            // Built here (rather than declared in tauri.conf.json) so it can be
            // given `main` as its OS-level owner: an owned window is always
            // above its owner in z-order, but — unlike always-on-top — it has
            // no effect on other applications, so switching focus away to
            // another app is unaffected.
            let main = app
                .get_webview_window("main")
                .expect("main window is declared in tauri.conf.json");
            harden_webview(&main);
            let add = tauri::WebviewWindowBuilder::new(app, "add", tauri::WebviewUrl::App("add.html".into()))
                .title("Add Download")
                .inner_size(610.0, 465.0)
                .min_inner_size(528.0, 400.0)
                .decorations(false)
                .visible(false)
                .shadow(true)
                .background_color(tauri::window::Color(0x1f, 0x1f, 0x1f, 0xff))
                .owner(&main)?
                .build()?;
            harden_webview(&add);

            // Per-download "Download Details" popups are created on demand by
            // `open_detail_window` (labeled `detail-<id>`) rather than built
            // here, so each download can have its own independent popup.

            // Tray icon: left-click shows/focuses `main`, the menu offers the
            // same plus a real Quit (closing `main` normally just hides it —
            // see `on_window_event` below). The download rows in between are
            // pushed live by `update_tray_downloads` once the frontend is up.
            //
            // Built through that same helper with an empty list so the initial
            // menu already carries the "No active downloads" placeholder that
            // an empty `TrayMenuState` stands for. Hand-rolling a different
            // menu here would desync the two: the first push is also empty, so
            // it takes the no-op `same_shape` path and would never replace it.
            let (tray_menu, _) = rebuild_tray_menu(app.handle(), &[])
                .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
            TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().cloned().expect("app icon is configured in tauri.conf.json"))
                .tooltip("Azhura Download Manager")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => reveal_main_window(app),
                    "quit" => quit_app(app),
                    id if id.starts_with("dl:") => {
                        reveal_main_window(app);
                        let download_id = id.trim_start_matches("dl:").to_string();
                        let _ = app.emit_to("main", "tray-open-detail", download_id);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        reveal_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            // Registers the `adm` scheme at runtime (dev builds only need
            // this — a bundled installer registers it via the `deep-link`
            // plugin config in tauri.conf.json).
            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();
            }

            // Covers macOS/Linux "open URL" OS events, delivered after
            // startup rather than as a plain argv entry.
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    if let Some(link) = event.urls().first() {
                        handle_deep_link(&handle, link.as_str());
                    }
                });
            }

            // Cold start on Windows: the deep-link plugin only auto-fires
            // for *subsequent* launches (relayed via single-instance), so a
            // fresh launch with `adm://...` as an argument has to be
            // detected here instead.
            if let Some(link) = deep_link_from_args(std::env::args()) {
                handle_deep_link_cold_start(&app.handle().clone(), &link);
            }

            // Pre-create the category folders so they show up (even empty) as
            // soon as the app is installed. Best-effort: `move_to_destination`
            // creates whichever one it actually needs anyway, so a failure
            // here just means the folder appears a bit later.
            if let Ok(base) = downloads_base() {
                for name in CATEGORY_FOLDERS {
                    let _ = std::fs::create_dir_all(base.join(name));
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| match window.label() {
            // The add window is reused, so its titlebar close button just
            // hides it — this is the one hide path that bypasses the
            // `submit_add`/`close_add_window` commands, so main's re-enable +
            // refocus has to be duplicated here too.
            "add" => {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                    if let Some(m) = window.get_webview_window("main") {
                        let _ = m.set_enabled(true);
                        let _ = m.set_focus();
                    }
                }
            }
            // The detail popup is reused too, and — unlike "add" — never
            // disabled `main`, so there's nothing to re-enable here; just
            // hide and let `main` know so it stops pushing `detail-data`.
            label if label.starts_with("detail-") => {
                // Per-download popups are created on demand, so let the close
                // through and just tell `main` to stop pushing snapshots at
                // this one (unlike "add" above, there's nothing to hide-and-reuse).
                if let tauri::WindowEvent::CloseRequested { .. } = event {
                    let id = label.trim_start_matches("detail-").to_string();
                    let _ = window.emit_to("main", "detail-closed", id);
                }
            }
            "main" => match event {
                // Closing the window (titlebar X) never quits the app — it
                // hides to the tray, keeping downloads running in the
                // background. The tray's own "Quit" flips `Quitting` first
                // and lets this same event through.
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    if !window.state::<Quitting>().0.load(Ordering::Relaxed) {
                        api.prevent_close();
                        windows::hide_to_tray(window.app_handle());
                    }
                }
                // Tauri 2 has no `Minimized` variant — `Resized` + `is_minimized()`
                // is the standard way to detect it, and it catches every path
                // (titlebar button, taskbar, Win+D) in one place.
                tauri::WindowEvent::Resized(_) => {
                    let settings = window.state::<SettingsState>();
                    let minimize_to_tray = settings.0.lock().unwrap().minimize_to_tray;
                    if minimize_to_tray && window.is_minimized().unwrap_or(false) {
                        let _ = window.hide();
                    }
                }
                _ => {}
            },
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            commands::start_download,
            commands::pause_download,
            commands::cancel_download,
            commands::set_global_speed_limit,
            commands::set_download_speed_limit,
            commands::delete_download,
            commands::list_resumable,
            commands::probe_url,
            commands::default_download_dir,
            commands::extension_dir,
            deeplink::take_pending_deep_link,
            windows::add::open_add_window,
            windows::add::reveal_add_window_cmd,
            windows::add::submit_add,
            windows::add::close_add_window,
            windows::detail::open_detail_window,
            windows::detail::show_detail_window,
            windows::detail::close_detail_window,
            tray::update_tray_downloads,
            config::settings::load_settings,
            config::settings::save_settings,
            config::prefs::load_prefs,
            config::prefs::save_add_defaults,
            config::prefs::set_category_path,
            config::history::load_history,
            config::history::save_history
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
