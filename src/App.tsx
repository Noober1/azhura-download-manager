import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { flushSync } from "react-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { AnimatePresence } from "motion/react";
import { commands } from "./bindings";
import type { DownloadItem, HistoryEntry } from "./types";
import { isResumable, isRedownload, looksLikeUrl } from "./format";
import { historyPayload, mergeImportedHistory } from "./history";
import { historyToCsv, exportFileName } from "./csvExport";
import { showToast } from "./toast";
import { notify } from "./notify";
import { TERMINAL_STATES } from "./constants";
import { ToastHost } from "./components/Toast";
import { useNativeShell } from "./ui";
import { useDownloads } from "./hooks/useDownloads";
import { useScheduler } from "./hooks/useScheduler";
import { useQueueSchedule } from "./hooks/useQueueSchedule";
import { useClipboardWatch } from "./hooks/useClipboardWatch";
import { useUpdateCheck } from "./hooks/useUpdateCheck";
import { useHistoryPersistence } from "./hooks/useHistoryPersistence";
import { useSettings } from "./hooks/useSettings";
import { useTrayPush } from "./hooks/useTrayPush";
import { useDetailWindows } from "./hooks/useDetailWindows";
import { useDeepLinkCapture } from "./hooks/useDeepLinkCapture";
import { useSortedRows } from "./hooks/useSortedRows";
import { useColumnWidths } from "./hooks/useColumnWidths";
import { useColumnOrder } from "./hooks/useColumnOrder";
import { useColumnVisibility } from "./hooks/useColumnVisibility";
import { useRowDensity } from "./hooks/useRowDensity";
import { useInfiniteRows } from "./hooks/useInfiniteRows";
import { useMissingRefresh } from "./hooks/useMissingRefresh";
import { useGrabberStatus } from "./hooks/useGrabberStatus";
import { useBackendWarnings } from "./hooks/useBackendWarnings";
import { useSelection } from "./selection/useSelection";
import { useMarquee } from "./selection/useMarquee";
import { useTableKeyboard } from "./selection/useTableKeyboard";
import { useAppShortcuts } from "./hooks/useAppShortcuts";
import { Toolbar } from "./components/Toolbar";
import { Sidebar } from "./components/Sidebar";
import { DownloadTable } from "./components/DownloadTable";
import { ContextMenu } from "./components/ContextMenu";
import { TableContextMenu } from "./components/TableContextMenu";
import { ColumnMenu } from "./components/ColumnMenu";
import { SettingsDialog } from "./components/dialogs/SettingsDialog";
import { ExtensionsDialog } from "./components/dialogs/ExtensionsDialog";
import { DeleteDialog } from "./components/dialogs/DeleteDialog";
import { SpeedCapDialog } from "./components/dialogs/SpeedCapDialog";
import { ConnRestartDialog } from "./components/dialogs/ConnRestartDialog";
import { PowerActionDialog, type PowerAction } from "./components/dialogs/PowerActionDialog";
import { UpdateRestartDialog } from "./components/dialogs/UpdateRestartDialog";
import { ShortcutsDialog } from "./components/dialogs/ShortcutsDialog";
import "./App.css";

function App() {
  const [version, setVersion] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showExtensions, setShowExtensions] = useState(false);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    kind: "row" | "empty" | "columns";
  } | null>(null);
  // Read fresh each time the empty-space menu opens, rather than kept live
  // via a poller (unlike `useClipboardWatch`) — this only needs to be
  // correct at the moment the menu appears, not continuously.
  const [clipboardUrl, setClipboardUrl] = useState<string | null>(null);
  // Custom… speed-cap dialog, opened from the context menu's submenu.
  const [speedCapDialog, setSpeedCapDialog] = useState<{ items: DownloadItem[]; mbps: number } | null>(
    null,
  );
  // What to do once the queue drains. Armed per session and never persisted —
  // a setting that survived a restart could suspend the machine days later
  // for a queue the user had long forgotten arming.
  const [postQueueAction, setPostQueueAction] = useState<"none" | PowerAction>("none");
  const [pendingPower, setPendingPower] = useState<PowerAction | null>(null);
  // Restarting to apply an update interrupts whatever is downloading, so it
  // always goes through a confirmation — even though the downloads are only
  // paused, not lost.
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const tableWrapRef = useRef<HTMLElement>(null);
  const didDragRef = useRef(false);

  useNativeShell();

  const settings = useSettings();

  // downloads/selection have a two-way dependency (adding or removing a
  // download also updates which rows are selected), resolved by having
  // `useDownloads`'s callbacks close over `selection`, defined further down
  // in this same render — safe because they only run from later events
  // (never synchronously during this render), by which point `selection`
  // is fully initialized.
  const downloadsApi = useDownloads({
    maxRetryAttempts: settings.maxRetryAttempts,
    onItemAdded: (id) => {
      selection.anchorRef.current = id;
      selection.setSelectedIds(new Set([id]));
    },
    onItemsRemoved: (ids) => {
      selection.setSelectedIds((prev) => new Set([...prev].filter((id) => !ids.has(id))));
    },
  });
  const { downloads, setDownloads, downloadsRef } = downloadsApi;

  const sorted = useSortedRows(downloads);
  const { rows } = sorted;

  const selection = useSelection(rows, didDragRef);
  const { selectedIds, setSelectedIds, anchorRef, selectRow, scrollRowIntoView } = selection;

  const marquee = useMarquee(didDragRef, tableWrapRef, selectedIds, setSelectedIds);
  const columnVisibility = useColumnVisibility();
  const columnOrder = useColumnOrder(columnVisibility.hidden);
  const rowDensity = useRowDensity();
  // The visible order, not the full one — everything downstream measures or
  // renders real `<th>`/`<td>` elements, and a hidden column has neither.
  const columnWidths = useColumnWidths(columnOrder.visible);
  const infiniteRows = useInfiniteRows(rows, tableWrapRef, sorted.viewKey);

  // Deterministic version of `scrollRowIntoView` for keyboard navigation
  // (Home/End/Ctrl+A/arrows in `useTableKeyboard`): if the target row is
  // already rendered, scroll straight to it — the common case, zero extra
  // cost. Otherwise force the row into the render window with `flushSync`
  // before scrolling, so the DOM node actually exists when
  // `scrollRowIntoView`'s `querySelector` looks for it. A single
  // `requestAnimationFrame` isn't enough here: `useTableKeyboard` attaches a
  // raw `document.addEventListener("keydown", ...)`, so the `setCount` from
  // `ensureRendered` is scheduled through React's default-priority
  // `MessageChannel` task, which isn't guaranteed to run before a same-frame
  // rAF callback. `flushSync` is safe in this native-listener context (it's
  // not a React event handler) and keyboard nav is rare enough that a
  // synchronous render costs nothing.
  function scrollRowIntoViewEnsured(id: string) {
    const i = rows.findIndex((d) => d.id === id);
    if (i !== -1 && i >= infiniteRows.count) {
      flushSync(() => infiniteRows.ensureRendered(id));
    }
    scrollRowIntoView(id);
  }

  const { openDetail } = useDetailWindows(
    downloads,
    downloadsRef,
    downloadsApi.pauseMany,
    downloadsApi.cancelMany,
    downloadsApi.resumeMany,
  );

  const queue = useQueueSchedule(settings.scheduledStartEnabled, settings.scheduledStartTime);

  useScheduler(downloads, settings.maxConcurrent, downloadsApi.startRun, queue.held);
  useHistoryPersistence(downloads, setDownloads, downloadsRef, settings.historyRetentionDays);
  useClipboardWatch(settings.clipboardWatch, downloadsRef);
  const updater = useUpdateCheck(() => setConfirmRestart(true), {
    autoInstall: settings.autoInstallUpdates,
    inFlight: downloads.filter((d) =>
      ["downloading", "verifying", "queued"].includes(d.state),
    ).length,
  });
  useTrayPush(downloadsRef);
  useDeepLinkCapture(downloadsRef, downloadsApi.addFromPayload, downloadsApi.patchItem);
  const { refresh: refreshMissing } = useMissingRefresh(downloadsRef, downloadsApi.patchItem);
  const grabber = useGrabberStatus();
  useBackendWarnings();

  // The main window starts hidden (`visible: false` in tauri.conf.json) so
  // there's no white flash before React paints; show it right after the
  // first frame instead — unless this launch was the OS's own "Run at
  // startup" autostart, in which case it should stay hidden in the tray
  // until the user clicks the tray icon (see `reveal_main_window`).
  useEffect(() => {
    let raf = 0;
    commands
      .launchedAtStartup()
      .catch(() => false)
      .then((hidden) => {
        if (hidden) return;
        raf = requestAnimationFrame(() => {
          const w = getCurrentWindow();
          w.show()
            .then(() => w.setFocus())
            .catch(() => {});
        });
      });
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => {});
  }, []);

  // Fires the armed post-queue action once the queue drains.
  //
  // Deliberately NOT a bare "pending hit zero" check: pausing, canceling or
  // deleting every row empties the queue too, and suspending the machine
  // because the user hit Pause would be the worst bug in the app. Requiring
  // that a row which *was* pending actually reached "completed" is what
  // separates "the work finished" from "the user stopped it".
  // Accumulates every id seen pending since the last drain, rather than being
  // replaced with the currently-pending set each pass: a download that
  // finishes while others are still running leaves the pending set on that
  // render, and replacing would forget it ever ran. The queue would then
  // drain with only the *last* few ids remembered — so finishing two files
  // and canceling a third would look like "nothing completed" and silently
  // skip the action the user armed.
  const pendingIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const pendingNow = downloads.filter((d) =>
      ["downloading", "verifying", "queued"].includes(d.state),
    );
    for (const d of pendingNow) pendingIdsRef.current.add(d.id);
    if (pendingNow.length > 0) return;

    // Drained — this episode is over either way, so the set resets whether or
    // not anything fires below.
    const wasPending = pendingIdsRef.current;
    pendingIdsRef.current = new Set();
    if (wasPending.size === 0) return;
    if (postQueueAction === "none") return;
    if (!downloads.some((d) => wasPending.has(d.id) && d.state === "completed")) return;

    // The countdown lives in the main window, so it has to be on screen for
    // the user to have any chance of canceling it — draining while hidden in
    // the tray would otherwise sleep the machine 60s later, silently.
    const w = getCurrentWindow();
    w.show()
      .then(() => w.setFocus())
      .catch(() => {});
    const verb = postQueueAction === "sleep" ? "sleep" : "shut down";
    notify("Downloads finished", `The computer will ${verb} in 60 seconds.`);
    setPendingPower(postQueueAction);
    setPostQueueAction("none"); // one shot per arming
  }, [downloads, postQueueAction]);

  function handleRowContext(e: ReactMouseEvent, item: DownloadItem) {
    if (!selectedIds.has(item.id)) {
      anchorRef.current = item.id;
      setSelectedIds(new Set([item.id]));
    }
    setMenu({ x: e.clientX, y: e.clientY, kind: "row" });
  }

  // Right-click on empty table space (not over a row) — see
  // `onTableContextMenu` on `DownloadTable`. Deliberately doesn't touch the
  // current selection; "Select all" is right there in the menu if that's
  // what's wanted instead.
  function handleEmptyContext(e: ReactMouseEvent) {
    setMenu({ x: e.clientX, y: e.clientY, kind: "empty" });
    readText()
      .then((text) => setClipboardUrl(looksLikeUrl(text.trim()) ? text.trim() : null))
      .catch(() => setClipboardUrl(null));
  }

  // Right-click on the column headers — the only entry point to show/hide
  // columns, so the header row must never be able to become empty (see
  // `useColumnVisibility`).
  function handleHeaderContext(e: ReactMouseEvent) {
    setMenu({ x: e.clientX, y: e.clientY, kind: "columns" });
  }

  // Completed + still on disk → reveal its folder; otherwise there's nothing
  // to reveal yet (or the row needs attention), so fall back to the detail
  // popup — the row's only other way in besides Enter/"Show detail".
  function handleRowDoubleClick(item: DownloadItem) {
    const canReveal = item.state === "completed" && !!item.path && !item.missing;
    if (canReveal) {
      revealItemInDir(item.path).catch(() =>
        showToast("Couldn't open the containing folder — the file may have moved."),
      );
    } else openDetail(item.id);
  }

  // Explicitly hitting Resume outranks a pending scheduled start — otherwise
  // the button would silently do nothing for the whole hold window.
  function resumeWithOverride(items: DownloadItem[]) {
    if (queue.held) {
      queue.release();
      showToast("Scheduled start overridden — the queue is running now.", "info");
    }
    downloadsApi.resumeMany(items);
  }

  // Shared by ContextMenu's "Copy link" and the Ctrl+C shortcut, so the two
  // entry points can't drift.
  function copyLinks(items: DownloadItem[]) {
    writeText(items.map((i) => i.url).join("\n")).catch(() =>
      showToast("Couldn't copy to clipboard."),
    );
  }

  function exportHistoryCsv() {
    commands
      .exportHistoryCsv(historyToCsv(historyRows), exportFileName("history", "csv"))
      .then((p) => {
        if (p) showToast(`Exported ${historyRows.length} entries to ${p}`, "info");
      })
      .catch((e) => showToast(`Export failed: ${e}`));
  }

  function exportBackup() {
    commands
      .exportBackup(historyPayload(downloadsRef.current), exportFileName("backup", "json"))
      .then((p) => {
        if (p) showToast(`Backup saved to ${p}`, "info");
      })
      .catch((e) => showToast(`Backup failed: ${e}`));
  }

  async function importBackup() {
    try {
      const data = await commands.importBackup();
      if (!data) return;
      await commands.applyImportedPrefs(data.prefs);
      settings.applyImportedSettings(data.settings);
      // Read the latest list from the ref (not `downloads` state, which may
      // be stale by the time the dialogs above resolve) and commit the merge
      // synchronously, so nothing else can land between the read and the set.
      const { next, added } = mergeImportedHistory(
        downloadsRef.current,
        data.history as unknown as HistoryEntry[],
      );
      setDownloads(next);
      showToast(`Backup imported · ${added} history entries added`, "info");
    } catch (e) {
      showToast(`Import failed: ${e}`);
    }
  }

  const anyDialogOpen = !!(
    downloadsApi.pendingDelete ||
    showSettings ||
    showExtensions ||
    showShortcuts ||
    menu ||
    speedCapDialog ||
    pendingPower ||
    confirmRestart ||
    downloadsApi.connRestart
  );

  const totalSpeed = downloads
    .filter((d) => d.state === "downloading")
    .reduce((s, d) => s + d.speed, 0);
  const activeCount = downloads.filter(
    (d) => d.state === "downloading" || d.state === "verifying",
  ).length;
  const queuedCount = downloads.filter((d) => d.state === "queued").length;
  // What "Clear history" clears: the same terminal-state rows `historyPayload`
  // persists to history.json.
  const historyRows = downloads.filter((d) =>
    (TERMINAL_STATES as readonly string[]).includes(d.state),
  );
  // Same idea, but scoped to whichever sidebar category is selected — what
  // the empty-space context menu's "Clear history" clears. Deliberately
  // pre-search (`sorted.categoryRows`, not `sorted.rows`): the search box is
  // a transient text filter, not something a destructive bulk action should
  // be scoped by.
  const clearableRows = sorted.categoryRows.filter((d) =>
    (TERMINAL_STATES as readonly string[]).includes(d.state),
  );

  const selectedItems = downloads.filter((d) => selectedIds.has(d.id));
  const resumableSel = selectedItems.filter(isResumable);
  // "Redownload" when every resumable row in the selection would restart
  // from byte zero; "Resume" otherwise (including a mixed selection, where
  // some rows genuinely continue).
  const resumeLabel =
    resumableSel.length > 0 && resumableSel.every(isRedownload) ? "Redownload" : "Resume";
  const pausableSel = selectedItems.filter((d) => d.state === "downloading");
  const cancelableSel = pausableSel;
  const deletableSel = selectedItems.filter(
    (d) => d.state !== "downloading" && d.state !== "verifying",
  );
  const singleSelected = selectedItems.length === 1 ? selectedItems[0] : null;
  const canReveal =
    !!singleSelected &&
    singleSelected.state === "completed" &&
    !!singleSelected.path &&
    !singleSelected.missing;

  useTableKeyboard({
    rows,
    selectedItems,
    singleSelected,
    anyDialogOpen,
    setSelectedIds,
    anchorRef,
    requestDelete: downloadsApi.requestDelete,
    scrollRowIntoView: scrollRowIntoViewEnsured,
    openDetail,
  });

  useAppShortcuts({
    anyDialogOpen,
    onToggleSidebar: () => settings.setSidebarCollapsedSetting(!settings.sidebarCollapsed),
    onAddDownload: () => commands.openAddWindow(),
    onShowSettings: () => setShowSettings(true),
    onShowExtensions: () => setShowExtensions(true),
    onShowShortcuts: () => setShowShortcuts(true),
    pausableSel,
    resumableSel,
    onPause: downloadsApi.pauseMany,
    onResume: resumeWithOverride,
    selectedItems,
    onCopyLink: copyLinks,
    singleSelected,
    openDetail,
  });

  return (
    <div className="app">
      {/* ---- Top toolbar ---- */}
      <Toolbar
        resumableSel={resumableSel}
        resumeLabel={resumeLabel}
        pausableSel={pausableSel}
        cancelableSel={cancelableSel}
        deletableSel={deletableSel}
        selectedItems={selectedItems}
        selectedCount={selectedIds.size}
        totalSpeed={totalSpeed}
        activeCount={activeCount}
        queuedCount={queuedCount}
        statusFilter={sorted.statusFilter}
        onStatusFilterChange={sorted.setStatusFilter}
        searchQuery={sorted.searchQuery}
        onSearchChange={sorted.setSearchQuery}
        onResume={resumeWithOverride}
        onPause={downloadsApi.pauseMany}
        onCancel={downloadsApi.cancelMany}
        onRequestDelete={downloadsApi.requestDelete}
        onRefresh={refreshMissing}
        onShowSettings={() => setShowSettings(true)}
        onShowExtensions={() => setShowExtensions(true)}
        sidebarCollapsed={settings.sidebarCollapsed}
        onToggleSidebar={() => settings.setSidebarCollapsedSetting(!settings.sidebarCollapsed)}
      />

      {/* ---- Body: sidebar + table ---- */}
      <div className="body">
        <Sidebar
          category={sorted.category}
          setCategory={sorted.setCategory}
          totalCount={downloads.length}
          activeCount={sorted.activeItems.length}
          finishedCount={sorted.finishedItems.length}
          categoryCounts={sorted.categoryCounts}
          activeCategoryCounts={sorted.activeCategoryCounts}
          collapsed={settings.sidebarCollapsed}
        />

        <DownloadTable
          tableWrapRef={tableWrapRef}
          onTableMouseDown={marquee.handleTableMouseDown}
          onTableClick={marquee.handleTableClick}
          onTableContextMenu={handleEmptyContext}
          onHeaderContextMenu={handleHeaderContext}
          sort={sorted.sort}
          onSort={sorted.toggleSort}
          rows={infiniteRows.visibleRows}
          selectedIds={selectedIds}
          onSelectRow={selectRow}
          onRowContext={handleRowContext}
          onRowDoubleClick={handleRowDoubleClick}
          marquee={marquee.marquee}
          order={columnOrder.visible}
          widths={columnWidths.widths}
          onResizeStart={columnWidths.startResize}
          onAutoFit={columnWidths.autoFit}
          dragKey={columnOrder.dragKey}
          dropIndex={columnOrder.dropIndex}
          dragRect={columnOrder.dragRect}
          offsetX={columnOrder.offsetX}
          onReorderStart={columnOrder.startReorder}
          sentinelRef={infiniteRows.sentinelRef}
          heldUntil={queue.held ? settings.scheduledStartTime : null}
          density={rowDensity.density}
        />
      </div>

      {/* ---- Status bar ---- */}
      <div className="statusbar">
        <button
          className="sb-about"
          data-tip="About Azhura Download Manager"
          data-tip-side="top"
          onClick={() => commands.openAboutWindow()}
        >
          Azhura Download Manager{version ? ` v${version}` : ""}
        </button>
        {updater.state.stage === "ready" && (
          <button
            className="sb-update"
            data-tip={`Version ${updater.state.version} has been downloaded — restarting will apply it`}
            data-tip-side="top"
            onClick={() => setConfirmRestart(true)}
          >
            Restart to update
          </button>
        )}
        {updater.state.stage === "installing" && <span className="sb-update-note">Updating…</span>}
        {queue.held && (
          <span
            className="sb-hold"
            data-tip="Queued downloads are waiting for the scheduled start"
            data-tip-side="top"
          >
            Queue starts at {settings.scheduledStartTime}
          </span>
        )}
        <select
          className="sb-postqueue"
          aria-label="Action when the queue finishes"
          value={postQueueAction}
          onChange={(e) => setPostQueueAction(e.currentTarget.value as "none" | PowerAction)}
        >
          <option value="none">When done: nothing</option>
          <option value="sleep">When done: sleep</option>
          <option value="shutdown">When done: shut down</option>
        </select>
        <span
          className="sb-grabber"
          data-tip={
            grabber.running
              ? `Browser extension bridge listening on 127.0.0.1:${grabber.port}`
              : "No port in 47600–47609 was free — the browser extension falls back to the legacy URL-embedded handoff for this session."
          }
          data-tip-side="top"
        >
          <span className={`sb-dot ${grabber.running ? "on" : "off"}`} />
          {grabber.running ? `Grabber active · :${grabber.port}` : "Grabber inactive"}
        </span>
        {import.meta.env.DEV && (
          <span className="sb-dev" data-tip="Running a development build (tauri dev)" data-tip-side="top">
            dev
          </span>
        )}
      </div>

      {/* ---- Settings dialog ---- */}
      <AnimatePresence>
        {showSettings && (
          <SettingsDialog
            maxConcurrent={settings.maxConcurrent}
            globalLimitMbps={settings.globalLimitMbps}
            maxRetryAttempts={settings.maxRetryAttempts}
            theme={settings.theme}
            minimizeToTray={settings.minimizeToTray}
            notifications={settings.notifications}
            runAtStartup={settings.runAtStartup}
            reduceMotion={settings.reduceMotion}
            clipboardWatch={settings.clipboardWatch}
            scheduledStartEnabled={settings.scheduledStartEnabled}
            scheduledStartTime={settings.scheduledStartTime}
            historyMaxEntries={settings.historyMaxEntries}
            historyRetentionDays={settings.historyRetentionDays}
            historyCount={historyRows.length}
            globalHotkey={settings.globalHotkey}
            onSetMaxActive={settings.setMaxActive}
            onSetGlobalLimit={settings.setGlobalLimit}
            onSetMaxRetryAttempts={settings.setMaxRetryAttemptsSetting}
            onSetTheme={settings.setThemeSetting}
            onSetMinimizeToTray={settings.setMinimizeToTraySetting}
            onSetNotifications={settings.setNotificationsSetting}
            onSetRunAtStartup={settings.setRunAtStartupSetting}
            onSetReduceMotion={settings.setReduceMotionSetting}
            onSetClipboardWatch={settings.setClipboardWatchSetting}
            onSetScheduledStartEnabled={settings.setScheduledStartEnabledSetting}
            onSetScheduledStartTime={settings.setScheduledStartTimeSetting}
            onSetHistoryMaxEntries={settings.setHistoryMaxEntriesSetting}
            onSetHistoryRetentionDays={settings.setHistoryRetentionDaysSetting}
            onSetGlobalHotkey={settings.setGlobalHotkeySetting}
            onExportCsv={exportHistoryCsv}
            onClearHistory={() => {
              // Reuses the normal delete flow rather than a parallel one, so
              // the user still gets the "also delete the files" choice.
              setShowSettings(false);
              downloadsApi.requestDelete(historyRows);
            }}
            onExportBackup={exportBackup}
            onImportBackup={importBackup}
            updateChecking={updater.state.stage === "checking"}
            autoInstallUpdates={settings.autoInstallUpdates}
            onSetAutoInstallUpdates={settings.setAutoInstallUpdatesSetting}
            onCheckForUpdates={updater.checkNow}
            onClose={() => setShowSettings(false)}
          />
        )}
      </AnimatePresence>

      {/* ---- Update restart confirmation ---- */}
      <AnimatePresence>
        {confirmRestart && (
          <UpdateRestartDialog
            version={updater.state.version}
            critical={updater.state.critical}
            activeCount={activeCount}
            queuedCount={queuedCount}
            onCancel={() => setConfirmRestart(false)}
            onConfirm={() => {
              setConfirmRestart(false);
              updater.install();
            }}
          />
        )}
      </AnimatePresence>

      {/* ---- Browser extension dialog ---- */}
      <AnimatePresence>
        {showExtensions && <ExtensionsDialog onClose={() => setShowExtensions(false)} />}
      </AnimatePresence>

      {/* ---- Keyboard shortcuts cheat sheet ---- */}
      <AnimatePresence>
        {showShortcuts && <ShortcutsDialog onClose={() => setShowShortcuts(false)} />}
      </AnimatePresence>

      {/* ---- Row context menu ---- */}
      <AnimatePresence>
        {menu?.kind === "row" && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            resumableCount={resumableSel.length}
            resumeLabel={resumeLabel}
            pausableCount={pausableSel.length}
            cancelableCount={cancelableSel.length}
            canReveal={canReveal}
            canCopy={selectedItems.length > 0}
            canDelete={deletableSel.length > 0}
            canShowDetail={!!singleSelected}
            canModify={selectedItems.length > 0}
            currentSpeedLimit={singleSelected?.speedLimit ?? null}
            currentConnections={singleSelected?.connections ?? null}
            onResume={() => resumeWithOverride(resumableSel)}
            onPause={() => downloadsApi.pauseMany(pausableSel)}
            onCancel={() => downloadsApi.cancelMany(cancelableSel)}
            onReveal={() =>
              singleSelected &&
              revealItemInDir(singleSelected.path).catch(() =>
                showToast("Couldn't open the containing folder — the file may have moved."),
              )
            }
            onCopyLink={() => copyLinks(selectedItems)}
            onShowDetail={() => singleSelected && openDetail(singleSelected.id)}
            onSpeedCap={(bytes) => downloadsApi.applySpeedCap(selectedItems, bytes)}
            onCustomSpeedCap={() =>
              setSpeedCapDialog({
                items: selectedItems,
                mbps: singleSelected ? singleSelected.speedLimit / (1024 * 1024) : 0,
              })
            }
            onConnections={(n) => downloadsApi.applyConnections(selectedItems, n)}
            onDelete={() => downloadsApi.requestDelete(selectedItems)}
            onClose={() => setMenu(null)}
          />
        )}
      </AnimatePresence>

      {/* ---- Empty-space context menu ---- */}
      <AnimatePresence>
        {menu?.kind === "empty" && (
          <TableContextMenu
            x={menu.x}
            y={menu.y}
            clipboardUrl={clipboardUrl}
            selectableCount={sorted.rows.length}
            clearableCount={clearableRows.length}
            onSelectAll={() => setSelectedIds(new Set(sorted.rows.map((d) => d.id)))}
            onRefresh={refreshMissing}
            onClearHistory={() => downloadsApi.requestDelete(clearableRows)}
            onOpenSettings={() => setShowSettings(true)}
            onClose={() => setMenu(null)}
          />
        )}
      </AnimatePresence>

      {/* ---- Column show/hide menu (right-click the header row) ---- */}
      <AnimatePresence>
        {menu?.kind === "columns" && (
          <ColumnMenu
            x={menu.x}
            y={menu.y}
            order={columnOrder.order}
            hidden={columnVisibility.hidden}
            onToggle={columnVisibility.toggle}
            onShowAll={columnVisibility.showAll}
            density={rowDensity.density}
            onDensity={rowDensity.setDensity}
            onClose={() => setMenu(null)}
          />
        )}
      </AnimatePresence>

      {/* ---- Delete confirmation ---- */}
      <AnimatePresence>
        {downloadsApi.pendingDelete && (
          <DeleteDialog
            items={downloadsApi.pendingDelete}
            deleteWithFile={downloadsApi.deleteWithFile}
            onToggleDeleteWithFile={downloadsApi.setDeleteWithFile}
            onCancel={() => downloadsApi.setPendingDelete(null)}
            onConfirm={downloadsApi.confirmDelete}
          />
        )}
      </AnimatePresence>

      {/* ---- Custom speed cap dialog ---- */}
      <AnimatePresence>
        {speedCapDialog && (
          <SpeedCapDialog
            dialog={speedCapDialog}
            onChangeMbps={(mbps) => setSpeedCapDialog({ ...speedCapDialog, mbps })}
            onApply={(items, bytesPerSec) => {
              downloadsApi.applySpeedCap(items, bytesPerSec);
              setSpeedCapDialog(null);
            }}
            onCancel={() => setSpeedCapDialog(null)}
          />
        )}
      </AnimatePresence>

      {/* ---- Connections-change restart confirmation ---- */}
      <AnimatePresence>
        {downloadsApi.connRestart && (
          <ConnRestartDialog
            itemCount={downloadsApi.connRestart.items.length}
            onApplyOnNextStart={() => downloadsApi.setConnRestart(null)}
            onRestartNow={downloadsApi.confirmConnRestart}
          />
        )}
      </AnimatePresence>

      {/* ---- Post-queue sleep/shutdown countdown ---- */}
      <AnimatePresence>
        {pendingPower && (
          <PowerActionDialog
            action={pendingPower}
            onCancel={() => setPendingPower(null)}
            onConfirm={() => {
              commands
                .runPowerAction(pendingPower)
                .catch(() => showToast("Couldn't run the power action."));
              setPendingPower(null);
            }}
          />
        )}
      </AnimatePresence>

      <ToastHost />
    </div>
  );
}

export default App;
