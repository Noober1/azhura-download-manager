// Extensions can't load files from outside their own root, so
// extension-shared/common.js has to be physically copied into extension/ and
// extension-firefox/. This script does that copy; src/extensionSync.test.ts
// fails the build if a copy has drifted from the source.
import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = path.join(root, "extension-shared", "common.js");
const targets = [
  path.join(root, "extension", "common.js"),
  path.join(root, "extension-firefox", "common.js"),
];

for (const target of targets) {
  copyFileSync(source, target);
  console.log(`synced ${path.relative(root, source)} -> ${path.relative(root, target)}`);
}
