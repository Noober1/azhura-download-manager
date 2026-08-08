/** File-type buckets used for the sidebar filters and the default save
 *  folder. Extension lists MUST stay in sync with Rust's `category_id` /
 *  `category_folder` in `src-tauri/src/lib.rs` — the backend does the same
 *  classification to pick the destination directory for a fresh download. */
export type FileCategory = "video" | "audio" | "program" | "docs" | "archive" | "other";

export const FILE_CATEGORIES: FileCategory[] = [
  "video",
  "audio",
  "program",
  "docs",
  "archive",
  "other",
];

export const CATEGORY_LABEL: Record<FileCategory, string> = {
  video: "Videos",
  audio: "Audios",
  program: "Programs",
  docs: "Documents",
  archive: "Archives",
  other: "Others",
};

/** Folder name under the download base (`<Downloads>/AzhuraDownloadManager/<folder>`). */
export const CATEGORY_FOLDER: Record<FileCategory, string> = {
  video: "Videos",
  audio: "Audios",
  program: "Programs",
  docs: "Documents",
  archive: "Archives",
  other: "Others",
};

const EXT_CATEGORY: Record<string, FileCategory> = {};
function register(category: FileCategory, exts: string[]) {
  for (const ext of exts) EXT_CATEGORY[ext] = category;
}

register("video", ["mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "m4v", "mpg", "mpeg", "ts", "3gp", "m2ts", "ogv"]);
register("audio", ["mp3", "flac", "wav", "aac", "ogg", "m4a", "wma", "opus", "mid", "aiff"]);
register("program", ["exe", "msi", "appx", "msix", "apk", "aab", "jar", "dll", "sys", "deb", "rpm", "dmg", "pkg", "appimage", "bat", "cmd", "sh", "ps1"]);
register("docs", ["pdf", "doc", "docx", "odt", "rtf", "txt", "md", "xls", "xlsx", "ods", "csv", "tsv", "ppt", "pptx", "odp", "epub", "mobi", "azw3", "nfo", "log"]);
register("archive", ["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz", "zst", "cab", "arj", "iso", "img"]);

/** The category for `filename`'s extension, or "other" for anything unmapped
 *  (or with no extension at all). */
export function categoryOf(filename: string): FileCategory {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0) return "other";
  return EXT_CATEGORY[filename.slice(dot + 1).toLowerCase()] ?? "other";
}

/** Same classification, but for a raw URL before a real filename is known —
 *  strips the query/fragment and any trailing slash first. */
export function categoryOfUrl(url: string): FileCategory {
  const clean = url.split(/[?#]/)[0];
  const name = clean.split("/").filter(Boolean).pop() ?? "";
  return categoryOf(name);
}
