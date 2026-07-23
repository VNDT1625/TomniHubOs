use std::path::Path;

fn base36(mut value: u64) -> String {
    if value == 0 {
        return "0".to_string();
    }
    let mut digits = Vec::new();
    while value > 0 {
        digits.push(std::char::from_digit((value % 36) as u32, 36).unwrap());
        value /= 36;
    }
    digits.iter().rev().collect()
}

fn fingerprint_of(content: &str) -> String {
    let mut hash = 0x811c9dc5_u32;
    let mut length = 0_u64;
    for unit in content.encode_utf16() {
        length += 1;
        hash ^= u32::from(unit & 0xff);
        hash = hash.wrapping_mul(0x01000193);
        hash ^= u32::from(unit >> 8);
        hash = hash.wrapping_mul(0x01000193);
    }
    format!("{}-{}", base36(length), base36(u64::from(hash)))
}

fn summary_file(path: &str, summary: &str, fingerprint: Option<&str>) -> serde_json::Value {
    let label = path.rsplit('/').next().unwrap_or(path);
    let group = path.split('/').next().unwrap_or(path);
    serde_json::json!({
        "path": path,
        "label": label,
        "group": group,
        "layer": "service",
        "summary": summary,
        "summarySource": "fallback",
        "tags": [],
        "symbols": [],
        "language": "typescript",
        "importedBy": 0,
        "fingerprint": fingerprint,
    })
}

fn write_summary(root: &Path, metadata_dir: &str, built_at: u64, files: Vec<serde_json::Value>) {
    let dir = root.join(metadata_dir).join("understand");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("summary.json"),
        serde_json::json!({
            "version": 2,
            "rootPath": root,
            "graphVersion": 5,
            "builtAt": built_at,
            "overview": null,
            "runbook": null,
            "modules": [],
            "files": files,
        })
        .to_string(),
    )
    .unwrap();
}

fn write_summary_with_source_snapshot(
    root: &Path,
    built_at: u64,
    source_snapshot_at: u64,
    files: Vec<serde_json::Value>,
) {
    let dir = root.join(".tomni/understand");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("summary.json"),
        serde_json::json!({
            "version": 3,
            "rootPath": root,
            "graphVersion": 5,
            "builtAt": built_at,
            "sourceSnapshotAt": source_snapshot_at,
            "overview": null,
            "runbook": null,
            "modules": [],
            "files": files,
        })
        .to_string(),
    )
    .unwrap();
}

#[test]
fn understand_context_prefers_canonical_tomni_summary_over_legacy_aionui() {
    let repo = tempfile::tempdir().unwrap();
    let src = repo.path().join("src");
    std::fs::create_dir_all(&src).unwrap();
    std::fs::write(
        src.join("canonical.ts"),
        "export const canonical_signal = true;\n",
    )
    .unwrap();
    std::fs::write(src.join("legacy.ts"), "export const legacy = true;\n").unwrap();

    write_summary(
        repo.path(),
        ".tomni",
        200,
        vec![summary_file(
            "src/canonical.ts",
            "Owns canonical_signal behavior.",
            None,
        )],
    );
    write_summary(
        repo.path(),
        ".aionui",
        100,
        vec![summary_file(
            "src/legacy.ts",
            "Obsolete legacy cache entry.",
            None,
        )],
    );

    let result = mtui::understand::query_context(repo.path(), "canonical_signal", 5).unwrap();

    assert_eq!(result.built_at, 200, "the canonical cache must win");
    assert!(result
        .candidates
        .iter()
        .any(|candidate| candidate.path == "src/canonical.ts"));
    assert!(result
        .candidates
        .iter()
        .all(|candidate| candidate.path != "src/legacy.ts"));
}

#[test]
fn understand_context_never_returns_a_missing_cached_candidate() {
    let repo = tempfile::tempdir().unwrap();
    let src = repo.path().join("src");
    std::fs::create_dir_all(&src).unwrap();
    let current_source = "export const ghostbackend_live = true;\n";
    std::fs::write(src.join("currentBackend.ts"), current_source).unwrap();
    let current_fingerprint = fingerprint_of(current_source);

    write_summary(
        repo.path(),
        ".aionui",
        100,
        vec![
            summary_file(
                "src/ghostBackend.ts",
                "Owns ghostbackend websocket routing.",
                None,
            ),
            summary_file(
                "src/currentBackend.ts",
                "Current ghostbackend implementation.",
                Some(&current_fingerprint),
            ),
        ],
    );

    let result = mtui::understand::query_context(repo.path(), "ghostbackend", 5).unwrap();

    assert!(result
        .candidates
        .iter()
        .any(|candidate| candidate.path == "src/currentBackend.ts"));
    assert!(
        result.candidates.iter().all(|candidate| {
            repo.path().join(&candidate.path).is_file() && candidate.path != "src/ghostBackend.ts"
        }),
        "query_context must tombstone missing cache records before ranking"
    );
}

#[test]
fn ignored_tmp_stale_marker_does_not_make_current_candidate_globally_stale() {
    let repo = tempfile::tempdir().unwrap();
    let src = repo.path().join("src");
    let tmp = repo.path().join(".tmp");
    std::fs::create_dir_all(&src).unwrap();
    std::fs::create_dir_all(&tmp).unwrap();
    std::fs::write(repo.path().join(".gitignore"), ".tmp/\n").unwrap();
    std::fs::write(tmp.join("generated.ts"), "export const generated = true;\n").unwrap();
    let current_source = "export const live_signal = true;\n";
    std::fs::write(src.join("live.ts"), current_source).unwrap();
    let current_fingerprint = fingerprint_of(current_source);

    write_summary(
        repo.path(),
        ".aionui",
        100,
        vec![summary_file(
            "src/live.ts",
            "Owns live_signal behavior.",
            Some(&current_fingerprint),
        )],
    );
    std::fs::write(
        repo.path()
            .join(".aionui")
            .join("understand")
            .join("stale.json"),
        serde_json::json!({ "paths": [".tmp/generated.ts"] }).to_string(),
    )
    .unwrap();

    let result = mtui::understand::query_context(repo.path(), "live_signal", 5).unwrap();
    let candidate = result
        .candidates
        .iter()
        .find(|candidate| candidate.path == "src/live.ts")
        .expect("live candidate");

    assert_eq!(result.freshness.marker_changed_count, 0);
    assert!(result.freshness.fresh);
    assert!(!candidate.stale);
}

#[test]
fn unrelated_stale_marker_does_not_taint_a_current_candidate() {
    let repo = tempfile::tempdir().unwrap();
    let src = repo.path().join("src");
    std::fs::create_dir_all(&src).unwrap();
    let live_source = "export const live_signal = true;\n";
    let other_source = "export const other_signal = true;\n";
    std::fs::write(src.join("live.ts"), live_source).unwrap();
    std::fs::write(src.join("other.ts"), other_source).unwrap();

    write_summary(
        repo.path(),
        ".tomni",
        300,
        vec![
            summary_file(
                "src/live.ts",
                "Owns live_signal behavior.",
                Some(&fingerprint_of(live_source)),
            ),
            summary_file(
                "src/other.ts",
                "Owns other_signal behavior.",
                Some(&fingerprint_of(other_source)),
            ),
        ],
    );
    std::fs::write(
        repo.path()
            .join(".tomni")
            .join("understand")
            .join("stale.json"),
        serde_json::json!({ "paths": ["src/other.ts"] }).to_string(),
    )
    .unwrap();

    let result = mtui::understand::query_context(repo.path(), "live_signal", 1).unwrap();
    let candidate = result.candidates.first().expect("live candidate");

    assert_eq!(candidate.path, "src/live.ts");
    assert!(!candidate.stale);
    assert!(
        !result.stale,
        "unrelated changes must not demote a verified context pack"
    );
    assert!(!result.freshness.fresh);
}

#[test]
fn cache_newer_than_file_uses_metadata_fast_path_without_reading_contents() {
    let repo = tempfile::tempdir().unwrap();
    let src = repo.path().join("src");
    std::fs::create_dir_all(&src).unwrap();
    std::fs::write(src.join("fastPath.ts"), [0xff, 0xfe, 0xfd]).unwrap();
    let built_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
        + 60_000;

    write_summary(
        repo.path(),
        ".tomni",
        built_at,
        vec![summary_file(
            "src/fastPath.ts",
            "Owns fast_path_signal behavior.",
            Some("fingerprint-produced-during-build"),
        )],
    );

    let result = mtui::understand::query_context(repo.path(), "fast_path_signal", 1).unwrap();
    let candidate = result.candidates.first().expect("fast-path candidate");

    assert!(result.freshness.fresh);
    assert!(!candidate.stale);
}

#[test]
fn marker_touched_file_is_hashed_even_when_cache_timestamp_is_newer() {
    let repo = tempfile::tempdir().unwrap();
    let src = repo.path().join("src");
    std::fs::create_dir_all(&src).unwrap();
    let original = "export const marker_signal = 'before';\n";
    std::fs::write(
        src.join("marker.ts"),
        "export const marker_signal = 'after';\n",
    )
    .unwrap();
    let built_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
        + 60_000;
    write_summary(
        repo.path(),
        ".tomni",
        built_at,
        vec![summary_file(
            "src/marker.ts",
            "Owns marker_signal behavior.",
            Some(&fingerprint_of(original)),
        )],
    );
    std::fs::write(
        repo.path().join(".tomni/understand/stale.json"),
        serde_json::json!({ "paths": ["src/marker.ts"] }).to_string(),
    )
    .unwrap();

    let result = mtui::understand::query_context(repo.path(), "marker_signal", 1).unwrap();

    assert_eq!(result.freshness.changed_count, 1);
    assert!(result.candidates.first().expect("marker candidate").stale);
}

#[test]
fn filesystem_fallback_uses_shared_ignore_aware_discovery() {
    let repo = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(repo.path().join("src")).unwrap();
    std::fs::create_dir_all(repo.path().join(".tmp")).unwrap();
    std::fs::write(repo.path().join(".gitignore"), ".tmp/\n").unwrap();
    std::fs::write(
        repo.path().join("src/unique_fallback_signal.ts"),
        "export const unique_fallback_signal = true;\n",
    )
    .unwrap();
    std::fs::write(
        repo.path().join(".tmp/unique_fallback_signal.ts"),
        "export const unique_fallback_signal = false;\n",
    )
    .unwrap();

    let result = mtui::understand::query_context(repo.path(), "unique_fallback_signal", 5).unwrap();

    assert!(result
        .candidates
        .iter()
        .any(|candidate| candidate.path == "src/unique_fallback_signal.ts"));
    assert!(result
        .candidates
        .iter()
        .all(|candidate| !candidate.path.starts_with(".tmp/")));
}

#[test]
fn canonical_live_marker_invalidates_legacy_cache_until_canonical_rebuild() {
    let repo = tempfile::tempdir().unwrap();
    let src = repo.path().join("src");
    std::fs::create_dir_all(&src).unwrap();
    let touched_source = "export const shared_live_signal_touched = true;\n";
    let current_source = "export const shared_live_signal_current = true;\n";
    std::fs::write(src.join("touched.ts"), touched_source).unwrap();
    std::fs::write(src.join("current.ts"), current_source).unwrap();
    let future = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
        + 60_000;
    let files = vec![
        summary_file(
            "src/touched.ts",
            "Owns shared_live_signal touched behavior.",
            Some(&fingerprint_of(touched_source)),
        ),
        summary_file(
            "src/current.ts",
            "Owns shared_live_signal current behavior.",
            Some(&fingerprint_of(current_source)),
        ),
    ];
    write_summary(repo.path(), ".aionui", future, files.clone());
    let canonical_marker = repo.path().join(".tomni/understand/stale.json");
    std::fs::create_dir_all(canonical_marker.parent().unwrap()).unwrap();
    std::fs::write(
        &canonical_marker,
        serde_json::json!({ "paths": ["src/touched.ts"] }).to_string(),
    )
    .unwrap();

    let invalidated =
        mtui::understand::query_context(repo.path(), "shared_live_signal", 5).unwrap();
    let touched = invalidated
        .candidates
        .iter()
        .find(|candidate| candidate.path == "src/touched.ts")
        .expect("touched candidate");
    let current = invalidated
        .candidates
        .iter()
        .find(|candidate| candidate.path == "src/current.ts")
        .expect("current candidate");

    assert!(touched.stale);
    assert!(!current.stale);

    std::fs::remove_file(canonical_marker).unwrap();
    write_summary(repo.path(), ".tomni", future + 1, files);
    let rebuilt = mtui::understand::query_context(repo.path(), "shared_live_signal", 5).unwrap();

    assert_eq!(rebuilt.built_at, future + 1);
    assert!(rebuilt.freshness.fresh);
    assert!(rebuilt.candidates.iter().all(|candidate| !candidate.stale));
}

#[test]
fn full_rebuild_marker_forces_global_hash_verification_and_staleness() {
    let repo = tempfile::tempdir().unwrap();
    let src = repo.path().join("src");
    std::fs::create_dir_all(&src).unwrap();
    let before = "export const overflow_signal = 'before';\n";
    std::fs::write(
        src.join("overflow.ts"),
        "export const overflow_signal = 'after';\n",
    )
    .unwrap();
    let future = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
        + 60_000;
    write_summary(
        repo.path(),
        ".tomni",
        future,
        vec![summary_file(
            "src/overflow.ts",
            "Owns overflow_signal behavior.",
            Some(&fingerprint_of(before)),
        )],
    );
    std::fs::write(
        repo.path().join(".tomni/understand/stale.json"),
        serde_json::json!({
            "paths": [],
            "fullRebuildRequired": true,
        })
        .to_string(),
    )
    .unwrap();

    let result = mtui::understand::query_context(repo.path(), "overflow_signal", 1).unwrap();
    let freshness = serde_json::to_value(&result.freshness).unwrap();

    assert_eq!(freshness["full_rebuild_required"].as_bool(), Some(true));
    assert_eq!(
        result.freshness.changed_count, 1,
        "all cached files must be hashed"
    );
    assert!(!result.freshness.fresh);
    assert!(result.stale);
    assert!(result.candidates.first().expect("candidate").stale);
}

#[test]
fn source_snapshot_time_not_build_completion_controls_the_mtime_fast_path() {
    let repo = tempfile::tempdir().unwrap();
    let src = repo.path().join("src");
    std::fs::create_dir_all(&src).unwrap();
    let before = "export const snapshot_signal = 'before';\n";
    std::fs::write(
        src.join("snapshot.ts"),
        "export const snapshot_signal = 'after';\n",
    )
    .unwrap();
    let future = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
        + 60_000;
    write_summary_with_source_snapshot(
        repo.path(),
        future,
        1,
        vec![summary_file(
            "src/snapshot.ts",
            "Owns snapshot_signal behavior.",
            Some(&fingerprint_of(before)),
        )],
    );

    let result = mtui::understand::query_context(repo.path(), "snapshot_signal", 1).unwrap();

    assert_eq!(result.freshness.changed_count, 1);
    assert!(result.stale);
    assert!(result.candidates.first().expect("candidate").stale);
}

#[test]
fn full_rebuild_marker_keeps_an_empty_cache_globally_stale() {
    let repo = tempfile::tempdir().unwrap();
    write_summary(repo.path(), ".tomni", 100, Vec::new());
    std::fs::write(
        repo.path().join(".tomni/understand/stale.json"),
        serde_json::json!({
            "paths": [],
            "fullRebuildRequired": true,
        })
        .to_string(),
    )
    .unwrap();

    let folder = mtui::understand::query_folder(repo.path(), Path::new("."), false).unwrap();
    let context = mtui::understand::query_context(repo.path(), "anything", 5).unwrap();

    assert!(folder.stale);
    assert!(context.stale);
    assert!(context.freshness.full_rebuild_required);
}
