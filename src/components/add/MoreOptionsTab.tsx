import type { AddFormState } from "../../hooks/useAddForm";
import { CATEGORY_LABEL, type FileCategory } from "../../categories";

export function MoreOptionsTab({
  active,
  state,
  patch,
  currentCategory,
  savePathPlaceholder,
  onBrowseSavePath,
}: {
  active: boolean;
  state: Pick<AddFormState, "savePath" | "rememberPath" | "connections" | "perLimitMbps" | "checksumText">;
  patch: (p: Partial<AddFormState>) => void;
  currentCategory: FileCategory;
  savePathPlaceholder: string;
  onBrowseSavePath: () => void;
}) {
  return (
    <div className={`tab-panel ${active ? "" : "tab-hidden"}`}>
      <div className="field-row path-row">
        <label htmlFor="savepath">Save path</label>
        <input
          id="savepath"
          value={state.savePath}
          onChange={(e) => patch({ savePath: e.currentTarget.value })}
          spellCheck={false}
          placeholder={savePathPlaceholder}
        />
        <button type="button" onClick={onBrowseSavePath}>
          Browse…
        </button>
      </div>
      <div className="check-row">
        <input
          type="checkbox"
          id="remember-path"
          checked={state.rememberPath}
          disabled={!state.savePath.trim()}
          onChange={(e) => patch({ rememberPath: e.currentTarget.checked })}
        />
        <label htmlFor="remember-path">
          Remember this path for {CATEGORY_LABEL[currentCategory]}
        </label>
      </div>
      <div className="field-row">
        <label htmlFor="conn">Connections</label>
        <select
          id="conn"
          className="conn-select"
          value={state.connections}
          onChange={(e) => patch({ connections: Number(e.currentTarget.value) })}
        >
          {[1, 2, 4, 8, 16].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <label htmlFor="plim">Speed cap</label>
        <input
          id="plim"
          type="number"
          min={0}
          step={0.5}
          value={state.perLimitMbps}
          onChange={(e) => patch({ perLimitMbps: Math.max(0, Number(e.currentTarget.value) || 0) })}
        />
        <span className="field-unit">MB/s · 0 = off</span>
      </div>
      <div className="field-row">
        <label htmlFor="sum">Checksum</label>
        <input
          id="sum"
          className="checksum-input"
          value={state.checksumText}
          onChange={(e) => patch({ checksumText: e.currentTarget.value })}
          spellCheck={false}
          placeholder="optional — MD5 / SHA-1 / SHA-256 / SHA-512"
        />
      </div>
    </div>
  );
}

export default MoreOptionsTab;
