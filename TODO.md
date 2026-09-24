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
      builds/signs/publishes on a `v*` tag via `tauri-action`.

      In-app (`src/hooks/useUpdateCheck.ts`) the check runs once at launch and
      on demand from Settings → System. A found update downloads **silently**
      — no dialog, no progress UI — because a prompt raised mid-download only
      offers the user a wait. When it lands, a toast with a Restart button
      plus a persistent `Restart to update` link in the status bar; the link
      exists because a dismissed toast would otherwise strand a downloaded
      update with no way back to it. Both routes go through
      `src/components/dialogs/UpdateRestartDialog.tsx`, which names how many
      downloads will be paused — one stray click taking the app down
      mid-transfer is not forgivable.

      Installing goes through `prepare_for_update` (`windows/mod.rs`), which
      shares `begin_shutdown` with the tray-quit path. The installer
      terminates the process directly, which otherwise skipped that entirely:
      in-flight downloads died without their resume sidecars written, and any
      history still inside the frontend's 400ms debounce was lost.

      The launch check is held until the window is actually visible — an
      autostart launch stays hidden in the tray, where the toast would fire
      where nobody can see it. There is deliberately no periodic re-check:
      this app stays open for days, and re-checking on a timer would only
      discard or duplicate an already-downloaded update.

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

## Done (Phase 5)

- [x] **Install a pending update at startup.** `autoInstallUpdates` (on by
      default) applies a downloaded update as soon as it lands at launch,
      **only** when nothing is downloading or queued — startup is when
      restarting costs least, and the in-flight count is re-read at that
      moment rather than when the download began. Otherwise it falls back to
      the patient toast + status-bar link. Closes the real failure mode of the
      Phase 4 design: an update that downloads perfectly and then sits
      forever because nobody clicks the link.
- [x] **Critical updates.** `latest.json` may carry a top-level
      `"critical": true`; the plugin hands the parsed feed through as
      `rawJson`, so no custom endpoint is needed to read it. Such a release
      ignores `autoInstallUpdates` and opens a prompt with no Cancel that
      restarts itself after 30s (`readCritical` in `useUpdateCheck.ts`,
      `critical` in `UpdateRestartDialog.tsx`). Only a literal `true` counts —
      this comes off the network, and a malformed feed escalating every
      ordinary update into a forced restart is the failure that matters.

      tauri-action doesn't emit the field; it's added by hand to the draft
      release's `latest.json` before publishing (see the note in
      `.github/workflows/release.yml`). Downloads pause and resume across the
      restart either way, so the cost of a wrongly-flagged release is an
      interruption, not lost work.

## Done (Phase 6)

- [x] **Table header stays pinned while scrolling.** `.dtable thead th` was
      already `position: sticky`, but `sortable-headers.css` re-declared
      `position: relative` on `.dtable thead th.sortable` — one class more
      specific, so it won regardless of load order and un-stuck the header.
      Removed, with a note at both ends so it doesn't come back. The pinned
      bottom rule is now an inset `box-shadow` as well as a border: under
      `border-collapse: collapse` the collapsed border belongs to the table,
      not to the sticky cell, and Chromium scrolls it away with the rows.
- [x] **Show/hide columns.** Right-click the header row → `ColumnMenu.tsx`,
      one checkable entry per column plus "Show all columns".
      `src/hooks/useColumnVisibility.ts`, `src/columns.ts`
      (`visibleOrder`/`applyVisibleOrder`). Hidden keys — not visible ones —
      are what gets persisted, so a column added in a later release shows up
      for existing installs. `order` still lists every column, so hiding and
      re-showing one puts it back where it sat. The last visible column can't
      be switched off (the header row is the only way back into the menu).
- [x] **ETA, Connections, and Pieces columns.** Hidden by default
      (`DEFAULT_HIDDEN_COLUMNS`) — all three on at once pushes the table's
      minimum width past the default 1034px window, and Connections/Pieces are
      diagnostics the Detail window already covers. `etaOf`/`piecesDoneOf` in
      `src/format.ts`; `renderCell` in `DownloadTable.tsx`. `etaOf` is now
      shared with the Detail window, which used to inline the same math.
      Pieces is derived from bytes (`downloaded / pieceSize`) rather than
      summed from `conns[].pieces`, which only counts pieces finished *this
      run* and so would restart at zero on a resumed download.

## Features

Nothing queued — everything that was listed here has shipped. The one piece of
outstanding work is the signing-key setup noted under Phase 4, which only the
repo owner can do.
