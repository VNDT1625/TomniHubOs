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

pub fn run_gc(project_root: &Path, options: &GcOptions) -> anyhow::Result<GcResult> {
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
    })
}
