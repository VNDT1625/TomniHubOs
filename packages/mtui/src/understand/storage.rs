use std::path::{Path, PathBuf};

use crate::workspace_metadata::{canonical_metadata_root, ensure_canonical_workspace_metadata, MigrationStatus};

const UNDERSTAND_DIR: &str = "understand";

fn metadata_root(project_root: &Path) -> PathBuf {
    match ensure_canonical_workspace_metadata(project_root) {
        MigrationStatus::Failed | MigrationStatus::Conflicted => canonical_metadata_root(project_root).join(UNDERSTAND_DIR),
        MigrationStatus::AlreadyCanonical | MigrationStatus::Migrated => {
            canonical_metadata_root(project_root).join(UNDERSTAND_DIR)
        }
    }
}

pub(crate) fn summary_path(project_root: &Path) -> PathBuf {
    metadata_root(project_root).join("summary.json")
}

pub(crate) fn canonical_understand_dir(project_root: &Path) -> PathBuf {
    canonical_metadata_root(project_root).join(UNDERSTAND_DIR)
}

pub(crate) fn canonical_stale_marker_path(project_root: &Path) -> PathBuf {
    canonical_understand_dir(project_root).join("stale.json")
}

pub(crate) fn stale_marker_path(project_root: &Path) -> PathBuf {
    canonical_stale_marker_path(project_root)
}

#[cfg(test)]
mod tests {
    use super::{stale_marker_path, summary_path};

    #[test]
    fn legacy_summary_is_migrated_before_its_canonical_path_is_returned() {
        let root = tempfile::tempdir().expect("tempdir");
        let legacy = root.path().join(".omni/understand");
        std::fs::create_dir_all(&legacy).expect("legacy directory");
        std::fs::write(legacy.join("summary.json"), "{}").expect("summary");

        assert_eq!(summary_path(root.path()), root.path().join(".tomni/understand/summary.json"));
        assert!(root.path().join(".tomni/understand/summary.json").is_file());
        assert!(!root.path().join(".omni").exists());
    }

    #[test]
    fn canonical_path_is_retained_when_a_legacy_summary_conflicts() {
        let root = tempfile::tempdir().expect("tempdir");
        let canonical = root.path().join(".tomni/understand");
        let legacy = root.path().join(".tomny/understand");
        std::fs::create_dir_all(&canonical).expect("canonical directory");
        std::fs::create_dir_all(&legacy).expect("legacy directory");
        std::fs::write(canonical.join("summary.json"), "canonical").expect("canonical summary");
        std::fs::write(legacy.join("summary.json"), "legacy").expect("legacy summary");

        assert_eq!(summary_path(root.path()), canonical.join("summary.json"));
        assert_eq!(stale_marker_path(root.path()), canonical.join("stale.json"));
        assert_eq!(std::fs::read_to_string(canonical.join("summary.json")).expect("canonical"), "canonical");
        assert!(!root.path().join(".tomny").exists());
    }
}
