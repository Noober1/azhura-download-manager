/* File-type icons for the download table, drawn from the Material Icon Theme
   (MIT, github.com/material-extensions/vscode-material-icon-theme) — the same
   art VS Code's file explorer uses.

   Imported with `?url`: each icon is a few hundred bytes, so Vite inlines it
   as a data URI rather than emitting a file, which keeps the app free of
   network/disk lookups at render time and avoids dangerouslySetInnerHTML.
   The SVGs carry fixed multicolor fills that are designed to read against
   both a light and a dark editor background, so they need no theming. */

import archive from "material-icon-theme/icons/zip.svg?url";
import video from "material-icon-theme/icons/video.svg?url";
import audio from "material-icon-theme/icons/audio.svg?url";
import image from "material-icon-theme/icons/image.svg?url";
import pdf from "material-icon-theme/icons/pdf.svg?url";
import word from "material-icon-theme/icons/word.svg?url";
import document from "material-icon-theme/icons/document.svg?url";
import log from "material-icon-theme/icons/log.svg?url";
import markdown from "material-icon-theme/icons/markdown.svg?url";
import table from "material-icon-theme/icons/table.svg?url";
import powerpoint from "material-icon-theme/icons/powerpoint.svg?url";
import exe from "material-icon-theme/icons/exe.svg?url";
import dll from "material-icon-theme/icons/dll.svg?url";
import disc from "material-icon-theme/icons/disc.svg?url";
import android from "material-icon-theme/icons/android.svg?url";
import java from "material-icon-theme/icons/java.svg?url";
import font from "material-icon-theme/icons/font.svg?url";
import epub from "material-icon-theme/icons/epub.svg?url";
import subtitles from "material-icon-theme/icons/subtitles.svg?url";
import javascript from "material-icon-theme/icons/javascript.svg?url";
import typescript from "material-icon-theme/icons/typescript.svg?url";
import json from "material-icon-theme/icons/json.svg?url";
import html from "material-icon-theme/icons/html.svg?url";
import css from "material-icon-theme/icons/css.svg?url";
import python from "material-icon-theme/icons/python.svg?url";
import rust from "material-icon-theme/icons/rust.svg?url";
import console from "material-icon-theme/icons/console.svg?url";
import powershell from "material-icon-theme/icons/powershell.svg?url";
import database from "material-icon-theme/icons/database.svg?url";
import key from "material-icon-theme/icons/key.svg?url";
import certificate from "material-icon-theme/icons/certificate.svg?url";
import xml from "material-icon-theme/icons/xml.svg?url";
import yaml from "material-icon-theme/icons/yaml.svg?url";
import model3d from "material-icon-theme/icons/3d.svg?url";
import generic from "material-icon-theme/icons/file.svg?url";

/* Extension → icon, weighted toward what actually gets downloaded rather than
   what gets edited. Notably `.ts` maps to video (an MPEG transport stream
   segment), not TypeScript — the reverse of VS Code's own association, but the
   right call in a download manager. */
const GROUPS: [string, string[]][] = [
  [archive, ["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz", "zst", "cab", "arj"]],
  [video, ["mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "m4v", "mpg", "mpeg", "ts", "3gp"]],
  [audio, ["mp3", "flac", "wav", "aac", "ogg", "m4a", "wma", "opus", "mid"]],
  [image, ["png", "jpg", "jpeg", "gif", "bmp", "webp", "svg", "ico", "tiff", "avif", "heic"]],
  [pdf, ["pdf"]],
  [word, ["doc", "docx", "odt", "rtf"]],
  [document, ["txt", "nfo", "readme"]],
  [log, ["log"]],
  [markdown, ["md"]],
  [table, ["xls", "xlsx", "ods", "csv", "tsv"]],
  [powerpoint, ["ppt", "pptx", "odp"]],
  [exe, ["exe", "msi", "appx"]],
  [dll, ["dll", "sys"]],
  [disc, ["iso", "img", "dmg", "bin", "cue", "nrg", "vhd"]],
  [android, ["apk", "aab"]],
  [java, ["jar"]],
  [font, ["ttf", "otf", "woff", "woff2", "eot"]],
  [epub, ["epub", "mobi", "azw3"]],
  [subtitles, ["srt", "vtt", "ass", "ssa", "sub"]],
  [javascript, ["js", "mjs", "cjs"]],
  [typescript, ["tsx"]],
  [json, ["json"]],
  [html, ["html", "htm"]],
  [css, ["css", "scss"]],
  [python, ["py"]],
  [rust, ["rs"]],
  [console, ["sh", "bash", "bat", "cmd"]],
  [powershell, ["ps1", "psm1"]],
  [database, ["db", "sqlite", "sqlite3", "sql"]],
  [key, ["pem", "key", "ppk"]],
  [certificate, ["crt", "cer", "p12", "pfx"]],
  [xml, ["xml"]],
  [yaml, ["yml", "yaml"]],
  [model3d, ["obj", "fbx", "stl", "blend", "gltf", "glb"]],
];

const EXT_ICON: Record<string, string> = {};
for (const [url, exts] of GROUPS) {
  for (const ext of exts) EXT_ICON[ext] = url;
}

/** The icon for `filename`'s extension, or the generic file icon. A name with
 *  no dot at all (a URL-derived "download") falls through to generic too. */
export function iconFor(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0) return generic;
  return EXT_ICON[filename.slice(dot + 1).toLowerCase()] ?? generic;
}

export function FileIcon({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <img
      className="file-icon"
      src={iconFor(name)}
      width={size}
      height={size}
      alt=""
      draggable={false}
    />
  );
}
