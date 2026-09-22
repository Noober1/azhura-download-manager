import { Fragment, type MouseEvent as ReactMouseEvent, type RefObject } from "react";
import type { DownloadItem } from "../types";
import {
  formatBytes,
  formatSpeed,
  formatEta,
  etaOf,
  piecesDoneOf,
  pctOf,
  statusClass,
  statusLabel,
  formatDateAdded,
} from "../format";
import { FileIcon } from "../fileIcons";
import { Icon } from "../ui";
import type { SortKey } from "../constants";
import {
  COLUMN_CLASS,
  COLUMN_LABEL,
  totalWidth,
  type ColumnWidths,
  type RowDensity,
} from "../columns";
import type { DragRect } from "../hooks/useColumnOrder";
import type { GroupMeta } from "../hooks/useGroupedRows";

/* A sortable, reorderable column header: click cycles asc → desc → default
   (unsorted) for its own key, and starts at asc when switching from a
   different key. Neither a resize drag on the trailing handle nor a reorder
   drag on the header itself can leak into this `onClick` as a stray sort —
   both `useColumnWidths` and `useColumnOrder` arm a one-shot
   `suppressNextClick()` on their own `mouseup` when a real drag happened,
   which stops the trailing click before it reaches here (see either hook's
   module comment for why a same-element flag check can't do this). */
function SortTh({
  className,
  label,
  sortKey,
  sort,
  onSort,
  onResizeStart,
  onAutoFit,
  onReorderStart,
  dragging,
  dropBefore,
  dropAfter,
}: {
  className: string;
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; dir: "asc" | "desc" } | null;
  onSort: (key: SortKey) => void;
  onResizeStart: (key: SortKey, e: ReactMouseEvent) => void;
  onAutoFit: (key: SortKey) => void;
  onReorderStart: (key: SortKey, e: ReactMouseEvent) => void;
  dragging: boolean;
  dropBefore: boolean;
  dropAfter: boolean;
}) {
  const active = sort?.key === sortKey;
  const ariaSort = active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none";
  return (
    <th
      className={`${className} sortable ${dragging ? "col-dragging" : ""} ${
        dropBefore ? "col-drop-before" : ""
      } ${dropAfter ? "col-drop-after" : ""}`}
      aria-sort={ariaSort}
      onMouseDown={(e) => onReorderStart(sortKey, e)}
      onClick={() => onSort(sortKey)}
    >
      {label}
      {active && <span className="sort-arrow">{sort!.dir === "asc" ? "▲" : "▼"}</span>}
      <span
        className="col-resizer"
        onMouseDown={(e) => {
          e.stopPropagation();
          onResizeStart(sortKey, e);
        }}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onAutoFit(sortKey);
        }}
      />
    </th>
  );
}

/** Drag-reorder state/handlers for the Queue column — threaded down from
 *  `useQueueDrag` in App.tsx. */
export type QueueColumnProps = {
  positions: Map<string, number>;
  /** Sorted by Queue asc AND grouping off. */
  canDrag: boolean;
  dragId: string | null;
  dropBefore: string | "end" | null;
  onGripMouseDown: (id: string, e: ReactMouseEvent) => void;
};

/** Renders one `<td>` for `key`, in the shape `Row` used to hardcode inline —
 *  moved here unchanged so both the header and the body can be driven by the
 *  same `order` array. */
function renderCell(
  key: SortKey,
  item: DownloadItem,
  pct: number | null,
  heldUntil: string | null,
  queue: QueueColumnProps,
) {
  switch (key) {
    case "queue": {
      const pos = queue.positions.get(item.id);
      return (
        <td key={key} className={COLUMN_CLASS.queue}>
          {pos !== undefined && (
            <span
              className="queue-cell"
              // Only the cell itself carries the "why can't I drag" hint when
              // dragging is off — the grip below isn't even in the DOM then,
              // so there's nothing dimmed/disabled-looking to explain.
              data-tip={queue.canDrag ? undefined : "Sort by the Queue column to reorder"}
            >
              {queue.canDrag && (
                <span
                  className="queue-grip"
                  aria-hidden="true"
                  data-tip="Drag to reorder"
                  onMouseDown={(e) => queue.onGripMouseDown(item.id, e)}
                >
                  ⋮⋮
                </span>
              )}
              <span className="queue-num">{pos}</span>
            </span>
          )}
        </td>
      );
    }
    case "name":
      return (
        <td key={key} className={COLUMN_CLASS.name} data-tip={item.path || item.url}>
          <span className="name-cell">
            <FileIcon name={item.filename} />
            <span className="name-text">{item.filename}</span>
          </span>
        </td>
      );
    case "added":
      return (
        <td key={key} className={COLUMN_CLASS.added}>
          {formatDateAdded(item.addedAt)}
        </td>
      );
    case "status":
      return (
        <td key={key} className={COLUMN_CLASS.status}>
          {/* One state class only — `.mode-tag.missing` and `.mode-tag.completed`
              have equal specificity, so both applying would be order-dependent. */}
          <span
            className={`mode-tag ${statusClass(item, heldUntil)}`}
            data-tip={
              heldUntil && item.state === "queued"
                ? "Waiting for the scheduled start"
                : undefined
            }
          >
            {statusLabel(item, heldUntil)}
          </span>
        </td>
      );
    case "size":
      return (
        <td key={key} className={COLUMN_CLASS.size}>
          {item.total ? formatBytes(item.total) : "—"}
        </td>
      );
    case "downloaded":
      return (
        <td key={key} className={COLUMN_CLASS.downloaded}>
          {formatBytes(item.downloaded)}
        </td>
      );
    case "pct":
      return (
        <td key={key} className={COLUMN_CLASS.pct}>
          <span className="cell-pct pct-overlay">
            <span className="mini-track">
              <span
                className={`mini-bar ${
                  item.state === "completed" && !item.missing ? "done" : ""
                } ${item.state === "error" || item.state === "canceled" ? "error" : ""} ${
                  pct === null && item.state === "downloading" ? "indeterminate" : ""
                }`}
                style={pct !== null ? { width: `${pct}%` } : undefined}
              />
            </span>
            <span className="pct-num">{pct !== null ? `${pct.toFixed(0)}%` : "—"}</span>
          </span>
        </td>
      );
    case "speed":
      return (
        <td key={key} className={COLUMN_CLASS.speed}>
          {item.state === "downloading" ? formatSpeed(item.speed) : "—"}
        </td>
      );
    case "eta": {
      // Gated on "downloading" for the same reason Speed is: a paused row's
      // last known rate is stale the moment it stops, and projecting a
      // finish time from it would be a number that never ticks down.
      const eta = item.state === "downloading" ? etaOf(item) : null;
      return (
        <td key={key} className={COLUMN_CLASS.eta}>
          {eta !== null ? formatEta(eta) : "—"}
        </td>
      );
    }
    case "conns":
      // The configured maximum, which is the number the Connections submenu
      // sets and the only one that means anything for a row that isn't
      // running. How many of them are actually live is a downloading-only
      // fact, so it goes in the tooltip rather than the cell.
      return (
        <td
          key={key}
          className={COLUMN_CLASS.conns}
          data-tip={
            item.state === "downloading"
              ? `${item.usedConnections} of ${item.connections} connections in use`
              : undefined
          }
        >
          {item.connections}
        </td>
      );
    case "pieces": {
      const done = piecesDoneOf(item);
      return (
        <td
          key={key}
          className={COLUMN_CLASS.pieces}
          data-tip={
            done !== null
              ? `${done} of ${item.numPieces} pieces downloaded (${formatBytes(item.pieceSize)} each)`
              : undefined
          }
        >
          {done !== null ? `${done} / ${item.numPieces}` : "—"}
        </td>
      );
    }
  }
}

/* A single row in the download table. Double-click reveals the file's
   containing folder when it's completed and still on disk; otherwise it
   falls back to opening the "Download Details" popup (the old unconditional
   behavior) — see `onDoubleClick`, whose fallback logic lives in App.tsx's
   `handleRowDoubleClick`. */
function Row({
  item,
  pct,
  selected,
  order,
  heldUntil,
  queue,
  onSelect,
  onContext,
  onDoubleClick,
}: {
  item: DownloadItem;
  pct: number | null;
  selected: boolean;
  order: SortKey[];
  /** Scheduled start time ("HH:MM") when the scheduler is holding the queue,
   *  or null otherwise — see `statusLabel`/`statusClass` in format.ts. */
  heldUntil: string | null;
  queue: QueueColumnProps;
  onSelect: (e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => void;
  onContext: (e: ReactMouseEvent) => void;
  onDoubleClick: () => void;
}) {
  const dragging = queue.dragId === item.id;
  const dropBeforeThis = queue.dropBefore === item.id;
  const dropAfterThis = queue.dropBefore === "end" && queue.positions.get(item.id) === queue.positions.size;
  return (
    <tr
      className={`drow ${selected ? "selected" : ""} ${dragging ? "queue-dragging" : ""} ${
        dropBeforeThis ? "queue-drop-before" : ""
      } ${dropAfterThis ? "queue-drop-after" : ""}`}
      data-id={item.id}
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContext(e);
      }}
    >
      {order.map((key) => renderCell(key, item, pct, heldUntil, queue))}
    </tr>
  );
}

/* A group header row (see `useGroupedRows`). Deliberately NOT `.drow`:
   `useMarquee`'s `querySelectorAll(".drow")` hit-test and
   `useColumnWidths.autoFit`'s `.dtable tbody tr.drow` measurement both sweep
   that class, and a header row is neither selectable nor measurable. The
   collapse chevron is the same rotated-`▸` pattern
   `ArchiveTree.tsx`/`archive-window.css` already use — there's no chevron
   glyph in `Icon` (`src/ui.tsx`). */
function GroupRow({
  group,
  colSpan,
  onToggle,
}: {
  group: GroupMeta;
  colSpan: number;
  onToggle: (key: string) => void;
}) {
  return (
    <tr className="group-row">
      <td colSpan={colSpan}>
        <button
          className="group-toggle"
          aria-expanded={!group.collapsed}
          onClick={() => onToggle(group.key)}
        >
          <span
            className={`group-chevron ${group.collapsed ? "" : "expanded"}`}
            aria-hidden="true"
          >
            ▸
          </span>
          <span className="group-label">{group.label}</span>
          <span className="group-count">{group.count}</span>
        </button>
      </td>
    </tr>
  );
}

export function DownloadTable({
  tableWrapRef,
  onTableMouseDown,
  onTableClick,
  onTableContextMenu,
  onHeaderContextMenu,
  sort,
  onSort,
  rows,
  selectedIds,
  onSelectRow,
  onRowContext,
  onRowDoubleClick,
  marquee,
  order,
  widths,
  onResizeStart,
  onAutoFit,
  dragKey,
  dropIndex,
  dragRect,
  offsetX,
  onReorderStart,
  sentinelRef,
  heldUntil,
  density,
  headersBefore,
  trailingGroups,
  onToggleGroup,
  queue,
  hidden,
}: {
  tableWrapRef: RefObject<HTMLElement | null>;
  onTableMouseDown: (e: ReactMouseEvent) => void;
  onTableClick: (e: ReactMouseEvent) => void;
  /** Only ever fires for empty table space — every `.drow`'s own
   *  `onContextMenu` already calls `stopPropagation()`, so a row right-click
   *  never reaches this handler. */
  onTableContextMenu: (e: ReactMouseEvent) => void;
  /** Right-click anywhere in the header row — opens the show/hide-columns
   *  menu. Stops propagation so `onTableContextMenu` above never also fires. */
  onHeaderContextMenu: (e: ReactMouseEvent) => void;
  sort: { key: SortKey; dir: "asc" | "desc" } | null;
  onSort: (key: SortKey) => void;
  rows: DownloadItem[];
  selectedIds: Set<string>;
  onSelectRow: (id: string, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => void;
  onRowContext: (e: ReactMouseEvent, item: DownloadItem) => void;
  onRowDoubleClick: (item: DownloadItem) => void;
  marquee: { left: number; top: number; width: number; height: number } | null;
  /** The columns actually on screen, left to right — `useColumnOrder`'s
   *  `visible`, never its full `order`. */
  order: SortKey[];
  widths: ColumnWidths;
  onResizeStart: (key: SortKey, e: ReactMouseEvent) => void;
  onAutoFit: (key: SortKey) => void;
  /** Marks the end of the currently-rendered rows for `useInfiniteRows`'s
   *  `IntersectionObserver` to watch — rendered as an empty `<tr>` right
   *  after the real rows, never as a `.drow` (so `useMarquee`/`autoFit`/
   *  `scrollRowIntoView`, which all sweep `.drow`, never see it). */
  sentinelRef?: RefObject<HTMLTableRowElement | null>;
  dragKey: SortKey | null;
  dropIndex: number | null;
  /** Dragged header's own rect at drag start, and how far the cursor has
   *  moved horizontally since — together they position the floating ghost
   *  below. Both null/0 outside an active drag. */
  dragRect: DragRect | null;
  offsetX: number;
  onReorderStart: (key: SortKey, e: ReactMouseEvent) => void;
  /** Scheduled start time ("HH:MM") when `useQueueSchedule`'s `held` is true,
   *  or null when the queue isn't being held — threaded down to every row's
   *  Status cell so a queued item reads "Scheduled HH:MM" instead of plain
   *  "Queued". */
  heldUntil: string | null;
  /** Compact vs comfortable row height — set as `data-density` on the
   *  scrolling wrapper so `table.css` can key `--row-h` off it. */
  density: RowDensity;
  /** Group headers (see `useGroupedRows`) to render immediately before a
   *  given row id — a list, not a single value, because a run of collapsed
   *  groups has no row of its own to anchor to. Empty when grouping is off. */
  headersBefore: Map<string, GroupMeta[]>;
  /** Group headers with no row after them: collapsed groups at the tail of
   *  the current view, or every group when all of them are collapsed. */
  trailingGroups: GroupMeta[];
  onToggleGroup: (key: string) => void;
  /** Drag-reorder state/handlers for the Queue column. */
  queue: QueueColumnProps;
  /** True while the dashboard is shown instead — the table stays mounted
   *  (see App.tsx's `view` state) so refs stay valid and scroll position is
   *  kept, just visually hidden via `table.css`'s `.table-wrap[hidden]`. */
  hidden?: boolean;
}) {
  return (
    <>
      <main
        className="table-wrap"
        data-density={density}
        hidden={hidden}
        ref={tableWrapRef}
        onMouseDown={onTableMouseDown}
        onClick={onTableClick}
        onContextMenu={onTableContextMenu}
      >
        <table className="dtable" style={{ minWidth: totalWidth(widths, order) }}>
          {/* Every column but `name` is a fixed `<col>` width; `name` gets none, so
              under `table-layout: fixed` it's the sole flex column — it absorbs
              whatever space `.table-wrap` has beyond the other visible columns'
              widths. A drag or double-click auto-fit on `name`'s resizer only
              narrows it back below that floor; while there's slack,
              widening/auto-fitting it has no visible effect, because the rendered
              width is `max(wrap width, minWidth)`, not `sum(widths)`. With `name`
              itself hidden there is no flex column at all, and the browser shares
              any slack out across the fixed columns instead — which is fine, since
              nothing then depends on one column absorbing it. */}
          <colgroup>
            {order.map((key) =>
              key === "name" ? (
                <col key={key} />
              ) : (
                <col key={key} style={{ width: widths[key] }} />
              ),
            )}
          </colgroup>
          {/* The header's own right-click opens the columns menu, and must
              `stopPropagation` so `.table-wrap`'s `onContextMenu` (the
              empty-space menu) doesn't also fire — the same guard `.drow`
              already uses for the row menu. */}
          <thead
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onHeaderContextMenu(e);
            }}
          >
            <tr>
              {order.map((key, i) => (
                <SortTh
                  key={key}
                  className={COLUMN_CLASS[key]}
                  label={COLUMN_LABEL[key]}
                  sortKey={key}
                  sort={sort}
                  onSort={onSort}
                  onResizeStart={onResizeStart}
                  onAutoFit={onAutoFit}
                  onReorderStart={onReorderStart}
                  dragging={dragKey === key}
                  dropBefore={dropIndex === i}
                  dropAfter={i === order.length - 1 && dropIndex === order.length}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {/* With every group collapsed there are no rows at all, but the
                table isn't empty — its headers still render below. */}
            {rows.length === 0 && trailingGroups.length === 0 && (
              <tr>
                <td colSpan={order.length} className="empty-cell">
                  <span className="empty-state">
                    <span className="empty-icon">
                      <Icon name="tray" size={22} />
                    </span>
                    <p className="empty-title">No downloads yet</p>
                    <p className="empty-hint">
                      Click <strong>+</strong> in the toolbar to add one.
                    </p>
                  </span>
                </td>
              </tr>
            )}
            {rows.map((item) => {
              const pct = pctOf(item);
              const selectedRow = selectedIds.has(item.id);
              return (
                <Fragment key={item.id}>
                  {headersBefore.get(item.id)?.map((g) => (
                    <GroupRow key={g.key} group={g} colSpan={order.length} onToggle={onToggleGroup} />
                  ))}
                  <Row
                    item={item}
                    pct={pct}
                    selected={selectedRow}
                    order={order}
                    heldUntil={heldUntil}
                    queue={queue}
                    onSelect={(e) => onSelectRow(item.id, e)}
                    onContext={(e) => onRowContext(e, item)}
                    onDoubleClick={() => onRowDoubleClick(item)}
                  />
                </Fragment>
              );
            })}
            {rows.length > 0 && <tr ref={sentinelRef} className="row-sentinel" aria-hidden="true" />}
            {trailingGroups.map((g) => (
              <GroupRow key={g.key} group={g} colSpan={order.length} onToggle={onToggleGroup} />
            ))}
          </tbody>
        </table>
      </main>

      {marquee && <div className="marquee" style={marquee} />}

      {/* Floating ghost of the dragged header — X axis only, per the design
          in `useColumnOrder`'s module comment: it follows the cursor
          horizontally but stays pinned to the header's own top vertically,
          since columns only ever reorder left-right. Rendered as a plain
          `position: fixed` sibling of `.table-wrap` (not a portal) — the
          same approach `.marquee` above already uses successfully. */}
      {dragKey && dragRect && (
        <div
          className="col-drag-ghost"
          style={{
            left: dragRect.left + offsetX,
            top: dragRect.top,
            width: dragRect.width,
            height: dragRect.height,
          }}
        >
          {COLUMN_LABEL[dragKey]}
        </div>
      )}
    </>
  );
}

export default DownloadTable;
