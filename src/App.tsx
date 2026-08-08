import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { AnimatePresence } from "motion/react";
import { commands } from "./bindings";
import type { DownloadItem } from "./types";
import { isResumable, isRedownload } from "./format";
import { showToast } from "./toast";
import { ToastHost } from "./components/Toast";
import { useNativeShell } from "./ui";
import { useDownloads } from "./hooks/useDownloads";
import { useScheduler } from "./hooks/useScheduler";
import { useHistoryPersistence } from "./hooks/useHistoryPersistence";
import { useSettings } from "./hooks/useSettings";
import { useTrayPush } from "./hooks/useTrayPush";
import { useDetailWindows } from "./hooks/useDetailWindows";
import { useDeepLinkCapture } from "./hooks/useDeepLinkCapture";
import { useSortedRows } from "./hooks/useSortedRows";
import { useColumnWidths } from "./hooks/useColumnWidths";
import { useMissingRefresh } from "./hooks/useMissingRefresh";
import { useGrabberStatus } from "./hooks/useGrabberStatus";
import { useBackendWarnings } from "./hooks/useBackendWarnings";
import { useSelection } from "./selection/useSelection";
import { useMarquee } from "./selection/useMarquee";
import { useTableKeyboard } from "./selection/useTableKeyboard";
import { Toolbar } from "./components/Toolbar";
import { Sidebar } from "./components/Sidebar";
import { DownloadTable } from "./components/DownloadTable";
import { ContextMenu } from "./components/ContextMenu";
import { SettingsDialog } from "./components/dialogs/SettingsDialog";
import { ExtensionsDialog } from "./components/dialogs/ExtensionsDialog";
import { DeleteDialog } from "./components/dialogs/DeleteDialog";
import { SpeedCapDialog } from "./components/dialogs/SpeedCapDialog";
import { ConnRestartDialog } from "./components/dialogs/ConnRestartDialog";
import "./App.css";

function App() {
  const [version, setVersion] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showExtensions, setShowExtensions] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  // Custom… speed-cap dialog, opened from the context menu's submenu.
  const [speedCapDialog, setSpeedCapDialog] = useState<{ items: DownloadItem[]; mbps: number } | null>(
    null,
  );

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
  const columnWidths = useColumnWidths();

  const { openDetail } = useDetailWindows(
    downloads,
    downloadsRef,
    downloadsApi.pauseMany,
    downloadsApi.cancelMany,
    downloadsApi.resumeMany,
  );

  useScheduler(downloads, settings.maxConcurrent, downloadsApi.startRun);
  useHistoryPersistence(downloads, setDownloads, downloadsRef);
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

  function handleRowContext(e: ReactMouseEvent, item: DownloadItem) {
    if (!selectedIds.has(item.id)) {
      anchorRef.current = item.id;
      setSelectedIds(new Set([item.id]));
    }
    setMenu({ x: e.clientX, y: e.clientY });
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

  const anyDialogOpen = !!(
    downloadsApi.pendingDelete ||
    showSettings ||
    showExtensions ||
    menu ||
    speedCapDialog ||
    downloadsApi.connRestart
  );

  const totalSpeed = downloads
    .filter((d) => d.state === "downloading")
    .reduce((s, d) => s + d.speed, 0);
  const activeCount = downloads.filter(
    (d) => d.state === "downloading" || d.state === "verifying",
  ).length;
  const queuedCount = downloads.filter((d) => d.state === "queued").length;

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
    scrollRowIntoView,
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
        searchQuery={sorted.searchQuery}
        onSearchChange={sorted.setSearchQuery}
        onResume={downloadsApi.resumeMany}
        onPause={downloadsApi.pauseMany}
        onCancel={downloadsApi.cancelMany}
        onRequestDelete={downloadsApi.requestDelete}
        onRefresh={refreshMissing}
        onShowSettings={() => setShowSettings(true)}
        onShowExtensions={() => setShowExtensions(true)}
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
        />

        <DownloadTable
          tableWrapRef={tableWrapRef}
          onTableMouseDown={marquee.handleTableMouseDown}
          onTableClick={marquee.handleTableClick}
          sort={sorted.sort}
          onSort={sorted.toggleSort}
          rows={rows}
          selectedIds={selectedIds}
          onSelectRow={selectRow}
          onRowContext={handleRowContext}
          onRowDoubleClick={handleRowDoubleClick}
          marquee={marquee.marquee}
          widths={columnWidths.widths}
          onResizeStart={columnWidths.startResize}
          onAutoFit={columnWidths.autoFit}
          didResizeRef={columnWidths.didResizeRef}
        />
      </div>

      {/* ---- Status bar ---- */}
      <div className="statusbar">
        <span>Azhura Download Manager{version ? ` v${version}` : ""}</span>
        <span
          className="sb-grabber"
          title={
            grabber.running
              ? `Browser extension bridge listening on 127.0.0.1:${grabber.port}`
              : "No port in 47600–47609 was free — the browser extension falls back to the legacy URL-embedded handoff for this session."
          }
        >
          <span className={`sb-dot ${grabber.running ? "on" : "off"}`} />
          {grabber.running ? `Grabber active · :${grabber.port}` : "Grabber inactive"}
        </span>
      </div>

      {/* ---- Settings dialog ---- */}
      <AnimatePresence>
        {showSettings && (
          <SettingsDialog
            maxConcurrent={settings.maxConcurrent}
            globalLimitMbps={settings.globalLimitMbps}
            theme={settings.theme}
            minimizeToTray={settings.minimizeToTray}
            notifications={settings.notifications}
            runAtStartup={settings.runAtStartup}
            onSetMaxActive={settings.setMaxActive}
            onSetGlobalLimit={settings.setGlobalLimit}
            onSetTheme={settings.setThemeSetting}
            onSetMinimizeToTray={settings.setMinimizeToTraySetting}
            onSetNotifications={settings.setNotificationsSetting}
            onSetRunAtStartup={settings.setRunAtStartupSetting}
            onClose={() => setShowSettings(false)}
          />
        )}
      </AnimatePresence>

      {/* ---- Browser extension dialog ---- */}
      <AnimatePresence>
        {showExtensions && <ExtensionsDialog onClose={() => setShowExtensions(false)} />}
      </AnimatePresence>

      {/* ---- Row context menu ---- */}
      <AnimatePresence>
        {menu && (
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
            onResume={() => downloadsApi.resumeMany(resumableSel)}
            onPause={() => downloadsApi.pauseMany(pausableSel)}
            onCancel={() => downloadsApi.cancelMany(cancelableSel)}
            onReveal={() =>
              singleSelected &&
              revealItemInDir(singleSelected.path).catch(() =>
                showToast("Couldn't open the containing folder — the file may have moved."),
              )
            }
            onCopyLink={() =>
              writeText(selectedItems.map((i) => i.url).join("\n")).catch(() =>
                showToast("Couldn't copy to clipboard."),
              )
            }
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

      <ToastHost />
    </div>
  );
}

export default App;
