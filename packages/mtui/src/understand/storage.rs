use std::path::{Path, PathBuf};

const CANONICAL_METADATA_DIR: &str = ".tomni";
const MIGRATION_METADATA_DIR: &str = ".omni";
const LEGACY_METADATA_DIR: &str = ".tomny";
const UNDERSTAND_DIR: &str = "understand";

fn metadata_root(project_root: &Path) -> PathBuf {
    for metadata_dir in [
        CANONICAL_METADATA_DIR,
        MIGRATION_METADATA_DIR,
        LEGACY_METADATA_DIR,
    ] {
        let candidate = project_root.join(metadata_dir).join(UNDERSTAND_DIR);
        if candidate.join("summary.json").is_file() {
            return candidate;
        }
    }
    for metadata_dir in [
        CANONICAL_METADATA_DIR,
        MIGRATION_METADATA_DIR,
        LEGACY_METADATA_DIR,
    ] {
        let candidate = project_root.join(metadata_dir).join(UNDERSTAND_DIR);
        if candidate.join("stale.json").is_file() {
            return candidate;
        }
    }

    project_root
        .join(CANONICAL_METADATA_DIR)
        .join(UNDERSTAND_DIR)
}

pub(crate) fn summary_path(project_root: &Path) -> PathBuf {
    metadata_root(project_root).join("summary.json")
}

pub(crate) fn canonical_understand_dir(project_root: &Path) -> PathBuf {
    project_root
        .join(CANONICAL_METADATA_DIR)
        .join(UNDERSTAND_DIR)
}

pub(crate) fn canonical_stale_marker_path(project_root: &Path) -> PathBuf {
    canonical_understand_dir(project_root).join("stale.json")
}

pub(crate) fn stale_marker_path(project_root: &Path) -> PathBuf {
    let canonical_marker = canonical_stale_marker_path(project_root);
    if canonical_marker.is_file() {
        return canonical_marker;
    }
    metadata_root(project_root).join("stale.json")
}

#[cfg(test)]
mod tests {
    use super::{stale_marker_path, summary_path};

    #[test]
    fn canonical_summary_wins_when_both_generations_exist() {
        let root = tempfile::tempdir().expect("tempdir");
        for metadata_dir in [".tomni", ".omni", ".tomny"] {
            let understand = root.path().join(metadata_dir).join("understand");
            std::fs::create_dir_all(&understand).expect("understand directory");
            std::fs::write(understand.join("summary.json"), "{}").expect("summary");
        }

        assert_eq!(
            summary_path(root.path()),
            root.path().join(".tomni/understand/summary.json")
        );
        assert_eq!(
            stale_marker_path(root.path()),
            root.path().join(".tomni/understand/stale.json")
        );
    }

    #[test]
    fn marker_stays_with_the_selected_summary_generation() {
        let root = tempfile::tempdir().expect("tempdir");
        let canonical = root.path().join(".tomni/understand");
        let legacy = root.path().join(".tomny/understand");
        std::fs::create_dir_all(&canonical).expect("canonical directory");
        std::fs::create_dir_all(&legacy).expect("legacy directory");
        std::fs::write(canonical.join("summary.json"), "{}").expect("canonical summary");
        std::fs::write(legacy.join("stale.json"), "{}").expect("old marker");

        assert_eq!(summary_path(root.path()), canonical.join("summary.json"));
        assert_eq!(stale_marker_path(root.path()), canonical.join("stale.json"));
    }

    #[test]
    fn a_new_canonical_marker_invalidates_a_legacy_summary() {
        let root = tempfile::tempdir().expect("tempdir");
        let canonical = root.path().join(".tomni/understand");
        let legacy = root.path().join(".tomny/understand");
        std::fs::create_dir_all(&canonical).expect("canonical directory");
        std::fs::create_dir_all(&legacy).expect("legacy directory");
        std::fs::write(canonical.join("stale.json"), "{}").expect("new marker");
        std::fs::write(legacy.join("summary.json"), "{}").expect("legacy summary");

        assert_eq!(summary_path(root.path()), legacy.join("summary.json"));
        assert_eq!(stale_marker_path(root.path()), canonical.join("stale.json"));
    }

    #[test]
    fn omni_summary_is_read_only_migration_fallback() {
        let root = tempfile::tempdir().expect("tempdir");
        let understand = root.path().join(".omni").join("understand");
        std::fs::create_dir_all(&understand).expect("understand directory");
        std::fs::write(understand.join("summary.json"), "{}").expect("summary");
        std::fs::write(understand.join("stale.json"), "{}").expect("marker");

        assert_eq!(summary_path(root.path()), understand.join("summary.json"));
        assert_eq!(
            stale_marker_path(root.path()),
            understand.join("stale.json")
        );
    }

    #[test]
    fn legacy_summary_remains_a_compatibility_fallback() {
        let root = tempfile::tempdir().expect("tempdir");
        let understand = root.path().join(".tomny").join("understand");
        std::fs::create_dir_all(&understand).expect("understand directory");
        std::fs::write(understand.join("summary.json"), "{}").expect("summary");
        std::fs::write(understand.join("stale.json"), "{}").expect("marker");

        assert_eq!(summary_path(root.path()), understand.join("summary.json"));
        assert_eq!(
            stale_marker_path(root.path()),
            understand.join("stale.json")
        );
    }
}
