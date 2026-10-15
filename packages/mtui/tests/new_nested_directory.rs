use mtui::config::MtuiConfig;
use std::path::Path;

fn create(root: &Path, rel: &str) -> Result<(), mtui::error::MtuiError> {
    mtui::ops::create_file(
        root,
        Path::new(rel),
        b"x\n",
        false,
        &MtuiConfig::default(),
        false,
    )
    .map(|_| ())
}

#[test]
fn new_creates_missing_parent_directories_inside_the_project() {
    let dir = tempfile::tempdir().unwrap();
    create(dir.path(), "a/b/c.txt").unwrap();
    assert_eq!(
        std::fs::read_to_string(dir.path().join("a/b/c.txt")).unwrap(),
        "x\n"
    );
}

#[test]
fn new_still_rejects_paths_that_escape_the_project() {
    let outer = tempfile::tempdir().unwrap();
    let root = outer.path().join("project");
    std::fs::create_dir_all(&root).unwrap();

    let error = create(&root, "../escaped/file.txt").unwrap_err();
    assert!(matches!(
        error,
        mtui::error::MtuiError::PathOutsideProject { .. }
    ));
    let error = create(&root, "fresh/../../escaped/file.txt").unwrap_err();
    assert!(matches!(
        error,
        mtui::error::MtuiError::PathOutsideProject { .. }
    ));
    let absolute = outer.path().join("elsewhere/file.txt");
    let error = create(&root, absolute.to_str().unwrap()).unwrap_err();
    assert!(matches!(
        error,
        mtui::error::MtuiError::PathOutsideProject { .. }
    ));
    assert!(!outer.path().join("escaped").exists());
    assert!(!outer.path().join("elsewhere").exists());
}
