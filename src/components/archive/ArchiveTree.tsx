import folderIcon from "material-icon-theme/icons/folder.svg?url";
import folderOpenIcon from "material-icon-theme/icons/folder-open.svg?url";
import { FileIcon } from "../../fileIcons";
import { formatBytes } from "../../format";
import type { TreeNode } from "../../archiveTree";

type Props = {
  nodes: TreeNode[];
  depth?: number;
  isExpanded: (path: string) => boolean;
  onToggle: (path: string) => void;
};

/** Flat list of `.archive-row`s rather than nested DOM — each row's own
 *  indentation (via `depth`) draws the tree shape, so expanding/collapsing a
 *  folder is just changing which rows are present, not restructuring the
 *  DOM. Recurses into a matched folder's children directly below it. */
export function ArchiveTree({ nodes, depth = 0, isExpanded, onToggle }: Props) {
  return (
    <>
      {nodes.map((node) => (
        <ArchiveTreeRow key={node.path} node={node} depth={depth} isExpanded={isExpanded} onToggle={onToggle} />
      ))}
    </>
  );
}

function ArchiveTreeRow({
  node,
  depth,
  isExpanded,
  onToggle,
}: {
  node: TreeNode;
  depth: number;
  isExpanded: (path: string) => boolean;
  onToggle: (path: string) => void;
}) {
  const expanded = node.isDir && isExpanded(node.path);

  return (
    <>
      <div
        className={`archive-row ${node.isDir ? "archive-row-dir" : ""}`}
        style={{ paddingLeft: `${depth * 1.1 + 0.5}rem` }}
        onClick={node.isDir ? () => onToggle(node.path) : undefined}
        role={node.isDir ? "button" : undefined}
        tabIndex={node.isDir ? 0 : undefined}
        onKeyDown={
          node.isDir
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onToggle(node.path);
                }
              }
            : undefined
        }
      >
        {node.isDir ? (
          <span className={`archive-chevron ${expanded ? "expanded" : ""}`} aria-hidden="true">
            ▸
          </span>
        ) : (
          <span className="archive-chevron-spacer" aria-hidden="true" />
        )}
        {node.isDir ? (
          <img
            className="file-icon"
            src={expanded ? folderOpenIcon : folderIcon}
            width={16}
            height={16}
            alt=""
            draggable={false}
          />
        ) : (
          <FileIcon name={node.name} size={16} />
        )}
        <span className="archive-name" data-tip={node.name}>
          {node.name}
        </span>
        {node.encrypted && (
          <span className="archive-lock" data-tip="Encrypted" aria-hidden="true">
            🔒
          </span>
        )}
        <span className="archive-size tabular">{formatBytes(node.size)}</span>
        <span className="archive-modified tabular">{node.modified ?? ""}</span>
      </div>
      {node.isDir && expanded && (
        <ArchiveTree nodes={node.children} depth={depth + 1} isExpanded={isExpanded} onToggle={onToggle} />
      )}
    </>
  );
}

export default ArchiveTree;
