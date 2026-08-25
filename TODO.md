# Implementation list

Queued work — recorded, not yet implemented. Ordered roughly by value, not by
dependency.

## Done (Phase 1)

- [x] **Match the add button background and the delete icon color to the rest
      of the toolbar.** `src/components/Toolbar.tsx`, `src/styles/shell.css`.
- [x] **Drag & drop column headers to reorder columns.** `src/columns.ts`,
      `src/hooks/useColumnOrder.ts`, `src/components/DownloadTable.tsx`.
- [x] **Infinite scrolling on the main table.** `src/hooks/useInfiniteRows.ts`.
- [x] **Speed graph in the detail window.** `src/speedHistory.ts`,
      `src/DetailWindow.tsx`.
- [x] **Per-piece progress map in the detail window.**
      `src-tauri/src/engine/pieces.rs` (`piece_buckets`), `src/DetailWindow.tsx`.

## Shipping / reliability

- [ ] **Auto-updater.** `tauri-plugin-updater` isn't wired up
      (`src-tauri/Cargo.toml:21-28`, `src-tauri/tauri.conf.json` has no
      `updater` plugin block), yet releases are already being cut (v0.2.1 →
      v0.2.2). Anyone who installs today never gets an update without a manual
      re-download. Needs the plugin, signing keys, a release endpoint, and an
      in-app "update available" prompt.
- [ ] **Auto-retry a failed download, not just a failed piece.** Retry today
      lives entirely inside one piece (`src-tauri/src/engine/worker.rs:23`,
      `MAX_RETRIES = 5`, linear 500ms x attempt backoff). Once a piece exhausts
      it the whole download goes to `error` and sits there forever. Add
      download-level retry with backoff and a configurable attempt cap, so
      overnight queues survive a flaky connection.

## Features

- [ ] **Clipboard monitoring.** The clipboard is only read when the Add window
      opens (`src/hooks/useAddForm.ts`). Add an IDM-style background watcher
      that pops the Add window (or a toast) when a downloadable URL is copied.
      Must be a settings toggle — some people find it intrusive.
- [ ] **Scheduling + post-queue action.** `AppSettings`
      (`src-tauri/src/config/settings.rs:17-29`) has no time-related field at
      all. Add "start the queue at <time>" and "sleep/shutdown once the queue
      finishes" — the natural companion to the existing tray + autostart
      behavior.
- [ ] **Configurable history retention.** `HISTORY_MAX = 500` is hardcoded
      (`src-tauri/src/config/history.rs:57`). Make it a setting, add a "clear
      history" action, and optionally auto-drop completed entries after N days.

## UI

- [ ] **Settings dialog: split into labeled sections.** `SettingsDialog`
      (`src/components/dialogs/SettingsDialog.tsx`) is currently one flat
      `dialog-sm` list of rows. Each item added above under "Shipping" /
      "Features" needs its own setting, so before those land, group the
      existing rows under headings (Downloads / Appearance / System) so the
      dialog stays scannable as it grows.

## Bugs found along the way

- [ ] **`didResizeRef`'s click-suppression breaks if the resize drag crosses
      a column boundary.** `useColumnWidths`'s `didResizeRef` (read by
      `SortTh`'s `onClick` in `src/components/DownloadTable.tsx`) is meant to
      swallow the trailing click a resize drag's `mouseup` always fires. But
      per the UIEvents spec, that trailing `click` fires on the nearest
      common ancestor of the `mousedown` and `mouseup` targets — if the drag
      ends with the cursor over a *different* `<th>` than it started on (easy
      when dragging a resize handle past a narrow neighboring column), the
      click never reaches the original header's `onClick` at all, so the flag
      is set but never consumed or cleared. The next genuine click on that
      header is then silently swallowed. `useColumnOrder`'s reorder handler
      (added in Phase 1) hits the same root cause and works around it with a
      one-shot capture-phase `click` listener on `mouseup` — see that hook's
      module comment for the fix shape; the same fix should be ported to
      `useColumnWidths`.
