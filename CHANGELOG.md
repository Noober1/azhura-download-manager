# Changelog

All user-facing changes, newest first. Shown in-app by Help ▸ What's New and used as the GitHub
release notes. Format: `## [X.Y.Z] - YYYY-MM-DD` (or `- Unreleased` until the release is tagged),
then `### Added` / `### Changed` / `### Fixed` sections of `- ` bullets. Inline `code` and **bold** are
rendered; nothing else in Markdown is.

## [0.2.5] - Unreleased

### Added
- **Menu bar** — tap Alt to show a classic File / Downloads / View / Tools / Help menu bar with keyboard mnemonics.
- **Auto rules** — downloads whose URL matches a pattern you define skip the Add window and go straight to the queue.
- **Queue priority** — drag rows in the new Queue column to change the order queued downloads start in.
- **Statistics dashboard** — totals, active/error/canceled tiles and download history at a glance.
- **PIN lock** — lock the app on start, when it goes to the tray, or with `Ctrl+L`.
- **Status filter** and **grouping** buttons in the toolbar (group by relative date, collapsible).
- **Combined speed graph** in the status bar.
- **Disk-space check** before downloading, with a warning in the Add window.
- **Export to CSV**, and **backup / restore** of settings and history.
- **Global hotkey** to open the Add window from anywhere (off by default).
- **Column show/hide** from the header's right-click menu, and a pinned table header.
- **Row density** toggle (compact / comfortable), a "Scheduled HH:MM" indicator on held rows, and active-download badges in the sidebar.
- **What's New** window (this one) — opens once after each update, and any time from Help ▸ What's New.

### Changed
- Updates now download silently and install when you quit (or on the next start) instead of interrupting you.
- Queued downloads now start in the order they were added (first in, first out).
- Thinner scrollbars.

## [0.2.4] - 2026-08-29

### Added
- Archive preview in the Add Download window.
- About window, right-click menu on empty table space, and sidebar icons with collapse.
- Custom tooltips and keyboard shortcuts (`Ctrl+/` shows the list).
