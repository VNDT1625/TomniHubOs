use mtui::config::MtuiConfig;
use std::path::Path;

fn write(root: &Path, rel: &str) {
    let path = root.join(rel);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, "x\n").unwrap();
}

fn project() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    for rel in [
        "src/a.ts",
        "src/b.tsx",
        "src/deep/c.ts",
        "src/deep/d.rs",
        "docs/readme.md",
        "node_modules/pkg/x.ts",
    ] {
        write(dir.path(), rel);
    }
    std::fs::write(dir.path().join(".gitignore"), "ignored/\n").unwrap();
    write(dir.path(), "ignored/skip.ts");
    dir
}

fn glob(root: &Path, dir: &str, pattern: &str, limit: usize) -> mtui::ops::GlobResult {
    mtui::ops::glob_files(root, Path::new(dir), pattern, limit, &MtuiConfig::default()).unwrap()
}

#[test]
fn recursive_patterns_return_sorted_project_relative_paths() {
    let dir = project();
    let result = glob(dir.path(), ".", "**/*.ts", 100);
    assert_eq!(result.files, ["src/a.ts", "src/deep/c.ts"]);
    assert!(!result.truncated);
}

#[test]
fn patterns_are_relative_to_the_requested_directory_and_support_braces() {
    let dir = project();
    let result = glob(dir.path(), "src", "*.{ts,tsx}", 100);
    assert_eq!(result.files, ["src/a.ts", "src/b.tsx", "src/deep/c.ts"]);
    assert_eq!(result.dir, "src");
}

#[test]
fn ignored_directories_and_gitignored_paths_are_skipped() {
    let dir = project();
    let result = glob(dir.path(), ".", "**/*.ts", 100);
    assert!(result
        .files
        .iter()
        .all(|file| !file.starts_with("node_modules/")));
    assert!(result
        .files
        .iter()
        .all(|file| !file.starts_with("ignored/")));
}

#[test]
fn limit_truncates_and_reports_it() {
    let dir = project();
    let result = glob(dir.path(), ".", "**/*.ts", 1);
    assert_eq!(result.files, ["src/a.ts"]);
    assert!(result.truncated);
}

#[test]
fn a_file_or_missing_directory_or_bad_pattern_is_rejected() {
    let dir = project();
    let config = MtuiConfig::default();
    assert!(mtui::ops::glob_files(dir.path(), Path::new("src/a.ts"), "*", 10, &config).is_err());
    assert!(mtui::ops::glob_files(dir.path(), Path::new("nope"), "*", 10, &config).is_err());
    assert!(mtui::ops::glob_files(dir.path(), Path::new("src"), "[", 10, &config).is_err());
}

#[test]
fn directories_outside_the_project_are_rejected() {
    let outer = tempfile::tempdir().unwrap();
    let root = outer.path().join("project");
    std::fs::create_dir_all(&root).unwrap();
    let error = mtui::ops::glob_files(&root, Path::new(".."), "*", 10, &MtuiConfig::default())
        .err()
        .expect("escaping the project must fail");
    assert!(matches!(
        error,
        mtui::error::MtuiError::PathOutsideProject { .. }
    ));
}
