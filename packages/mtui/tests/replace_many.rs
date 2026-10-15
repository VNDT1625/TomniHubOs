use mtui::ops::{replace_files, replace_many, replace_regex, FileEdits, ReplaceEdit};
use std::path::Path;

fn setup_test_env() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    std::env::set_current_dir(dir.path()).ok();
    dir
}

fn write_file(path: &Path, content: &str) {
    std::fs::write(path, content).unwrap();
}

fn edit(old: &str, new: &str, all: bool) -> ReplaceEdit {
    ReplaceEdit {
        old: old.to_string(),
        new: new.to_string(),
        all,
    }
}

#[test]
fn applies_several_edits_as_one_operation() {
    let dir = setup_test_env();
    let file = dir.path().join("many.txt");
    write_file(&file, "alpha\nbeta\ngamma\n");
    let config = mtui::config::MtuiConfig::default();

    let result = replace_many(
        dir.path(),
        &file,
        &[edit("alpha", "ALPHA", false), edit("gamma", "GAMMA", false)],
        false,
        None,
        None,
        &config,
    )
    .unwrap();

    assert!(result.changed);
    assert_eq!(result.operation, "replace-many");
    assert_eq!(result.matches, Some(2));
    assert!(result.backup.is_some());
    assert_eq!(
        std::fs::read_to_string(&file).unwrap(),
        "ALPHA\nbeta\nGAMMA\n"
    );
}

#[test]
fn later_edits_see_the_result_of_earlier_ones() {
    let dir = setup_test_env();
    let file = dir.path().join("chain.txt");
    write_file(&file, "one\n");
    let config = mtui::config::MtuiConfig::default();

    replace_many(
        dir.path(),
        &file,
        &[edit("one", "two", false), edit("two", "three", false)],
        false,
        None,
        None,
        &config,
    )
    .unwrap();

    assert_eq!(std::fs::read_to_string(&file).unwrap(), "three\n");
}

#[test]
fn keeps_crlf_and_matches_multi_line_text_written_with_lf() {
    let dir = setup_test_env();
    let file = dir.path().join("crlf.txt");
    write_file(&file, "first\r\nsecond\r\nthird\r\n");
    let config = mtui::config::MtuiConfig::default();

    replace_many(
        dir.path(),
        &file,
        &[edit("first\nsecond", "first\ninserted\nsecond", false)],
        false,
        None,
        None,
        &config,
    )
    .unwrap();

    assert_eq!(
        std::fs::read(&file).unwrap(),
        b"first\r\ninserted\r\nsecond\r\nthird\r\n".to_vec()
    );
}

#[test]
fn writes_nothing_when_any_edit_fails() {
    let dir = setup_test_env();
    let file = dir.path().join("atomic.txt");
    write_file(&file, "keep\nme\n");
    let config = mtui::config::MtuiConfig::default();

    let missing = replace_many(
        dir.path(),
        &file,
        &[edit("keep", "changed", false), edit("absent", "x", false)],
        false,
        None,
        None,
        &config,
    );
    assert!(missing.is_err());
    assert!(missing.unwrap_err().to_string().contains("Edit 2 of 2"));
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "keep\nme\n");

    write_file(&file, "dup dup\n");
    let ambiguous = replace_many(
        dir.path(),
        &file,
        &[edit("dup", "x", false)],
        false,
        None,
        None,
        &config,
    );
    assert!(ambiguous.is_err());
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "dup dup\n");

    let all = replace_many(
        dir.path(),
        &file,
        &[edit("dup", "x", true)],
        false,
        None,
        None,
        &config,
    )
    .unwrap();
    assert_eq!(all.matches, Some(2));
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "x x\n");
}

#[test]
fn dry_run_and_empty_input_do_not_write() {
    let dir = setup_test_env();
    let file = dir.path().join("dry.txt");
    write_file(&file, "hello\n");
    let config = mtui::config::MtuiConfig::default();

    let dry = replace_many(
        dir.path(),
        &file,
        &[edit("hello", "bye", false)],
        true,
        None,
        None,
        &config,
    )
    .unwrap();
    assert!(!dry.changed);
    assert!(dry.backup.is_none());
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "hello\n");

    assert!(replace_many(dir.path(), &file, &[], false, None, None, &config).is_err());
    assert!(replace_many(
        dir.path(),
        &file,
        &[edit("", "x", false)],
        false,
        None,
        None,
        &config
    )
    .is_err());
}

fn file_edits(file: &str, edits: Vec<ReplaceEdit>) -> FileEdits {
    FileEdits {
        file: file.to_string(),
        edits,
    }
}

#[test]
fn regex_replacement_uses_captures_and_wants_one_match_unless_all() {
    let dir = setup_test_env();
    let file = dir.path().join("regex.txt");
    write_file(&file, "version = 1.2.3\r\nname = demo\r\n");
    let config = mtui::config::MtuiConfig::default();

    let result = replace_regex(
        dir.path(),
        &file,
        r"version = (\d+)\.(\d+)\.\d+",
        "version = $1.$2.9",
        false,
        false,
        None,
        None,
        &config,
    )
    .unwrap();
    assert_eq!(result.operation, "replace-regex");
    assert_eq!(
        std::fs::read(&file).unwrap(),
        b"version = 1.2.9\r\nname = demo\r\n".to_vec()
    );

    write_file(&file, "a1 a2 a3\n");
    assert!(replace_regex(
        dir.path(),
        &file,
        r"a\d",
        "b",
        false,
        false,
        None,
        None,
        &config
    )
    .is_err());
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "a1 a2 a3\n");
    let all = replace_regex(
        dir.path(),
        &file,
        r"a\d",
        "b",
        true,
        false,
        None,
        None,
        &config,
    )
    .unwrap();
    assert_eq!(all.matches, Some(3));
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "b b b\n");

    assert!(replace_regex(
        dir.path(),
        &file,
        "(",
        "x",
        false,
        false,
        None,
        None,
        &config
    )
    .is_err());
}

#[test]
fn edit_many_changes_several_files_and_one_group_undo_restores_them_all() {
    let dir = setup_test_env();
    std::fs::create_dir_all(dir.path().join(".mtui")).unwrap();
    let first = dir.path().join("one.txt");
    let second = dir.path().join("two.txt");
    write_file(&first, "alpha\n");
    write_file(&second, "beta\r\ngamma\r\n");
    let config = mtui::config::MtuiConfig::default();

    let result = replace_files(
        dir.path(),
        &[
            file_edits(first.to_str().unwrap(), vec![edit("alpha", "ALPHA", false)]),
            file_edits(
                second.to_str().unwrap(),
                vec![edit("beta\ngamma", "BETA\nGAMMA", false)],
            ),
        ],
        false,
        &config,
    )
    .unwrap();

    assert!(result.changed);
    assert_eq!(result.file_count, 2);
    assert!(result
        .files
        .iter()
        .all(|file| file.operation_id.starts_with(&result.group_id)));
    assert!(!result.files[0].file.starts_with(r"\\?\"));
    assert_eq!(std::fs::read_to_string(&first).unwrap(), "ALPHA\n");
    assert_eq!(
        std::fs::read(&second).unwrap(),
        b"BETA\r\nGAMMA\r\n".to_vec()
    );

    let conn = mtui::history::open_db(dir.path()).unwrap();
    let members = mtui::history::list_group_operations(&conn, &result.group_id).unwrap();
    assert_eq!(members.len(), 2);
    for member in &members {
        mtui::undo::undo_operation(dir.path(), member).unwrap();
    }
    assert_eq!(std::fs::read_to_string(&first).unwrap(), "alpha\n");
    assert_eq!(
        std::fs::read(&second).unwrap(),
        b"beta\r\ngamma\r\n".to_vec()
    );
}

#[test]
fn edit_many_writes_nothing_when_any_file_fails_or_a_file_repeats() {
    let dir = setup_test_env();
    let first = dir.path().join("one.txt");
    let second = dir.path().join("two.txt");
    write_file(&first, "alpha\n");
    write_file(&second, "beta\n");
    let config = mtui::config::MtuiConfig::default();

    let failing = replace_files(
        dir.path(),
        &[
            file_edits(first.to_str().unwrap(), vec![edit("alpha", "ALPHA", false)]),
            file_edits(second.to_str().unwrap(), vec![edit("absent", "x", false)]),
        ],
        false,
        &config,
    );
    assert!(failing.is_err());
    assert_eq!(std::fs::read_to_string(&first).unwrap(), "alpha\n");

    let repeated = replace_files(
        dir.path(),
        &[
            file_edits(first.to_str().unwrap(), vec![edit("alpha", "A", false)]),
            file_edits(first.to_str().unwrap(), vec![edit("A", "B", false)]),
        ],
        false,
        &config,
    );
    assert!(repeated.is_err());
    assert_eq!(std::fs::read_to_string(&first).unwrap(), "alpha\n");

    let dry = replace_files(
        dir.path(),
        &[file_edits(
            first.to_str().unwrap(),
            vec![edit("alpha", "ALPHA", false)],
        )],
        true,
        &config,
    )
    .unwrap();
    assert!(dry.dry_run && !dry.changed);
    assert_eq!(std::fs::read_to_string(&first).unwrap(), "alpha\n");
}

#[test]
fn a_failed_patch_names_the_hunk_and_shows_what_the_file_reads_now() {
    let dir = setup_test_env();
    std::process::Command::new("git")
        .arg("-C")
        .arg(dir.path())
        .arg("init")
        .arg("-q")
        .status()
        .unwrap();
    write_file(&dir.path().join("a.txt"), "one\ntwo\nthree\n");
    let patch = "\
diff --git a/a.txt b/a.txt
--- a/a.txt
+++ b/a.txt
@@ -1,3 +1,3 @@
 one
-NOT-THERE
+2
 three
";
    let config = mtui::config::MtuiConfig::default();
    let error = mtui::ops::apply_unified_patch(dir.path(), patch, &config, true, &[]).unwrap_err();
    let message = error.to_string();
    assert!(
        message.contains("a.txt: the hunk at line 1 no longer matches"),
        "{message}"
    );
    assert!(message.contains("the file now reads"), "{message}");
    assert!(message.contains("2: two"), "{message}");
}

#[test]
fn display_path_drops_the_windows_extended_prefix_only() {
    assert_eq!(
        mtui::ops::display_path(Path::new(r"\\?\C:\work\file.rs")),
        r"C:\work\file.rs"
    );
    assert_eq!(
        mtui::ops::display_path(Path::new("/work/file.rs")),
        "/work/file.rs"
    );
}
