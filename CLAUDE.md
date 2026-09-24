# Azhura Download Manager

## Changelog (mandatory)

Every user-facing change (feature, behavior change, visible fix) adds a bullet to the top
`## [X.Y.Z] - Unreleased` entry of `CHANGELOG.md` **in the same change**, under `### Added`,
`### Changed` or `### Fixed`. Write plain user language, not commit-speak; skip internal refactors and
tests. If the top entry is already dated (released), start a new `## [next] - Unreleased` entry above it.

Only `code` and **bold** render inline in the What's New window — no links, nesting or other Markdown.

## Releasing

Before tagging `vX.Y.Z`: replace `Unreleased` with the date (`YYYY-MM-DD`) and bump the version in
`package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`. The release workflow refuses a
missing or undated entry (`scripts/release-notes.ts`), and `src/changelog.test.ts` refuses a package
version with no entry.

## Bindings

After changing Tauri commands/types, regenerate `src/bindings.ts` with
`cd src-tauri && cargo run --bin export_bindings` (not a `#[test]` — that crashes on some machines).
