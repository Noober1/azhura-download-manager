import type { MouseEvent as ReactMouseEvent, RefObject } from "react";
import type { DownloadItem } from "../types";
import { formatBytes, formatSpeed, pctOf, statusClass, statusLabel, formatDateAdded } from "../format";
import { FileIcon } from "../fileIcons";
import type { SortKey } from "../constants";

/* A sortable column header: click cycles asc → desc → default (unsorted)
   for its own key, and starts at asc when switching from a different key. */
function SortTh({
  className,
  label,
  sortKey,
  sort,
  onSort,
}: {
  className: string;
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; dir: "asc" | "desc" } | null;
  onSort: (key: SortKey) => void;
}) {
  const active = sort?.key === sortKey;
  const ariaSort = active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none";
  return (
    <th
      className={`${className} sortable`}
      aria-sort={ariaSort}
      onClick={() => onSort(sortKey)}
    >
      {label}
      {active && <span className="sort-arrow">{sort!.dir === "asc" ? "▲" : "▼"}</span>}
    </th>
  );
}

/* A single row in the download table. Double-click (any state) opens the
   "Download Details" popup — see `onOpenDetail` — which now owns everything
   that used to expand inline here (per-connection bars, paths, etc). */
function Row({
  item,
  pct,
  selected,
  onSelect,
  onContext,
  onOpenDetail,
}: {
  item: DownloadItem;
  pct: number | null;
  selected: boolean;
  onSelect: (e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => void;
  onContext: (e: ReactMouseEvent) => void;
  onOpenDetail: () => void;
}) {
  return (
    <tr
      className={`drow ${selected ? "selected" : ""}`}
      data-id={item.id}
      onClick={onSelect}
      onDoubleClick={onOpenDetail}
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
  onOpenDetail,
  marquee,
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
  onOpenDetail: (id: string) => void;
  marquee: { left: number; top: number; width: number; height: number } | null;
}) {
  return (
    <>
      <main
        className="table-wrap"
        ref={tableWrapRef}
        onMouseDown={onTableMouseDown}
        onClick={onTableClick}
      >
        <table className="dtable">
          <thead>
            <tr>
              <SortTh className="col-name" label="Name" sortKey="name" sort={sort} onSort={onSort} />
              <SortTh
                className="col-added"
                label="Date Added"
                sortKey="added"
                sort={sort}
                onSort={onSort}
              />
              <SortTh
                className="col-status"
                label="Status"
                sortKey="status"
                sort={sort}
                onSort={onSort}
              />
              <SortTh className="col-num" label="Size" sortKey="size" sort={sort} onSort={onSort} />
              <SortTh
                className="col-num"
                label="Downloaded"
                sortKey="downloaded"
                sort={sort}
                onSort={onSort}
              />
              <SortTh
                className="col-pct"
                label="Percentage"
                sortKey="pct"
                sort={sort}
                onSort={onSort}
              />
              <SortTh
                className="col-num col-speed"
                label="Speed"
                sortKey="speed"
                sort={sort}
                onSort={onSort}
              />
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
                  onOpenDetail={() => onOpenDetail(item.id)}
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
