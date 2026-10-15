use chrono::{Local, NaiveDate};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize)]
pub struct BackupStats {
    pub total_bytes: u64,
    pub total_files: usize,
    pub date_dirs: usize,
}

#[derive(Debug, Clone)]
pub struct GcOptions {
    pub dry_run: bool,
    pub days: Option<u32>,
    pub force: bool,
    pub max_mb: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GcResult {
    pub command: String,
    pub dry_run: bool,
    pub before_bytes: u64,
    pub after_bytes: u64,
    pub freed_bytes: u64,
    pub deleted_files: usize,
    pub deleted_dirs: usize,
    pub remaining_files: usize,
    pub retained_days: u32,
    /// Operation diffs older than the retention window that were (or would be) removed.
    pub diff_files_removed: usize,
    /// Verification logs older than the retention window that were (or would be) removed.
    pub verify_logs_removed: usize,
    /// Bytes freed by diff and verification-log pruning, in addition to `freed_bytes`.
    pub aux_freed_bytes: u64,
}

/// Remove files named `<prefix>YYYYMMDD_...` whose date is older than the retention window.
/// Files that do not follow the naming scheme are never touched.
fn prune_dated_files(
    dir: &Path,
    prefix: &str,
    retention_days: u32,
    today: NaiveDate,
    dry_run: bool,
) -> (usize, u64) {
    let Ok(entries) = fs::read_dir(dir) else {
        return (0, 0);
    };
    let mut removed = 0usize;
    let mut bytes = 0u64;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let Some(date_text) = name.strip_prefix(prefix).and_then(|rest| rest.get(..8)) else {
            continue;
        };
        let Ok(date) = NaiveDate::parse_from_str(date_text, "%Y%m%d") else {
            continue;
        };
        if (today - date).num_days() <= retention_days as i64 {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if !metadata.is_file() {
            continue;
        }
        if dry_run || fs::remove_file(entry.path()).is_ok() {
            removed += 1;
            bytes += metadata.len();
        }
    }
    (removed, bytes)
}

/// Enforce retention on backups, operation diffs, and verification logs.
pub fn run_gc(project_root: &Path, options: &GcOptions) -> anyhow::Result<GcResult> {
    let mut result = run_backup_gc(project_root, options)?;
    let config = crate::config::load_config(project_root).unwrap_or_default();
    let retention_days = if options.force {
        0
    } else {
        options.days.unwrap_or(config.backup.retention_days)
    };
    let today = Local::now().date_naive();
    let mtui_dir = crate::config::config_dir(project_root);
    let (diffs, diff_bytes) = prune_dated_files(
        &mtui_dir.join("diffs"),
        "op_",
        retention_days,
        today,
        options.dry_run,
    );
    let (logs, log_bytes) = prune_dated_files(
        &mtui_dir.join("verify"),
        "verify_",
        retention_days,
        today,
        options.dry_run,
    );
    result.diff_files_removed = diffs;
    result.verify_logs_removed = logs;
    result.aux_freed_bytes = diff_bytes + log_bytes;
    Ok(result)
}

/// Run retention at most once a day when `backup.auto_gc_on_run` is enabled, so MTUI state
/// cannot grow without bound. Failures are ignored: housekeeping must never break a command.
pub fn auto_gc_if_due(project_root: &Path, config: &crate::config::MtuiConfig) {
    if !config.backup.enabled || !config.backup.auto_gc_on_run {
        return;
    }
    let marker = crate::config::config_dir(project_root).join("last-gc");
    let due = fs::metadata(&marker)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|modified| modified.elapsed().ok())
        .is_none_or(|age| age > std::time::Duration::from_secs(24 * 60 * 60));
    if !due {
        return;
    }
    // Touch first so concurrent invocations do not all start a collection. The marker gets new content each time:
    // rewriting an empty file with empty bytes does not move its modification time on every file system, which made
    // the marker look a day old forever and ran the collection on every single command.
    if fs::write(&marker, chrono::Utc::now().to_rfc3339()).is_err() {
        return;
    }
    let _ = run_gc(
        project_root,
        &GcOptions {
            dry_run: false,
            days: None,
            force: false,
            max_mb: None,
        },
    );
}

pub fn calculate_backup_stats(backup_dir: &Path) -> BackupStats {
    if !backup_dir.exists() {
        return BackupStats {
            total_bytes: 0,
            total_files: 0,
            date_dirs: 0,
        };
    }

    let mut total_bytes = 0u64;
    let mut total_files = 0usize;
    let mut date_dirs = 0usize;

    if let Ok(entries) = fs::read_dir(backup_dir) {
        for entry in entries.flatten() {
            if entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
                date_dirs += 1;
            }
        }
    }

    for entry in WalkDir::new(backup_dir).into_iter().flatten() {
        if entry.file_type().is_file() {
            total_files += 1;
            total_bytes += entry.metadata().map(|m| m.len()).unwrap_or(0);
        }
    }

    BackupStats {
        total_bytes,
        total_files,
        date_dirs,
    }
}

fn run_backup_gc(project_root: &Path, options: &GcOptions) -> anyhow::Result<GcResult> {
    let backup_dir = crate::backup::backup_dir(project_root);
    let stats_before = calculate_backup_stats(&backup_dir);

    if !backup_dir.exists() {
        return Ok(GcResult {
            command: "gc".to_string(),
            dry_run: options.dry_run,
            before_bytes: 0,
            after_bytes: 0,
            freed_bytes: 0,
            deleted_files: 0,
            deleted_dirs: 0,
            remaining_files: 0,
            retained_days: options.days.unwrap_or(7),
            diff_files_removed: 0,
            verify_logs_removed: 0,
            aux_freed_bytes: 0,
        });
    }

    let config = crate::config::load_config(project_root).unwrap_or_default();
    let retention_days = options.days.unwrap_or(config.backup.retention_days);
    let max_bytes = options
        .max_mb
        .unwrap_or(config.backup.max_storage_mb)
        * 1024
        * 1024;

    let today = Local::now().date_naive();

    // Collect all date directories: (date_str, parsed_date, path, dir_size, file_count)
    let mut date_entries = Vec::new();
    if let Ok(entries) = fs::read_dir(&backup_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
            let parsed_date = NaiveDate::parse_from_str(&name, "%Y-%m-%d").ok();

            let mut dir_size = 0u64;
            let mut file_count = 0usize;
            for file_entry in WalkDir::new(&path).into_iter().flatten() {
                if file_entry.file_type().is_file() {
                    file_count += 1;
                    dir_size += file_entry.metadata().map(|m| m.len()).unwrap_or(0);
                }
            }

            date_entries.push((name, parsed_date, path, dir_size, file_count));
        }
    }

    // Sort by date ascending (oldest first). If date unparseable, place at start for eviction.
    date_entries.sort_by(|a, b| match (a.1, b.1) {
        (Some(da), Some(db)) => da.cmp(&db),
        (None, Some(_)) => std::cmp::Ordering::Less,
        (Some(_), None) => std::cmp::Ordering::Greater,
        (None, None) => a.0.cmp(&b.0),
    });

    let mut dirs_to_delete: Vec<PathBuf> = Vec::new();
    let mut freed_bytes = 0u64;
    let mut deleted_files = 0usize;
    let mut remaining_bytes = stats_before.total_bytes;

    for (_name, parsed_date, path, size, file_count) in &date_entries {
        let should_delete = if options.force {
            true
        } else if let Some(d) = parsed_date {
            let age_days = (today - *d).num_days();
            if age_days > retention_days as i64 {
                true
            } else {
                remaining_bytes > max_bytes
            }
        } else {
            // Non-date directory under backups, purge if over quota or forced
            remaining_bytes > max_bytes
        };

        if should_delete {
            dirs_to_delete.push(path.clone());
            freed_bytes += size;
            deleted_files += file_count;
            remaining_bytes = remaining_bytes.saturating_sub(*size);
        }
    }

    let deleted_dirs_count = dirs_to_delete.len();

    if !options.dry_run {
        for dir in &dirs_to_delete {
            let _ = fs::remove_dir_all(dir);
        }
    }

    let after_bytes = if options.dry_run {
        stats_before.total_bytes.saturating_sub(freed_bytes)
    } else {
        calculate_backup_stats(&backup_dir).total_bytes
    };

    let remaining_files = stats_before.total_files.saturating_sub(deleted_files);

    Ok(GcResult {
        command: "gc".to_string(),
        dry_run: options.dry_run,
        before_bytes: stats_before.total_bytes,
        after_bytes,
        freed_bytes,
        deleted_files,
        deleted_dirs: deleted_dirs_count,
        remaining_files,
        retained_days: retention_days,
        diff_files_removed: 0,
        verify_logs_removed: 0,
        aux_freed_bytes: 0,
    })
}
