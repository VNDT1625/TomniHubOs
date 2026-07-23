#[test]
fn doctor_reports_the_canonical_understand_generation() {
    let repo = tempfile::tempdir().unwrap();
    let canonical = repo.path().join(".tomni/understand");
    let legacy = repo.path().join(".aionui/understand");
    std::fs::create_dir_all(&canonical).unwrap();
    std::fs::create_dir_all(&legacy).unwrap();
    std::fs::write(canonical.join("summary.json"), "{}").unwrap();
    std::fs::write(canonical.join("stale.json"), "{}").unwrap();
    std::fs::write(legacy.join("summary.json"), "{}").unwrap();

    let result = mtui::doctor::run(repo.path());

    assert!(result.understand_cache.exists);
    assert_eq!(
        std::path::PathBuf::from(result.understand_cache.path),
        canonical.join("summary.json")
    );
    assert!(result.understand_cache.stale_marker);
    assert_eq!(
        std::path::PathBuf::from(result.understand_cache.stale_marker_path),
        canonical.join("stale.json")
    );
}

#[test]
fn doctor_keeps_legacy_understand_as_a_read_fallback() {
    let repo = tempfile::tempdir().unwrap();
    let legacy = repo.path().join(".aionui/understand");
    std::fs::create_dir_all(&legacy).unwrap();
    std::fs::write(legacy.join("summary.json"), "{}").unwrap();

    let result = mtui::doctor::run(repo.path());

    assert!(result.understand_cache.exists);
    assert_eq!(
        std::path::PathBuf::from(result.understand_cache.path),
        legacy.join("summary.json")
    );
}
