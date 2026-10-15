use mtui::backup::gc::{auto_gc_if_due, run_gc, GcOptions};
use mtui::config::MtuiConfig;
use std::path::Path;

fn touch(path: &Path, bytes: usize) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, vec![b'x'; bytes]).unwrap();
}

fn stamp(days_ago: i64) -> String {
    (chrono::Local::now().date_naive() - chrono::Duration::days(days_ago))
        .format("%Y%m%d")
        .to_string()
}

fn project() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let mtui = dir.path().join(".mtui");
    for days_ago in [0, 3, 30, 90] {
        let day = stamp(days_ago);
        touch(&mtui.join(format!("diffs/op_{day}_010101_aaaa.diff")), 10);
        touch(
            &mtui.join(format!("verify/verify_{day}_010101_bbbb.log")),
            20,
        );
    }
    touch(&mtui.join("diffs/notes.txt"), 5);
    touch(&mtui.join("verify/claude-ipc-1"), 5);
    dir
}

fn options(dry_run: bool) -> GcOptions {
    GcOptions {
        dry_run,
        days: None,
        force: false,
        max_mb: None,
    }
}

fn names(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
        .collect();
    names.sort();
    names
}

#[test]
fn gc_prunes_only_old_diffs_and_verify_logs() {
    let dir = project();
    let result = run_gc(dir.path(), &options(false)).unwrap();
    assert_eq!(result.diff_files_removed, 2);
    assert_eq!(result.verify_logs_removed, 2);
    assert_eq!(result.aux_freed_bytes, 2 * 10 + 2 * 20);

    let mtui = dir.path().join(".mtui");
    let diffs = names(&mtui.join("diffs"));
    assert_eq!(
        diffs.len(),
        3,
        "two recent diffs and the unrelated file stay: {diffs:?}"
    );
    assert!(diffs.contains(&"notes.txt".to_string()));
    let logs = names(&mtui.join("verify"));
    assert_eq!(
        logs.len(),
        3,
        "two recent logs and the unrelated entry stay: {logs:?}"
    );
    assert!(logs.contains(&"claude-ipc-1".to_string()));
}

#[test]
fn gc_dry_run_reports_without_deleting() {
    let dir = project();
    let result = run_gc(dir.path(), &options(true)).unwrap();
    assert_eq!(result.diff_files_removed, 2);
    assert_eq!(names(&dir.path().join(".mtui/diffs")).len(), 5);
}

#[test]
fn auto_gc_runs_once_per_day() {
    let dir = project();
    let config = MtuiConfig::default();
    auto_gc_if_due(dir.path(), &config);
    assert_eq!(names(&dir.path().join(".mtui/diffs")).len(), 3);
    assert!(dir.path().join(".mtui/last-gc").exists());

    // A new old file is left alone until the marker is a day old.
    touch(
        &dir.path()
            .join(format!(".mtui/diffs/op_{}_020202_cccc.diff", stamp(60))),
        10,
    );
    auto_gc_if_due(dir.path(), &config);
    assert_eq!(names(&dir.path().join(".mtui/diffs")).len(), 4);
}

#[test]
fn auto_gc_respects_the_config_switch() {
    let dir = project();
    let mut config = MtuiConfig::default();
    config.backup.auto_gc_on_run = false;
    auto_gc_if_due(dir.path(), &config);
    assert_eq!(names(&dir.path().join(".mtui/diffs")).len(), 5);
    assert!(!dir.path().join(".mtui/last-gc").exists());
}

#[test]
fn an_old_empty_marker_is_refreshed_so_the_collection_does_not_run_on_every_command() {
    let dir = project();
    let config = MtuiConfig::default();
    let marker = dir.path().join(".mtui/last-gc");
    std::fs::write(&marker, b"").unwrap();
    let two_days_ago =
        std::time::SystemTime::now() - std::time::Duration::from_secs(2 * 24 * 60 * 60);
    std::fs::File::options()
        .write(true)
        .open(&marker)
        .unwrap()
        .set_modified(two_days_ago)
        .unwrap();

    auto_gc_if_due(dir.path(), &config);
    let age = std::fs::metadata(&marker)
        .unwrap()
        .modified()
        .unwrap()
        .elapsed()
        .unwrap();
    assert!(
        age < std::time::Duration::from_secs(60 * 60),
        "marker still looks old: {age:?}"
    );

    touch(
        &dir.path()
            .join(format!(".mtui/diffs/op_{}_030303_dddd.diff", stamp(60))),
        10,
    );
    let before = names(&dir.path().join(".mtui/diffs")).len();
    auto_gc_if_due(dir.path(), &config);
    assert_eq!(names(&dir.path().join(".mtui/diffs")).len(), before);
}
