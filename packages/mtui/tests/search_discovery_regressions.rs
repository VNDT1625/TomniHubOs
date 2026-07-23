use std::path::Path;

fn write_file(path: &Path, content: &str) {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    std::fs::write(path, content).unwrap();
}

#[test]
fn directory_search_honors_nested_gitignore_negation_and_hidden_directories() {
    let repo = tempfile::tempdir().unwrap();
    write_file(&repo.path().join(".gitignore"), ".tmp/\n");
    write_file(&repo.path().join("nested/.gitignore"), "*.log\n!keep.log\n");
    write_file(&repo.path().join("nested/ignored.log"), "needle\n");
    write_file(&repo.path().join("nested/keep.log"), "needle\n");
    write_file(&repo.path().join("nested/keep.txt"), "needle\n");
    write_file(&repo.path().join(".tmp/copy.txt"), "needle\n");
    write_file(&repo.path().join(".kiro/status.md"), "needle\n");

    let result = mtui::ops::search(
        repo.path(),
        Path::new("."),
        "needle",
        20,
        &mtui::config::MtuiConfig::default(),
    )
    .unwrap();

    let files = result
        .matches
        .iter()
        .map(|item| item.file.as_str())
        .collect::<Vec<_>>();
    assert_eq!(files, vec!["nested/keep.log", "nested/keep.txt"]);
}

#[test]
fn directory_search_honors_mtui_config_ignore_patterns() {
    let repo = tempfile::tempdir().unwrap();
    write_file(&repo.path().join("src/keep.txt"), "needle\n");
    write_file(&repo.path().join("generated/drop.txt"), "needle\n");
    let mut config = mtui::config::MtuiConfig::default();
    config.ignore.patterns.push("generated/**".to_string());

    let result = mtui::ops::search(repo.path(), Path::new("."), "needle", 20, &config).unwrap();

    assert_eq!(result.match_count, 1);
    assert_eq!(result.matches[0].file, "src/keep.txt");
}

#[test]
fn explicitly_requested_file_overrides_discovery_ignore_rules() {
    let repo = tempfile::tempdir().unwrap();
    write_file(&repo.path().join(".gitignore"), ".tmp/\n");
    let file = repo.path().join(".tmp/explicit.txt");
    write_file(&file, "needle\n");

    let result = mtui::ops::search(
        repo.path(),
        &file,
        "needle",
        20,
        &mtui::config::MtuiConfig::default(),
    )
    .unwrap();

    assert_eq!(result.match_count, 1);
    assert_eq!(result.matches[0].file, ".tmp/explicit.txt");
}

#[test]
fn directory_search_returns_deterministic_path_order() {
    let repo = tempfile::tempdir().unwrap();
    write_file(&repo.path().join("z/last.txt"), "needle\n");
    write_file(&repo.path().join("a/first.txt"), "needle\n");
    write_file(&repo.path().join("middle.txt"), "needle\n");

    let config = mtui::config::MtuiConfig::default();
    let first = mtui::ops::search(repo.path(), Path::new("."), "needle", 20, &config).unwrap();
    let second = mtui::ops::search(repo.path(), Path::new("."), "needle", 20, &config).unwrap();
    let paths = |result: &mtui::ops::SearchResult| {
        result
            .matches
            .iter()
            .map(|item| item.file.clone())
            .collect::<Vec<_>>()
    };

    assert_eq!(paths(&first), paths(&second));
    assert_eq!(
        paths(&first),
        vec![
            "a/first.txt".to_string(),
            "middle.txt".to_string(),
            "z/last.txt".to_string(),
        ]
    );
}

#[test]
fn parallel_search_applies_global_limit_after_deterministic_sorting() {
    let repo = tempfile::tempdir().unwrap();
    write_file(&repo.path().join("z/last.txt"), "needle\n");
    write_file(&repo.path().join("a/first.txt"), "needle\n");

    let result = mtui::ops::search(
        repo.path(),
        Path::new("."),
        "needle",
        1,
        &mtui::config::MtuiConfig::default(),
    )
    .unwrap();

    assert_eq!(result.matches[0].file, "a/first.txt");
    assert!(result.truncated);
}
