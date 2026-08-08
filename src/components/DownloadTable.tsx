import type { MouseEvent as ReactMouseEvent, RefObject } from "react";
import type { DownloadItem } from "../types";
import { formatBytes, formatSpeed, pctOf, statusClass, statusLabel, formatDateAdded } from "../format";
import { FileIcon } from "../fileIcons";
import type { SortKey } from "../constants";
import { COLUMN_ORDER, totalWidth, type ColumnWidths } from "../columns";

/* A sortable column header: click cycles asc → desc → default (unsorted)
   for its own key, and starts at asc when switching from a different key.
   A drag on the trailing resize handle must not also toggle sort — that's
   what `didResizeRef` (shared with `useColumnWidths`) suppresses, the same
   way `useSelection`'s `didDragRef` suppresses a marquee drag's trailing
   click. */
function SortTh({
  className,
  label,
  sortKey,
  sort,
  onSort,
  onResizeStart,
  onAutoFit,
  didResizeRef,
}: {
  className: string;
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; dir: "asc" | "desc" } | null;
  onSort: (key: SortKey) => void;
  onResizeStart: (key: SortKey, e: ReactMouseEvent) => void;
  onAutoFit: (key: SortKey) => void;
  didResizeRef: RefObject<boolean>;
}) {
  const active = sort?.key === sortKey;
  const ariaSort = active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none";
  return (
    <th
      className={`${className} sortable`}
      aria-sort={ariaSort}
      onClick={() => {
        if (didResizeRef.current) {
          didResizeRef.current = false;
          return;
        }
        onSort(sortKey);
      }}
    >
      {label}
      {active && <span className="sort-arrow">{sort!.dir === "asc" ? "▲" : "▼"}</span>}
      <span
        className="col-resizer"
        onMouseDown={(e) => onResizeStart(sortKey, e)}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onAutoFit(sortKey);
        }}
      />
    </th>
  );
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
  onSelect,
  onContext,
  onDoubleClick,
}: {
  item: DownloadItem;
  pct: number | null;
  selected: boolean;
  onSelect: (e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => void;
  onContext: (e: ReactMouseEvent) => void;
  onDoubleClick: () => void;
}) {
  return (
    <tr
      className={`drow ${selected ? "selected" : ""}`}
      data-id={item.id}
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContext(e);
      }}
    >
      <td className="col-name" title={item.path || item.url}>
        <span className="name-cell">
          <FileIcon name={item.filename} />
          <span className="name-text">{item.filename}</span>
        </span>
      </td>
      <td className="col-added">{formatDateAdded(item.addedAt)}</td>
      <td className="col-status">
        {/* One state class only — `.mode-tag.missing` and `.mode-tag.completed`
            have equal specificity, so both applying would be order-dependent. */}
        <span className={`mode-tag ${statusClass(item)}`}>{statusLabel(item)}</span>
      </td>
      <td className="col-num">{item.total ? formatBytes(item.total) : "—"}</td>
      <td className="col-num">{formatBytes(item.downloaded)}</td>
      <td className="col-pct">{pct !== null ? `${pct.toFixed(0)}%` : "—"}</td>
      <td className="col-num col-speed">
        {item.state === "downloading" ? formatSpeed(item.speed) : "—"}
      </td>
    </tr>
  );
}

export function DownloadTable({
  tableWrapRef,
  onTableMouseDown,
  onTableClick,
  sort,
  onSort,
  rows,
  selectedIds,
  onSelectRow,
  onRowContext,
  onRowDoubleClick,
  marquee,
  widths,
  onResizeStart,
  onAutoFit,
  didResizeRef,
}: {
  tableWrapRef: RefObject<HTMLElement | null>;
  onTableMouseDown: (e: ReactMouseEvent) => void;
  onTableClick: (e: ReactMouseEvent) => void;
  sort: { key: SortKey; dir: "asc" | "desc" } | null;
  onSort: (key: SortKey) => void;
  rows: DownloadItem[];
  selectedIds: Set<string>;
  onSelectRow: (id: string, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => void;
  onRowContext: (e: ReactMouseEvent, item: DownloadItem) => void;
  onRowDoubleClick: (item: DownloadItem) => void;
  marquee: { left: number; top: number; width: number; height: number } | null;
  widths: ColumnWidths;
  onResizeStart: (key: SortKey, e: ReactMouseEvent) => void;
  onAutoFit: (key: SortKey) => void;
  didResizeRef: RefObject<boolean>;
}) {
  const headerProps = { sort, onSort, onResizeStart, onAutoFit, didResizeRef };
  return (
    <>
      <main
        className="table-wrap"
        ref={tableWrapRef}
        onMouseDown={onTableMouseDown}
        onClick={onTableClick}
      >
        <table className="dtable" style={{ width: totalWidth(widths) }}>
          <colgroup>
            {COLUMN_ORDER.map((key) => (
              <col key={key} style={{ width: widths[key] }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <SortTh className="col-name" label="Name" sortKey="name" {...headerProps} />
              <SortTh className="col-added" label="Date Added" sortKey="added" {...headerProps} />
              <SortTh className="col-status" label="Status" sortKey="status" {...headerProps} />
              <SortTh className="col-num" label="Size" sortKey="size" {...headerProps} />
              <SortTh className="col-num" label="Downloaded" sortKey="downloaded" {...headerProps} />
              <SortTh className="col-pct" label="Percentage" sortKey="pct" {...headerProps} />
              <SortTh className="col-num col-speed" label="Speed" sortKey="speed" {...headerProps} />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="empty-cell">
                  No downloads here — click <strong>+</strong> to add one.
                </td>
              </tr>
            )}
            {rows.map((item) => {
              const pct = pctOf(item);
              const selectedRow = selectedIds.has(item.id);
              return (
                <Row
                  key={item.id}
                  item={item}
                  pct={pct}
                  selected={selectedRow}
                  onSelect={(e) => onSelectRow(item.id, e)}
                  onContext={(e) => onRowContext(e, item)}
                  onDoubleClick={() => onRowDoubleClick(item)}
                />
              );
            })}
          </tbody>
        </table>
      </main>

      {marquee && <div className="marquee" style={marquee} />}
    </>
  );
}

export default DownloadTable;
