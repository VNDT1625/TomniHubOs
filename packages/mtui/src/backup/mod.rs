pub mod gc;

use anyhow::Context;
use chrono::Local;
use std::path::{Path, PathBuf};

pub const DELTA_PATCH_HEADER: &str = "# MTUI DELTA REVERSE PATCH v1\n";

pub fn backup_dir(project_root: &Path) -> PathBuf {
    crate::config::config_dir(project_root).join("backups")
}

pub fn generate_backup_path(project_root: &Path, operation_id: &str, file_path: &Path) -> PathBuf {
    let date = Local::now().format("%Y-%m-%d").to_string();
    backup_dir(project_root)
        .join(&date)
        .join(operation_id)
        .join(
            file_path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string(),
        )
}

pub fn create_backup(
    project_root: &Path,
    operation_id: &str,
    file_path: &Path,
    content: &[u8],
) -> anyhow::Result<PathBuf> {
    create_backup_with_after(project_root, operation_id, file_path, content, None)
}

pub fn create_backup_with_after(
    project_root: &Path,
    operation_id: &str,
    file_path: &Path,
    before_content: &[u8],
    after_content: Option<&[u8]>,
) -> anyhow::Result<PathBuf> {
    let config = crate::config::load_config(project_root).unwrap_or_default();
    let backup_path = generate_backup_path(project_root, operation_id, file_path);
    if let Some(parent) = backup_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    if config.backup.enabled && config.backup.storage_mode == "delta" {
        if let Some(after) = after_content {
            if let (Ok(before_str), Ok(after_str)) = (
                std::str::from_utf8(before_content),
                std::str::from_utf8(after),
            ) {
                let diff = similar::TextDiff::from_lines(after_str, before_str);
                let unified = diff.unified_diff().to_string();
                if !unified.is_empty() && unified.len() < before_content.len() {
                    let patch_content = format!("{}{}", DELTA_PATCH_HEADER, unified);
                    std::fs::write(&backup_path, patch_content.as_bytes()).with_context(|| {
                        format!("Failed to create delta backup: {}", backup_path.display())
                    })?;
                    return Ok(backup_path);
                }
            }
        }
    }

    std::fs::write(&backup_path, before_content)
        .with_context(|| format!("Failed to create backup: {}", backup_path.display()))?;
    Ok(backup_path)
}

#[allow(dead_code)]
pub fn load_backup(backup_path: &Path) -> anyhow::Result<Vec<u8>> {
    std::fs::read(backup_path)
        .with_context(|| format!("Failed to read backup: {}", backup_path.display()))
}

pub fn restore_backup(backup_path: &Path, current_content: &[u8]) -> anyhow::Result<Vec<u8>> {
    let backup_bytes = std::fs::read(backup_path)
        .with_context(|| format!("Failed to read backup: {}", backup_path.display()))?;

    if backup_bytes.starts_with(DELTA_PATCH_HEADER.as_bytes()) {
        let patch_text = std::str::from_utf8(&backup_bytes[DELTA_PATCH_HEADER.len()..])
            .context("Invalid UTF-8 in delta patch backup")?;
        let current_text = std::str::from_utf8(current_content)
            .context("Current file is not valid UTF-8 for delta patch application")?;

        let restored_text = apply_unified_patch(current_text, patch_text)
            .context("Failed to apply reverse delta patch")?;
        Ok(restored_text.into_bytes())
    } else {
        Ok(backup_bytes)
    }
}

pub fn apply_unified_patch(original: &str, patch: &str) -> anyhow::Result<String> {
    let orig_lines: Vec<&str> = original.lines().collect();
    let mut result_lines: Vec<String> = Vec::new();
    let mut orig_idx = 0;

    for line in patch.lines() {
        if line.starts_with("---") || line.starts_with("+++") {
            continue;
        }
        if line.starts_with("@@") {
            if let Some(hunk_info) = line.split("@@").nth(1) {
                let parts: Vec<&str> = hunk_info.trim().split_whitespace().collect();
                if let Some(old_part) = parts.first() {
                    let old_part = old_part.trim_start_matches('-');
                    let start: usize = old_part.split(',').next().unwrap_or("1").parse().unwrap_or(1);
                    let target_idx = start.saturating_sub(1);
                    while orig_idx < target_idx && orig_idx < orig_lines.len() {
                        result_lines.push(orig_lines[orig_idx].to_string());
                        orig_idx += 1;
                    }
                }
            }
            continue;
        }

        if let Some(rest) = line.strip_prefix(' ') {
            if orig_idx < orig_lines.len() {
                result_lines.push(orig_lines[orig_idx].to_string());
                orig_idx += 1;
            } else {
                result_lines.push(rest.to_string());
            }
        } else if line.starts_with('-') {
            if orig_idx < orig_lines.len() {
                orig_idx += 1;
            }
        } else if let Some(rest) = line.strip_prefix('+') {
            result_lines.push(rest.to_string());
        }
    }

    while orig_idx < orig_lines.len() {
        result_lines.push(orig_lines[orig_idx].to_string());
        orig_idx += 1;
    }

    let mut res = result_lines.join("\n");
    if original.ends_with('\n') && !res.ends_with('\n') {
        res.push('\n');
    }
    Ok(res)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_apply_unified_patch_roundtrip() {
        let before = "line 1\nline 2 original\nline 3\nline 4\n";
        let after = "line 1\nline 2 modified\nline 3\nline 4 modified\n";

        let diff = similar::TextDiff::from_lines(after, before);
        let patch = diff.unified_diff().to_string();

        let restored = apply_unified_patch(after, &patch).expect("apply patch");
        assert_eq!(restored, before);
    }
}
