// ---------------------------------------------------------------------------
// Tray download list
// ---------------------------------------------------------------------------

use std::sync::Mutex;

use serde::Deserialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};

/// One download row currently rendered in the tray menu, alongside the
/// `MenuItem` it owns so a same-shape update (the common case, ~1/sec) can
/// patch labels in place via `set_text` instead of rebuilding the whole menu.
pub(crate) struct TrayEntry {
    download_id: String,
    label: String,
    item: MenuItem<tauri::Wry>,
}

#[derive(Default)]
pub(crate) struct TrayMenuState(Mutex<Vec<TrayEntry>>);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrayDownload {
    id: String,
    label: String,
}

/// Rebuild the tray's dropdown menu from scratch: Show, a separator, one item
/// per active download (or a disabled placeholder when there are none),
/// another separator, then Quit.
pub(crate) fn rebuild_tray_menu(
    app: &tauri::AppHandle,
    items: &[TrayDownload],
) -> Result<(Menu<tauri::Wry>, Vec<TrayEntry>), String> {
    let tray_show = MenuItem::with_id(app, "show", "Show Azhura Download Manager", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let tray_quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>).map_err(|e| e.to_string())?;
    let sep_top = PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?;
    let sep_bottom = PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?;

    let mut entries: Vec<TrayEntry> = Vec::with_capacity(items.len());
    if items.is_empty() {
        let placeholder = MenuItem::with_id(app, "dl:none", "No active downloads", false, None::<&str>)
            .map_err(|e| e.to_string())?;
        let menu = Menu::with_items(app, &[&tray_show, &sep_top, &placeholder, &sep_bottom, &tray_quit])
            .map_err(|e| e.to_string())?;
        return Ok((menu, entries));
    }

    let mut menu_items: Vec<MenuItem<tauri::Wry>> = Vec::with_capacity(items.len());
    for d in items {
        let item = MenuItem::with_id(app, format!("dl:{}", d.id), &d.label, true, None::<&str>)
            .map_err(|e| e.to_string())?;
        menu_items.push(item);
    }
    for (d, item) in items.iter().zip(menu_items.iter()) {
        entries.push(TrayEntry {
            download_id: d.id.clone(),
            label: d.label.clone(),
            item: item.clone(),
        });
    }

    let mut refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = vec![&tray_show, &sep_top];
    for item in &menu_items {
        refs.push(item);
    }
    refs.push(&sep_bottom);
    refs.push(&tray_quit);
    let menu = Menu::with_items(app, &refs).map_err(|e| e.to_string())?;
    Ok((menu, entries))
}

/// Push a fresh snapshot of active downloads into the tray menu, called
/// roughly once a second from the frontend. Patches labels in place when the
/// same set of ids is still showing (by far the common case) so the menu
/// doesn't visibly flicker; otherwise rebuilds it.
#[tauri::command]
pub(crate) fn update_tray_downloads(
    app: tauri::AppHandle,
    items: Vec<TrayDownload>,
    tooltip: String,
    state: tauri::State<'_, TrayMenuState>,
) -> Result<(), String> {
    let Some(tray) = app.tray_by_id("main-tray") else {
        return Ok(());
    };

    let mut cached = state.0.lock().unwrap();
    let same_shape = cached.len() == items.len()
        && cached
            .iter()
            .zip(items.iter())
            .all(|(c, d)| c.download_id == d.id);

    if same_shape {
        for (c, d) in cached.iter_mut().zip(items.iter()) {
            if c.label != d.label {
                let _ = c.item.set_text(&d.label);
                c.label = d.label.clone();
            }
        }
    } else {
        let (menu, entries) = rebuild_tray_menu(&app, &items)?;
        tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
        *cached = entries;
    }

    let _ = tray.set_tooltip(Some(&tooltip));
    Ok(())
}
