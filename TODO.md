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

## Done (Phase 3)

- [x] **Clipboard monitoring.** `src/hooks/useClipboardWatch.ts` polls the
      clipboard while the `clipboardWatch` setting is on and offers a copied
      http(s) link via a toast with a **Download** button
      (`src/toast.ts`/`src/components/Toast.tsx` gained an optional action).
      Chosen over auto-popping the Add window because that's the intrusive
      behavior the note below warned about. Falls back to a desktop
      notification when the window is hidden in the tray — an in-app toast
      there would render where nobody can see or click it.
- [x] **Scheduling + post-queue action.** `scheduledStartEnabled` /
      `scheduledStartTime` hold the queue until a daily time
      (`src/queueSchedule.ts`, `src/hooks/useQueueSchedule.ts`, plus a `held`
      guard in `useScheduler.ts`); hitting Resume overrides the hold rather
      than leaving the button dead. The sleep/shutdown action is armed per
      session from the status bar, never persisted, and runs behind a
      cancellable 60s countdown (`PowerActionDialog.tsx`,
      `src-tauri/src/power.rs`). The drain detector requires that a row which
      *was* pending actually reached `completed` — pausing, canceling or
      deleting the whole queue empties it too, and must never suspend the
      machine.
- [x] **Configurable history retention.** `historyMaxEntries` replaces the
      hardcoded `HISTORY_MAX` (read from `SettingsState` inside
      `save_history`, re-clamped there since settings.json is user-editable),
      `historyRetentionDays` sweeps old rows in `useHistoryPersistence.ts`
      (frontend-side, so the list and the file agree), and "Clear history"
      reuses the existing delete dialog so the "also delete files" choice
      still applies.

## Done (Phase 4)

- [x] **Auto-updater.** `tauri-plugin-updater` + `tauri-plugin-process` are
      wired up, `tauri.conf.json` gained an `updater` block pointing at the
      GitHub Releases `latest.json` feed, and `.github/workflows/release.yml`
      builds/signs/publishes on a `v*` tag via `tauri-action`. In-app the
      check runs once silently at launch (`src/hooks/useUpdateCheck.ts`) and
      on demand from Settings → System, prompting through
      `src/components/dialogs/UpdateDialog.tsx`. Deliberately no periodic
      re-check: this app stays open for days and a dialog appearing mid-
      download would interrupt at the worst moment.

      Note the earlier claim here that "releases are already being cut" was
      wrong — `gh release list` and `git tag` were both empty, so no release
      had ever been published and there are no installs in the field. The
      updater is a prerequisite for the *first* release rather than a fix for
      stranded users.

      Signing is set up: the keypair lives outside the repo, the public half
      is in `pubkey` above, and the private half plus its password are the
      `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` repo
      secrets. Note a wrong pubkey builds and signs cleanly and only fails on
      the *client* at update time, so any future key change has to be
      verified against a real release, not against a green build.

      The signing key is a permanent trust anchor: once a release ships, its
      public half is baked into every install and cannot be rotated without
      making every user reinstall by hand. Keep the private key backed up
      offline, and never let it reach a log, a terminal, or a transcript.

## Features

Nothing queued — everything that was listed here has shipped. The one piece of
outstanding work is the signing-key setup noted under Phase 4, which only the
repo owner can do.
