import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { commands } from "../../bindings";

async function revealExtension(flavor: "chrome" | "firefox") {
  try {
    const dir = await commands.extensionDir(flavor);
    const sep = dir.includes("\\") ? "\\" : "/";
    await revealItemInDir(`${dir.replace(/[\\/]+$/, "")}${sep}manifest.json`);
    if (flavor === "chrome") {
      // Windows only resolves registered protocols via plain openUrl(); "chrome://"
      // isn't one (only Chrome itself understands it), so it has to be launched
      // directly with the URL as an argument instead. There's no equivalent for
      // Gecko: the browser could be Firefox, Zen, LibreWolf… under any exe name,
      // so that side just gets the address to paste.
      await openUrl("chrome://extensions", "chrome.exe");
    }
  } catch (e) {
    console.error(e);
  }
}

export function ExtensionsDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">Browser extension</div>
        <div className="dialog-body">
          <p className="detail-note">
            Adds “Download with ADM” to your browser’s right-click menu. Pick the build
            that matches your browser — they ship as separate folders.
          </p>

          <div className="ext-row">
            <div>
              <div className="ext-name">Chrome, Edge, Brave, Opera</div>
              <div className="ext-hint">
                Opens <code>chrome://extensions</code> — turn on Developer mode, then
                “Load unpacked” and pick the revealed folder.
              </div>
            </div>
            <button className="primary-btn" onClick={() => revealExtension("chrome")}>
              Install
            </button>
          </div>

          <div className="ext-row">
            <div>
              <div className="ext-name">Firefox, Zen, LibreWolf</div>
              <div className="ext-hint">
                Open <code>about:debugging#/runtime/this-firefox</code> → “Load Temporary
                Add-on” → pick <code>manifest.json</code> in the revealed folder. See the
                folder’s README to make it permanent.
              </div>
            </div>
            <div className="ext-actions">
              <button className="primary-btn" onClick={() => revealExtension("firefox")}>
                Install
              </button>
              <button
                className="link-btn"
                onClick={() => writeText("about:debugging#/runtime/this-firefox")}
              >
                Copy address
              </button>
            </div>
          </div>
        </div>
        <div className="dialog-actions">
          <button className="primary-btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export default ExtensionsDialog;
