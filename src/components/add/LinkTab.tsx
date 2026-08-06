import type { AddFormState } from "../../hooks/useAddForm";

export function LinkTab({
  active,
  state,
  patch,
  act,
  runProbe,
  showCheckSizeButton,
  size,
}: {
  active: boolean;
  state: Pick<AddFormState, "url" | "pendingInsecure" | "filenameEnabled" | "filenameText" | "probedFilename">;
  patch: (p: Partial<AddFormState>) => void;
  act: (later: boolean) => void;
  runProbe: (allowInsecure: boolean) => void;
  showCheckSizeButton: boolean;
  size: string | null;
}) {
  return (
    <div className={`tab-panel ${active ? "" : "tab-hidden"}`}>
      <label className="dlg-label" htmlFor="dlg-url">
        Download link
      </label>
      <input
        id="dlg-url"
        autoFocus
        value={state.url}
        onChange={(e) => patch({ url: e.currentTarget.value })}
        onKeyDown={(e) => {
          if (e.key === "Enter" && state.url.trim() && !state.pendingInsecure) act(false);
        }}
        placeholder="https://example.com/file.zip"
        spellCheck={false}
      />

      <div className="check-row">
        <input
          type="checkbox"
          id="fn-enable"
          checked={state.filenameEnabled}
          onChange={(e) => patch({ filenameEnabled: e.currentTarget.checked })}
        />
        <label htmlFor="fn-enable">Change file name:</label>
        <input
          id="fn-text"
          disabled={!state.filenameEnabled}
          value={state.filenameText}
          onChange={(e) => patch({ filenameText: e.currentTarget.value })}
          spellCheck={false}
          placeholder={state.probedFilename || "filename"}
        />
      </div>

      <div className="link-foot">
        {showCheckSizeButton && (
          <button type="button" className="link-btn" onClick={() => runProbe(true)}>
            Check size
          </button>
        )}
        {size && <span className="size-readout">{size}</span>}
      </div>
    </div>
  );
}

export default LinkTab;
