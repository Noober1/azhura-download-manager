# Follow-up notes

Things noticed during the refactor that are worth fixing, but are deliberately
**not** touched here because doing so would change behavior — out of scope for
a pure restructuring pass. Each entry says what was found, where, and why it
was left alone.

## Lint / clippy

- **`src/DetailWindow.tsx:71`** — `useEffect` depends on `item?.filename` but
  its body also reads `item` itself (the `if (!item) return;` guard), so
  `react-hooks/exhaustive-deps` (added in Phase 0d) reports a genuine missing
  dependency. Adding the full `item` object to the deps array would make the
  title-setting effect re-run far more often (a new object reference lands on
  every progress patch, not just on a filename change) — a real behavior
  change, so it's left as a live warning rather than "fixed" here.
- **Six pre-existing `eslint-disable-next-line react-hooks/exhaustive-deps`
  comments** (`src/App.tsx:790,952,1163`, `src/AddWindow.tsx:114,161,175`) are
  now reported as "unused eslint-disable directive" — under the plugin
  version wired up in Phase 0d, none of the six effects actually have a
  missing-dependency issue. They were written defensively before this repo
  had any ESLint config to check them against. Left untouched per the plan
  ("leave the six existing disable comments as-is"); `bun run lint` still
  exits 0 since these are warnings, not errors.

## Rust

- **Duplicated `num_pieces` formula.** `plan_pieces_from_meta` (near
  `download_inner`) and the inline `PiecePlan` construction inside
  `list_resumable` both compute
  `((total + piece_size - 1) / piece_size).max(1)`. Both will move into
  `engine/pieces.rs` in Phase 1 without being unified — unifying them is a
  logic-adjacent cleanup, not a pure move.

## Misc

- `README.md` is still the stock `create-tauri-app` template — never updated
  for this project.
