use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

const CANONICAL_ROOT: &str = ".tomni";
const LEGACY_ROOTS: [&str; 2] = [".omni", ".tomny"];
const KNOWN_AREAS: [&str; 7] = [
    "specs",
    "understand",
    "wiki",
    "inspect",
    "quick-test",
    "artifacts",
    "logs",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum MigrationStatus {
    AlreadyCanonical,
    Migrated,
    Conflicted,
    Failed,
}

pub(crate) fn canonical_metadata_root(project_root: &Path) -> PathBuf {
    project_root.join(CANONICAL_ROOT)
}

fn collect_files(root: &Path, directory: &Path, files: &mut Vec<PathBuf>) -> Result<(), String> {
    for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
        if metadata.file_type().is_symlink() {
            return Err(format!("WORKSPACE_METADATA_SYMLINK:{}", path.display()));
        }
        if metadata.is_dir() {
            collect_files(root, &path, files)?;
        } else if metadata.is_file() {
            files.push(
                path.strip_prefix(root)
                    .map_err(|error| error.to_string())?
                    .to_path_buf(),
            );
        } else {
            return Err(format!("WORKSPACE_METADATA_UNSUPPORTED_ENTRY:{}", path.display()));
        }
    }
    Ok(())
}

fn target_relative(root_name: &str, relative: &Path) -> PathBuf {
    let mut components = relative.components();
    let first = components.next().map(|component| component.as_os_str().to_owned());
    match first {
        Some(first) if KNOWN_AREAS.iter().any(|area| first == *area) => relative.to_path_buf(),
        _ => PathBuf::from("legacy-root").join(root_name.trim_start_matches('.')).join(relative),
    }
}

fn copy_verified(source: &Path, target: &Path) -> Result<(), String> {
    let content = fs::read(source).map_err(|error| error.to_string())?;
    let parent = target.parent().ok_or_else(|| "WORKSPACE_METADATA_TARGET_PARENT".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temporary = target.with_extension(format!("tmp-{}", std::process::id()));
    fs::write(&temporary, &content).map_err(|error| error.to_string())?;
    if fs::read(&temporary).map_err(|error| error.to_string())? != content {
        return Err("WORKSPACE_METADATA_STAGE_HASH_MISMATCH".to_string());
    }
    fs::rename(temporary, target).map_err(|error| error.to_string())?;
    if fs::read(target).map_err(|error| error.to_string())? != content {
        return Err("WORKSPACE_METADATA_TARGET_HASH_MISMATCH".to_string());
    }
    Ok(())
}

fn remove_empty_ancestors(stop_at: &Path, from: &Path) {
    let mut current = from.to_path_buf();
    while current != stop_at {
        let empty = fs::read_dir(&current)
            .ok()
            .map(|mut entries| entries.next().is_none())
            .unwrap_or(false);
        if !empty || fs::remove_dir(&current).is_err() {
            return;
        }
        let Some(parent) = current.parent() else {
            return;
        };
        current = parent.to_path_buf();
    }
}

/// Migrates owned workspace metadata. Conflicts retain their legacy source and
/// copy the differing content to `.tomni/migration/conflicts` for recovery.
pub(crate) fn ensure_canonical_workspace_metadata(project_root: &Path) -> MigrationStatus {
    let canonical = canonical_metadata_root(project_root);
    let mut selected = BTreeMap::<PathBuf, Vec<u8>>::new();
    let mut migrated = false;
    let mut conflicted = false;

    for root_name in LEGACY_ROOTS {
        let legacy_root = project_root.join(root_name);
        if !legacy_root.exists() {
            continue;
        }
        let mut files = Vec::new();
        if collect_files(&legacy_root, &legacy_root, &mut files).is_err() {
            return MigrationStatus::Failed;
        }
        files.sort();
        for relative in files {
            let source = legacy_root.join(&relative);
            let target_relative = target_relative(root_name, &relative);
            let target = canonical.join(&target_relative);
            let content = match fs::read(&source) {
                Ok(content) => content,
                Err(_) => return MigrationStatus::Failed,
            };
            if target.exists() {
                match fs::read(&target) {
                    Ok(existing) if existing == content => {
                        if fs::remove_file(&source).is_err() {
                            return MigrationStatus::Failed;
                        }
                        remove_empty_ancestors(&legacy_root, source.parent().unwrap_or(&legacy_root));
                        migrated = true;
                    }
                    Ok(_) | Err(_) => {
                        let conflict = canonical
                            .join("migration/conflicts")
                            .join(root_name.trim_start_matches('.'))
                            .join(&relative);
                        if copy_verified(&source, &conflict).is_err() || fs::remove_file(&source).is_err() {
                            return MigrationStatus::Failed;
                        }
                        remove_empty_ancestors(&legacy_root, source.parent().unwrap_or(&legacy_root));
                        conflicted = true;
                    }
                }
                continue;
            }
            if let Some(existing) = selected.get(&target_relative) {
                if existing == &content {
                    if fs::remove_file(&source).is_err() {
                        return MigrationStatus::Failed;
                    }
                    remove_empty_ancestors(&legacy_root, source.parent().unwrap_or(&legacy_root));
                    migrated = true;
                } else {
                    let conflict = canonical
                        .join("migration/conflicts")
                        .join(root_name.trim_start_matches('.'))
                        .join(&relative);
                    if copy_verified(&source, &conflict).is_err() {
                        return MigrationStatus::Failed;
                    }
                    conflicted = true;
                }
                continue;
            }
            if copy_verified(&source, &target).is_err() || fs::remove_file(&source).is_err() {
                return MigrationStatus::Failed;
            }
            selected.insert(target_relative, content);
            remove_empty_ancestors(&legacy_root, source.parent().unwrap_or(&legacy_root));
            migrated = true;
        }
        remove_empty_ancestors(project_root, &legacy_root);
    }

    if conflicted {
        MigrationStatus::Conflicted
    } else if migrated {
        MigrationStatus::Migrated
    } else {
        MigrationStatus::AlreadyCanonical
    }
}

#[cfg(test)]
mod tests {
    use super::{ensure_canonical_workspace_metadata, MigrationStatus};

    #[test]
    fn migrates_legacy_understand_cache_to_canonical_root() {
        let root = tempfile::tempdir().expect("tempdir");
        let legacy = root.path().join(".omni/understand");
        std::fs::create_dir_all(&legacy).expect("legacy directory");
        std::fs::write(legacy.join("summary.json"), "{\"builtAt\":1}").expect("summary");

        assert_eq!(
            ensure_canonical_workspace_metadata(root.path()),
            MigrationStatus::Migrated
        );
        assert_eq!(
            std::fs::read_to_string(root.path().join(".tomni/understand/summary.json"))
                .expect("canonical summary"),
            "{\"builtAt\":1}"
        );
        assert!(!root.path().join(".omni").exists());
    }

    #[test]
    fn retains_differing_legacy_data_when_canonical_exists() {
        let root = tempfile::tempdir().expect("tempdir");
        let canonical = root.path().join(".tomni/understand");
        let legacy = root.path().join(".tomny/understand");
        std::fs::create_dir_all(&canonical).expect("canonical directory");
        std::fs::create_dir_all(&legacy).expect("legacy directory");
        std::fs::write(canonical.join("summary.json"), "canonical").expect("canonical summary");
        std::fs::write(legacy.join("summary.json"), "legacy").expect("legacy summary");

        assert_eq!(
            ensure_canonical_workspace_metadata(root.path()),
            MigrationStatus::Conflicted
        );
        assert_eq!(std::fs::read_to_string(canonical.join("summary.json")).expect("canonical"), "canonical");
        assert!(!legacy.exists());
        assert_eq!(
            std::fs::read_to_string(root.path().join(".tomni/migration/conflicts/tomny/understand/summary.json"))
                .expect("preserved conflict"),
            "legacy"
        );
    }
}
