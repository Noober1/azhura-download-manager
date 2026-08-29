import type { ArchiveEntry } from "./bindings";

/** One row in the collapsible folder tree the Archive Preview window
 *  renders. Synthesized from the flat `ArchiveEntry` list `inspect_archive`
 *  returns — archive formats (ZIP especially) often omit an explicit record
 *  for an intermediate folder that a deeper file's path implies, so this is
 *  built from path segments rather than assuming one entry per folder. */
export type TreeNode = {
  name: string;
  /** Full path from the archive root, `/`-separated. */
  path: string;
  isDir: boolean;
  /** A file's own size; a folder's is the sum of everything under it. */
  size: number;
  modified: string | null;
  encrypted: boolean;
  children: TreeNode[];
};

type MutableNode = TreeNode & { childMap: Map<string, MutableNode> };

function newNode(name: string, path: string, isDir: boolean): MutableNode {
  return { name, path, isDir, size: 0, modified: null, encrypted: false, children: [], childMap: new Map() };
}

function getOrCreateDir(map: Map<string, MutableNode>, name: string, path: string): MutableNode {
  let node = map.get(name);
  if (!node) {
    node = newNode(name, path, true);
    map.set(name, node);
  }
  return node;
}

/** Post-order: finalize every child first (so a folder's own aggregated
 *  size already accounts for its subfolders), then sum this level, then
 *  sort folders-first / case-insensitive-by-name, matching how Explorer
 *  and IDM's own archive viewer order a folder listing. */
function finalize(map: Map<string, MutableNode>): TreeNode[] {
  const nodes = Array.from(map.values());
  for (const node of nodes) {
    node.children = finalize(node.childMap);
    if (node.isDir) {
      node.size = node.children.reduce((sum, child) => sum + child.size, 0);
    }
  }
  nodes.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  return nodes;
}

/** Builds the folder tree `ArchiveTree.tsx` renders from `inspect_archive`'s
 *  flat entry list. A file entry implicitly creates every intermediate
 *  folder its path passes through, whether or not the archive itself
 *  recorded a folder entry for it. */
export function buildArchiveTree(entries: ArchiveEntry[]): TreeNode[] {
  const rootMap = new Map<string, MutableNode>();

  for (const entry of entries) {
    const segments = entry.path.split("/").filter(Boolean);
    if (segments.length === 0) continue;

    let currentMap = rootMap;
    let currentPath = "";
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const isLast = i === segments.length - 1;
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;

      if (!isLast) {
        const dir = getOrCreateDir(currentMap, segment, currentPath);
        currentMap = dir.childMap;
        continue;
      }

      if (entry.isDir) {
        const dir = getOrCreateDir(currentMap, segment, currentPath);
        dir.modified = entry.modified;
        dir.encrypted = dir.encrypted || entry.encrypted;
      } else {
        const file = currentMap.get(segment) ?? newNode(segment, currentPath, false);
        file.size = entry.size;
        file.modified = entry.modified;
        file.encrypted = entry.encrypted;
        currentMap.set(segment, file);
      }
    }
  }

  return finalize(rootMap);
}

/** Keeps a branch if its own name matches `query`, or if any descendant
 *  does — a matched folder keeps its full (unfiltered) subtree, since
 *  matching the folder itself is a stronger signal than which of its
 *  contents happen to also match. */
export function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return nodes;

  function walk(list: TreeNode[]): TreeNode[] {
    const out: TreeNode[] = [];
    for (const node of list) {
      const selfMatch = node.name.toLowerCase().includes(q);
      if (selfMatch) {
        out.push(node);
        continue;
      }
      if (!node.isDir) continue;
      const filteredChildren = walk(node.children);
      if (filteredChildren.length > 0) out.push({ ...node, children: filteredChildren });
    }
    return out;
  }

  return walk(nodes);
}
