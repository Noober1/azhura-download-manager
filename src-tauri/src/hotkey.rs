// ---------------------------------------------------------------------------
// System-wide shortcut that opens the Add window from any app.
// ---------------------------------------------------------------------------

use tauri::Manager as _;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::config::settings::SettingsState;

pub(crate) fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, _shortcut, event| {
            // Only one shortcut is ever registered, so any press is ours.
            if event.state() == ShortcutState::Pressed {
                crate::windows::add::open_add_window(app.clone());
            }
        })
        .build()
}

fn apply(app: &tauri::AppHandle, accel: &str) -> Result<(), String> {
    let gs = app.global_shortcut();
    gs.unregister_all().map_err(|e| e.to_string())?;
    let accel = accel.trim();
    if accel.is_empty() {
        return Ok(());
    }
    let sc: Shortcut = accel.parse().map_err(|_| format!("\"{accel}\" isn't a valid shortcut"))?;
    gs.register(sc).map_err(|_| format!("{accel} is already in use by another app"))
}

/// Called once from `setup()`. A saved shortcut that can't be registered
/// (another app grabbed it since) is logged, not fatal.
pub(crate) fn register_saved(app: &tauri::AppHandle) {
    let accel = app.state::<SettingsState>().0.lock().unwrap().global_hotkey.clone();
    if let Err(e) = apply(app, &accel) {
        eprintln!("global hotkey not registered: {e}");
    }
}

/// Swaps the registered shortcut. On failure the previous one is restored so
/// a typo never leaves the user with none. Persisting is the frontend's job
/// (via `save_settings`), only after this returns Ok.
#[tauri::command]
#[specta::specta]
pub(crate) fn set_global_hotkey(
    app: tauri::AppHandle,
    accel: String,
    state: tauri::State<'_, SettingsState>,
) -> Result<(), String> {
    let prev = state.0.lock().unwrap().global_hotkey.clone();
    apply(&app, &accel).inspect_err(|_| {
        let _ = apply(&app, &prev);
    })
}
