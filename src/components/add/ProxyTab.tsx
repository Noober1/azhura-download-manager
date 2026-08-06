import type { AddFormState } from "../../hooks/useAddForm";
import type { ProxyScheme } from "../../types";

export function ProxyTab({
  active,
  state,
  patch,
}: {
  active: boolean;
  state: Pick<
    AddFormState,
    "proxyEnabled" | "proxyScheme" | "proxyHost" | "proxyPort" | "proxyUsername" | "proxyPassword"
  >;
  patch: (p: Partial<AddFormState>) => void;
}) {
  return (
    <div className={`tab-panel ${active ? "" : "tab-hidden"}`}>
      <div className="check-row">
        <input
          type="checkbox"
          id="proxy-enabled"
          checked={state.proxyEnabled}
          onChange={(e) => patch({ proxyEnabled: e.currentTarget.checked })}
        />
        <label htmlFor="proxy-enabled">Use a proxy</label>
      </div>
      <div className="field-row">
        <label htmlFor="proxy-scheme">Type</label>
        <select
          id="proxy-scheme"
          className="conn-select"
          disabled={!state.proxyEnabled}
          value={state.proxyScheme}
          onChange={(e) => patch({ proxyScheme: e.currentTarget.value as ProxyScheme })}
        >
          <option value="http">HTTP</option>
          <option value="https">HTTPS</option>
          <option value="socks5h">SOCKS5</option>
        </select>
        <label htmlFor="proxy-host">Host</label>
        <input
          id="proxy-host"
          className="proxy-field"
          disabled={!state.proxyEnabled}
          value={state.proxyHost}
          onChange={(e) => patch({ proxyHost: e.currentTarget.value })}
          spellCheck={false}
          placeholder="proxy.example.com"
        />
        <label htmlFor="proxy-port">Port</label>
        <input
          id="proxy-port"
          type="number"
          min={0}
          max={65535}
          disabled={!state.proxyEnabled}
          value={state.proxyPort || ""}
          onChange={(e) =>
            patch({ proxyPort: Math.max(0, Math.min(65535, Number(e.currentTarget.value) || 0)) })
          }
        />
      </div>
      <div className="field-row">
        <label htmlFor="proxy-user">Username</label>
        <input
          id="proxy-user"
          className="proxy-field"
          disabled={!state.proxyEnabled}
          value={state.proxyUsername}
          onChange={(e) => patch({ proxyUsername: e.currentTarget.value })}
          spellCheck={false}
          placeholder="optional"
        />
        <label htmlFor="proxy-pass">Password</label>
        <input
          id="proxy-pass"
          className="proxy-field"
          type="password"
          disabled={!state.proxyEnabled}
          value={state.proxyPassword}
          onChange={(e) => patch({ proxyPassword: e.currentTarget.value })}
          placeholder="optional"
        />
      </div>
    </div>
  );
}

export default ProxyTab;
