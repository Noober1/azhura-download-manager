//! `cargo run --bin export_bindings` regenerates `../src/bindings.ts` without
//! launching the app. A normal debug run of the app does this too (see
//! `run()` in `lib.rs`), but that needs a full window; this is the CLI-only
//! path, used when a command/type changes and there's no window to launch.
fn main() {
    azhura_download_manager_lib::export_bindings();
}
