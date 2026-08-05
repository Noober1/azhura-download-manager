import type { AddFormState } from "../../hooks/useAddForm";

export function AdvancedTab({
  active,
  state,
  patch,
}: {
  active: boolean;
  state: Pick<AddFormState, "userAgent" | "referer" | "cookieText" | "headersText">;
  patch: (p: Partial<AddFormState>) => void;
}) {
  return (
    <div className={`tab-panel ${active ? "" : "tab-hidden"}`}>
      <div className="field-row">
        <label htmlFor="ua">User Agent</label>
        <input
          id="ua"
          value={state.userAgent}
          onChange={(e) => patch({ userAgent: e.currentTarget.value })}
          spellCheck={false}
          placeholder="optional"
        />
      </div>
      <div className="field-row">
        <label htmlFor="referer">Referer</label>
        <input
          id="referer"
          value={state.referer}
          onChange={(e) => patch({ referer: e.currentTarget.value })}
          spellCheck={false}
          placeholder="optional"
        />
      </div>
      <div className="field-row">
        <label htmlFor="cookie">Cookies</label>
        <input
          id="cookie"
          value={state.cookieText}
          onChange={(e) => patch({ cookieText: e.currentTarget.value })}
          spellCheck={false}
          placeholder="key=value; key2=value2"
        />
      </div>
      <div className="field-row field-headers">
        <label htmlFor="hdr">Headers</label>
        <textarea
          id="hdr"
          value={state.headersText}
          onChange={(e) => patch({ headersText: e.currentTarget.value })}
          spellCheck={false}
          rows={3}
          placeholder={"X-Custom-Header: value"}
        />
      </div>
    </div>
  );
}

export default AdvancedTab;
