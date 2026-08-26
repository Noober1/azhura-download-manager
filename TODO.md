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

## Done (Phase 2)

- [x] **Settings dialog: split into labeled sections.**
      `src/components/dialogs/SettingsDialog.tsx` (Downloads / Appearance /
      System `<fieldset>` groups), `src/styles/dialogs.css`.
- [x] **`didResizeRef`'s click-suppression bug.** Ported the capture-phase
      `suppressNextClick()` fix from `useColumnOrder.ts` to
      `useColumnWidths.ts`; the shared logic now lives in
      `src/suppressNextClick.ts`.
- [x] **Auto-retry a failed download, not just a failed piece.**
      `src-tauri/src/config/settings.rs` (`maxRetryAttempts` setting),
      `src/hooks/useDownloads.ts` (`handleDownloadError`),
      `src/retryBackoff.ts`, `src/format.ts`/`src/constants.ts`
      (`retryPending` status overlay). Checksum-mismatch failures are
      excluded from retry (see `handleDownloadError`'s comment) since
      they're guaranteed not to improve and are the one failure case
      expensive enough to matter.

## Shipping / reliability

- [ ] **Auto-updater.** `tauri-plugin-updater` isn't wired up
      (`src-tauri/Cargo.toml:21-28`, `src-tauri/tauri.conf.json` has no
      `updater` plugin block), yet releases are already being cut (v0.2.1 →
      v0.2.2). Anyone who installs today never gets an update without a manual
      re-download. Needs the plugin, signing keys, a release endpoint, and an
      in-app "update available" prompt. **Blocked on the user providing
      signing keys and a release endpoint** — can't be executed unattended.

## Features

- [ ] **Clipboard monitoring.** The clipboard is only read when the Add window
      opens (`src/hooks/useAddForm.ts`). Add an IDM-style background watcher
      that pops the Add window (or a toast) when a downloadable URL is copied.
      Must be a settings toggle — some people find it intrusive.
- [ ] **Scheduling + post-queue action.** `AppSettings`
      (`src-tauri/src/config/settings.rs`) has no time-related field at
      all. Add "start the queue at <time>" and "sleep/shutdown once the queue
      finishes" — the natural companion to the existing tray + autostart
      behavior.
- [ ] **Configurable history retention.** `HISTORY_MAX = 500` is hardcoded
      (`src-tauri/src/config/history.rs:57`). Make it a setting, add a "clear
      history" action, and optionally auto-drop completed entries after N days.
