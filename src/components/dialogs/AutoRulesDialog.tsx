import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { open } from "@tauri-apps/plugin-dialog";
import { commands } from "../../bindings";
import { CATEGORY_LABEL, FILE_CATEGORIES, type FileCategory } from "../../categories";
import {
  moveRule,
  newRule,
  removeRule,
  targetIncomplete,
  updateRule,
  type AutoRule,
} from "../../autoRules";
import { OVERLAY_FADE, DIALOG_POP } from "../../motion";
import { useDialogA11y } from "../../hooks/useDialogA11y";

const PATTERN_PLACEHOLDER: Record<AutoRule["kind"], string> = {
  wildcard: "*.example.com/*  or  *.iso",
  regex: "\\.iso$",
};

/** Where a rule's download actually lands, for the row label and the "Test a
 *  URL" result — mirrors what `resolve_folder` (auto_rules.rs) computes, just
 *  without resolving the category to a real path (that needs the backend). */
function destinationLabel(rule: AutoRule): string {
  if (rule.target === "folder") {
    return rule.folder.trim() || "(no folder set)";
  }
  const label = CATEGORY_LABEL[rule.category as FileCategory];
  return label ? `${label} folder` : "(unknown category)";
}

export function AutoRulesDialog({
  rules,
  onSave,
  onClose,
}: {
  rules: AutoRule[];
  onSave: (rules: AutoRule[]) => void;
  onClose: () => void;
}) {
  const panelRef = useDialogA11y<HTMLDivElement>(onClose);
  const [draft, setDraft] = useState(rules);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [testUrl, setTestUrl] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);

  // Debounced live validation, one round trip per pause in typing rather than
  // per keystroke — the dialog's own error text has to be exactly what Rust
  // will evaluate at capture time, so it always asks Rust rather than
  // re-implementing the matcher here.
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      void (async () => {
        const next: Record<string, string> = {};
        for (const r of draft) {
          const pattern = r.pattern.trim();
          if (!pattern) continue;
          try {
            await commands.validateAutoRulePattern(r.kind, r.pattern);
          } catch (e) {
            next[r.id] = String(e);
          }
        }
        if (!cancelled) setErrors(next);
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [draft]);

  useEffect(() => {
    const url = testUrl.trim();
    if (!url) {
      setTestResult(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      void (async () => {
        try {
          const idx = await commands.testAutoRules(draft, url);
          if (cancelled) return;
          if (idx === null) {
            setTestResult("No match — the Add window will open.");
          } else {
            setTestResult(`Matches rule ${idx + 1} → saves to ${destinationLabel(draft[idx])}`);
          }
        } catch {
          if (!cancelled) setTestResult(null);
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [draft, testUrl]);

  const canSave = draft.every(
    (r) => !r.enabled || (r.pattern.trim() !== "" && !errors[r.id] && !targetIncomplete(r)),
  );

  function patchRule(id: string, patch: Partial<AutoRule>) {
    setDraft((d) => updateRule(d, id, patch));
  }

  async function browseFolder(id: string, current: string) {
    try {
      const dir = await open({ directory: true, defaultPath: current || undefined });
      if (typeof dir === "string") patchRule(id, { folder: dir });
    } catch {
      /* user canceled or the picker is unavailable */
    }
  }

  function save() {
    if (!canSave) return;
    onSave(draft);
    onClose();
  }

  return (
    <motion.div
      className="overlay"
      onClick={onClose}
      variants={OVERLAY_FADE}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <motion.div
        ref={panelRef}
        className="dialog auto-rules-dialog"
        onClick={(e) => e.stopPropagation()}
        variants={DIALOG_POP}
        initial="initial"
        animate="animate"
        exit="exit"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auto-rules-dialog-title"
        tabIndex={-1}
      >
        <div className="dialog-head" id="auto-rules-dialog-title">
          Auto Rules
        </div>
        <div className="dialog-body">
          <p className="field-unit auto-rules-intro">
            Applies to downloads captured from the browser extension. The first enabled rule that
            matches is used, and the download starts without the Add window.
          </p>

          {draft.length === 0 && (
            <p className="auto-rules-empty">
              No rules yet. Captured downloads always open the Add window.
            </p>
          )}

          <div className="auto-rules-list">
            {draft.map((rule, i) => (
              <div className="auto-rule" key={rule.id}>
                <div className="auto-rule-row">
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    aria-label="Rule enabled"
                    onChange={(e) => patchRule(rule.id, { enabled: e.currentTarget.checked })}
                  />
                  <select
                    className="auto-rule-kind"
                    value={rule.kind}
                    onChange={(e) =>
                      patchRule(rule.id, { kind: e.currentTarget.value as AutoRule["kind"] })
                    }
                  >
                    <option value="wildcard">Wildcard</option>
                    <option value="regex">Regex</option>
                  </select>
                  <input
                    className="auto-rule-pattern"
                    value={rule.pattern}
                    placeholder={PATTERN_PLACEHOLDER[rule.kind]}
                    spellCheck={false}
                    onChange={(e) => patchRule(rule.id, { pattern: e.currentTarget.value })}
                  />
                  <button
                    type="button"
                    disabled={i === 0}
                    aria-label="Move rule up"
                    onClick={() => setDraft((d) => moveRule(d, i, -1))}
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    disabled={i === draft.length - 1}
                    aria-label="Move rule down"
                    onClick={() => setDraft((d) => moveRule(d, i, 1))}
                  >
                    ▼
                  </button>
                  <button
                    type="button"
                    className="danger"
                    aria-label="Remove rule"
                    onClick={() => setDraft((d) => removeRule(d, rule.id))}
                  >
                    ✕
                  </button>
                </div>
                {errors[rule.id] && <div className="auto-rule-error">{errors[rule.id]}</div>}
                <div className="auto-rule-row">
                  <select
                    className="auto-rule-target"
                    value={rule.target === "category" ? `category:${rule.category}` : "folder"}
                    onChange={(e) => {
                      const v = e.currentTarget.value;
                      if (v === "folder") {
                        patchRule(rule.id, { target: "folder" });
                      } else {
                        patchRule(rule.id, {
                          target: "category",
                          category: v.slice("category:".length),
                        });
                      }
                    }}
                  >
                    <option value="folder">Folder…</option>
                    {FILE_CATEGORIES.map((c) => (
                      <option key={c} value={`category:${c}`}>
                        {CATEGORY_LABEL[c]} folder
                      </option>
                    ))}
                  </select>
                  {rule.target === "folder" && (
                    <>
                      <input
                        className="auto-rule-folder"
                        value={rule.folder}
                        placeholder="absolute path"
                        spellCheck={false}
                        onChange={(e) => patchRule(rule.id, { folder: e.currentTarget.value })}
                      />
                      <button type="button" onClick={() => browseFolder(rule.id, rule.folder)}>
                        Browse…
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="field-row">
            <button type="button" onClick={() => setDraft((d) => [...d, newRule()])}>
              Add rule
            </button>
          </div>

          <p className="field-unit">
            Wildcard matches host + path, without <code>https://</code> or <code>?query</code>.{" "}
            <code>*</code> = anything, <code>?</code> = one character. Regex searches the full
            URL, case-insensitive.
          </p>

          <fieldset className="dialog-section">
            <legend className="dialog-section-title">Test a URL</legend>
            <div className="field-row">
              <input
                value={testUrl}
                placeholder="https://example.com/file.iso"
                spellCheck={false}
                onChange={(e) => setTestUrl(e.currentTarget.value)}
              />
            </div>
            {testResult && <p className="field-unit">{testResult}</p>}
          </fieldset>
        </div>
        <div className="dialog-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary-btn" disabled={!canSave} onClick={save}>
            Save
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default AutoRulesDialog;
