// ---------------------------------------------------------------------------
// Per-day download statistics (stats.json) for the dashboard. Recording is
// frontend-side (see src/hooks/useStats.ts) — this module only loads, sanitizes
// and saves the aggregate, following the config/history.rs pattern.
// ---------------------------------------------------------------------------

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use super::{config_dir, write_json_atomic};

const STATS_VERSION: u32 = 1;
/// ~10 years of days; the file stays tiny but can't grow forever.
const MAX_DAYS: usize = 3660;

#[derive(Serialize, Deserialize, specta::Type, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DayRecord {
    /// Local calendar day, "YYYY-MM-DD" (computed by the frontend).
    pub day: String,
    #[specta(type = specta_typescript::Number)]
    pub bytes: u64,
    #[specta(type = specta_typescript::Number)]
    pub active_ms: u64,
    pub completed: u32,
    /// Rows that ended in "error" this day (see `src/stats.ts`'s `observeDownloads`).
    pub errored: u32,
    /// Rows that ended in "canceled" this day.
    pub canceled: u32,
    #[specta(type = specta_typescript::Number)]
    pub peak_bps: u64,
}

#[derive(Serialize, Deserialize)]
struct StatsFile {
    version: u32,
    days: Vec<serde_json::Value>,
}

#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StatsLoad {
    /// False when there was no usable stats.json — the frontend backfills from
    /// history then.
    existed: bool,
    days: Vec<DayRecord>,
}

fn stats_path() -> Result<PathBuf, String> {
    Ok(config_dir()?.join("stats.json"))
}

/// True when `day` looks like "YYYY-MM-DD" — checked by hand rather than with
/// a regex crate for a format this fixed.
fn is_valid_day(day: &str) -> bool {
    let b = day.as_bytes();
    b.len() == 10
        && b[0..4].iter().all(u8::is_ascii_digit)
        && b[4] == b'-'
        && b[5..7].iter().all(u8::is_ascii_digit)
        && b[7] == b'-'
        && b[8..10].iter().all(u8::is_ascii_digit)
}

/// Drops unparseable-day rows, merges duplicates (sum bytes/active_ms/completed,
/// max peak_bps), sorts ascending by day and keeps only the newest `MAX_DAYS`.
pub(crate) fn sanitize_days(days: Vec<DayRecord>) -> Vec<DayRecord> {
    let mut merged: std::collections::BTreeMap<String, DayRecord> =
        std::collections::BTreeMap::new();

    for d in days.into_iter().filter(|d| is_valid_day(&d.day)) {
        merged
            .entry(d.day.clone())
            .and_modify(|existing| {
                existing.bytes = existing.bytes.saturating_add(d.bytes);
                existing.active_ms = existing.active_ms.saturating_add(d.active_ms);
                existing.completed = existing.completed.saturating_add(d.completed);
                existing.errored = existing.errored.saturating_add(d.errored);
                existing.canceled = existing.canceled.saturating_add(d.canceled);
                existing.peak_bps = existing.peak_bps.max(d.peak_bps);
            })
            .or_insert(d);
    }

    let mut out: Vec<DayRecord> = merged.into_values().collect();
    if out.len() > MAX_DAYS {
        out.drain(0..out.len() - MAX_DAYS);
    }
    out
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn load_stats() -> Result<StatsLoad, String> {
    let path = stats_path()?;
    let Ok(bytes) = tokio::fs::read(&path).await else {
        return Ok(StatsLoad {
            existed: false,
            days: Vec::new(),
        });
    };

    let file = match serde_json::from_slice::<StatsFile>(&bytes) {
        Ok(f) => f,
        Err(e) => {
            eprintln!("stats.json is unreadable ({e}); keeping it as stats.json.bad");
            let mut bad = path.clone().into_os_string();
            bad.push(".bad");
            let _ = tokio::fs::rename(&path, PathBuf::from(bad)).await;
            return Ok(StatsLoad {
                existed: false,
                days: Vec::new(),
            });
        }
    };

    // Per-entry parsing: one malformed row costs one row, not the whole file.
    let days = file
        .days
        .into_iter()
        .filter_map(|v| serde_json::from_value::<DayRecord>(v).ok())
        .collect();

    Ok(StatsLoad {
        existed: true,
        days: sanitize_days(days),
    })
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn save_stats(days: Vec<DayRecord>) -> Result<(), String> {
    let days = sanitize_days(days)
        .into_iter()
        .map(serde_json::to_value)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    write_json_atomic(
        &stats_path()?,
        &StatsFile {
            version: STATS_VERSION,
            days,
        },
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[allow(clippy::too_many_arguments)]
    fn day(
        day: &str,
        bytes: u64,
        active_ms: u64,
        completed: u32,
        errored: u32,
        canceled: u32,
        peak_bps: u64,
    ) -> DayRecord {
        DayRecord {
            day: day.to_string(),
            bytes,
            active_ms,
            completed,
            errored,
            canceled,
            peak_bps,
        }
    }

    #[test]
    fn drops_invalid_day_strings() {
        let days = vec![
            day("2026-9-1", 100, 0, 0, 0, 0, 0),
            day("abcd-ef-gh", 100, 0, 0, 0, 0, 0),
            day("", 100, 0, 0, 0, 0, 0),
            day("2026-09-01", 100, 0, 0, 0, 0, 0),
        ];
        let out = sanitize_days(days);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].day, "2026-09-01");
    }

    #[test]
    fn merges_duplicate_days_summing_and_maxing() {
        let days = vec![
            day("2026-09-01", 100, 1000, 1, 2, 3, 500),
            day("2026-09-01", 50, 500, 2, 1, 4, 900),
        ];
        let out = sanitize_days(days);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].bytes, 150);
        assert_eq!(out[0].active_ms, 1500);
        assert_eq!(out[0].completed, 3);
        assert_eq!(out[0].errored, 3);
        assert_eq!(out[0].canceled, 7);
        assert_eq!(out[0].peak_bps, 900);
    }

    #[test]
    fn output_is_sorted_ascending_by_day() {
        let days = vec![
            day("2026-09-03", 1, 0, 0, 0, 0, 0),
            day("2026-09-01", 1, 0, 0, 0, 0, 0),
            day("2026-09-02", 1, 0, 0, 0, 0, 0),
        ];
        let out = sanitize_days(days);
        assert_eq!(
            out.iter().map(|d| d.day.as_str()).collect::<Vec<_>>(),
            vec!["2026-09-01", "2026-09-02", "2026-09-03"]
        );
    }

    #[test]
    fn truncates_to_max_days_keeping_the_newest() {
        let total = MAX_DAYS + 10;
        let days: Vec<DayRecord> = (0..total)
            .map(|i| day(&format!("{:04}-01-01", 1000 + i), 1, 0, 0, 0, 0, 0))
            .collect();
        let out = sanitize_days(days);
        assert_eq!(out.len(), MAX_DAYS);
        // Newest (highest year) days survive.
        assert_eq!(
            out.last().unwrap().day,
            format!("{:04}-01-01", 1000 + total - 1)
        );
        assert_eq!(
            out.first().unwrap().day,
            format!("{:04}-01-01", 1000 + total - MAX_DAYS)
        );
    }
}
