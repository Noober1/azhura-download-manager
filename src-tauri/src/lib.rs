// Download engine.
// v3: dynamic segmentation via a shared piece queue. The file is split into
// many small pieces; N workers each pull the next piece as soon as they finish
// one, so fast connections naturally do more work and no connection sits idle
// while a slow one finishes. Per-piece completion is persisted for resume.

mod bridge;
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
use tauri_plugin_autostart::MacosLauncher;

use categories::{migrate_legacy_category_folders, PendingMigrationWarnings, CATEGORY_FOLDERS};
use config::prefs::PrefsState;
use config::settings::{AutostartLaunch, SettingsState};
use deeplink::{deep_link_from_args, handle_deep_link, handle_deep_link_cold_start, PendingDeepLink};
use engine::control::Manager;
use paths::downloads_base;
use tray::{rebuild_tray_menu, TrayMenuState};
use windows::{harden_webview, quit_app, reveal_main_window, Quitting};

/// Passed to the app by the `autostart` plugin on an OS-launched-at-login
/// run — the single flag both `tauri_plugin_autostart::init`'s `args` param
/// and the cold-start detection below have to agree on.
const AUTOSTART_FLAG: &str = "--autostart";

/// 28 of the app's 30 IPC-crossing commands, collected once here so both the
/// runtime invoke handler and (in debug builds) the generated
/// `../src/bindings.ts` stay derived from the same list — order matches the
/// old `tauri::generate_handler!` list it replaced.
///
/// `submit_add` and `take_pending_deep_link` are the missing two: this
/// crate's `specta` (pinned to `2.0.0-rc.25`) overflows the stack while
/// exporting a `serde_json::Value`-shaped command — confirmed by isolating
/// each of them in turn. Both stay on a plain `tauri::generate_handler!`,
/// merged into the specta-generated one in `run()` below.
fn specta_builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::<tauri::Wry>::new()
        // Default mode wraps every `Result`-returning command's binding in a
        // `{status: "ok"|"error", ...}` object instead of rejecting the
        // promise. `Throw` instead matches plain `invoke()`'s existing
        // reject-on-`Err` behavior, so callers being migrated onto these
        // bindings can keep their existing `.catch(...)` handling as-is.
        .error_handling(tauri_specta::ErrorHandlingMode::Throw)
        .commands(tauri_specta::collect_commands![
        commands::start_download,
        commands::pause_download,
        commands::cancel_download,
        commands::set_global_speed_limit,
        commands::set_download_speed_limit,
        commands::delete_download,
        commands::list_resumable,
        commands::check_paths_missing,
        commands::probe_url,
        commands::default_download_dir,
        commands::extension_dir,
        windows::add::open_add_window,
        windows::add::reveal_add_window_cmd,
        windows::add::close_add_window,
        windows::detail::open_detail_window,
        windows::detail::show_detail_window,
        windows::detail::close_detail_window,
        tray::update_tray_downloads,
        config::settings::load_settings,
        config::settings::save_settings,
        config::settings::get_run_at_startup,
        config::settings::set_run_at_startup,
        config::settings::launched_at_startup,
        config::prefs::load_prefs,
        config::prefs::save_add_defaults,
        config::prefs::set_category_path,
        config::history::load_history,
        config::history::save_history,
        bridge::grabber_status
    ])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Runs before anything else touches the download folders (prefs load,
    // history load, `setup()`'s own folder-creation loop below) so nothing
    // observes the old singular names as still current. Any folder that
    // failed to rename is surfaced to the user later, from inside `.setup()`
    // (see `PendingMigrationWarnings` below) — no `AppHandle` exists yet here
    // to do that directly.
    let failed_migrations = migrate_legacy_category_folders();

    let specta_builder = specta_builder();

    #[cfg(debug_assertions)]
    specta_builder
        .export(specta_typescript::Typescript::default(), "../src/bindings.ts")
        .expect("failed to export typescript bindings");

    // Computed up front (rather than inline in `.invoke_handler(...)` below)
    // because `specta_builder` itself is moved into the `.setup()` closure
    // further down the chain, and a method chain's arguments are evaluated in
    // source order — inline would move it out from under this call.
    //
    // Boxed as `dyn Fn`: `generate_handler!`'s own expansion needs an
    // expected type to resolve its internal generics against, which it
    // normally gets for free from `.invoke_handler()`'s signature — here it
    // has to come from this binding's declared type instead.
    type BoxedInvokeHandler = Box<dyn Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync>;
    let specta_invoke_handler: BoxedInvokeHandler = Box::new(specta_builder.invoke_handler());
    // The two commands specta can't export (see `specta_builder` above) still
    // need a normal Tauri dispatch path. `Invoke` isn't `Clone`, so the two
    // handlers can't just be tried in sequence — check the command name
    // first (a borrow) and route the one owned `invoke` to whichever handler
    // actually owns that command.
    let plain_invoke_handler: BoxedInvokeHandler =
        Box::new(tauri::generate_handler![windows::add::submit_add, deeplink::take_pending_deep_link]);
    let invoke_handler = move |invoke: tauri::ipc::Invoke<tauri::Wry>| match invoke.message.command() {
        "submit_add" | "take_pending_deep_link" => plain_invoke_handler(invoke),
        _ => specta_invoke_handler(invoke),
    };

    let mut builder = tauri::Builder::default();

    // Must be registered before other plugins: routes an `adm://` URL passed
    // to a second launch into this (already running) instance instead of
    // spawning a duplicate process.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // A deep link in `argv` is already handled by
            // `tauri_plugin_deep_link`'s own `on_open_url` event — this
            // plugin's "deep-link" feature (see its `Cargo.toml` entry)
            // triggers that event via `handle_cli_arguments` before this
            // closure runs. Calling `handle_deep_link` again here would
            // process the same relay a second time, and since a handoff id
            // can only be claimed once (see `bridge::HandoffStore::take`),
            // that second pass would silently build a payload with no
            // credentials at all instead of just being a harmless no-op.
            if deep_link_from_args(argv).is_none() {
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
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![AUTOSTART_FLAG]),
        ))
        .manage(Manager::default())
        .manage(PendingDeepLink::default())
        .manage(SettingsState(Mutex::new(config::settings::load_settings_from_disk())))
        .manage(PrefsState(Mutex::new(config::prefs::load_prefs_from_disk())))
        .manage(Quitting(AtomicBool::new(false)))
        .manage(TrayMenuState::default())
        .manage(PendingMigrationWarnings(failed_migrations))
        // Set once at startup from argv — `--autostart` is only ever present
        // when the OS launched us via the autostart entry (see
        // `AUTOSTART_FLAG`), never on a plain manual launch or a deep-link
        // relay (`deep_link_from_args` only matches `adm://` args, so the two
        // checks can't collide).
        .manage(AutostartLaunch(std::env::args().any(|a| a == AUTOSTART_FLAG)))
        .setup(move |app| {
            specta_builder.mount_events(app);

            // Started here rather than via an eager `.manage(bridge::start())`
            // on the builder chain above: that form is evaluated immediately,
            // for *every* launch — including a duplicate launch that's about
            // to relay its argv to the already-running instance and exit via
            // `std::process::exit(0)` from inside the single-instance
            // plugin's own (earlier-registered) setup, before this closure
            // ever runs. Opening a listening socket on every such short-lived
            // relay process serves no purpose, and a process spawned by a
            // browser that immediately starts listening on a port is exactly
            // the shape of behavior security software watches for — this
            // ensures only the one surviving instance ever binds the bridge.
            let (handoffs, bridge_status) = bridge::start();
            app.manage(handoffs);
            app.manage(bridge_status);

            // Built here (rather than declared in tauri.conf.json) so it can be
            // given `main` as its OS-level owner: an owned window is always
            // above its owner in z-order, but — unlike always-on-top — it has
            // no effect on other applications, so switching focus away to
            // another app is unaffected.
            let main = app
                .get_webview_window("main")
                .expect("main window is declared in tauri.conf.json");
            harden_webview(&main);

            // Surfaces any legacy category-folder rename that failed back in
            // `run()`'s `migrate_legacy_category_folders()` call — that ran
            // before any `AppHandle` existed, so this is the earliest point
            // it can reach the user. Placed before the `add` window build
            // below (which uses `?` and could bail this closure out early)
            // so the warning always fires regardless of any later setup step.
            let migration_warnings = app.state::<PendingMigrationWarnings>();
            if !migration_warnings.0.is_empty() {
                let count = migration_warnings.0.len();
                let message = format!(
                    "Couldn't rename {count} legacy download folder{} — check the app log for details.",
                    if count == 1 { "" } else { "s" }
                );
                let _ = app.emit_to(
                    "main",
                    "backend-warning",
                    serde_json::json!({ "message": message, "level": "error" }),
                );
            }

            let add = tauri::WebviewWindowBuilder::new(app, "add", tauri::WebviewUrl::App("add.html".into()))
                .title("Add Download")
                .inner_size(671.0, 512.0)
                .min_inner_size(581.0, 440.0)
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
        .invoke_handler(invoke_handler)
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
