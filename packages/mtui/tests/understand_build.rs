use mtui::understand::build::{build, status, BuildOptions};
use serde_json::Value;
use std::path::Path;

fn write(root: &Path, rel: &str, content: &str) {
    let path = root.join(rel);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, content).unwrap();
}

fn options() -> BuildOptions {
    BuildOptions {
        full: false,
        max_files: 20_000,
        ignore_patterns: vec!["ignored/**".to_string()],
    }
}

fn cache(root: &Path) -> Value {
    let text = std::fs::read_to_string(root.join(".tomni/understand/summary.json")).unwrap();
    serde_json::from_str(&text).unwrap()
}

fn file<'a>(cache: &'a Value, path: &str) -> &'a Value {
    cache["files"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["path"] == path)
        .unwrap_or_else(|| panic!("{path} missing from cache"))
}

fn has_edge(cache: &Value, from: &str, to: &str) -> bool {
    cache["edges"]
        .as_array()
        .unwrap()
        .iter()
        .any(|e| e["from"] == from && e["to"] == to)
}

fn sample_project(root: &Path) {
    write(
        root,
        "tsconfig.json",
        r#"{
  // comments and trailing commas are allowed in tsconfig
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@lib/*": ["src/lib/*"], },
  },
}"#,
    );
    write(root, ".git/HEAD", "ref: refs/heads/main\n");
    write(
        root,
        "src/app.ts",
        "/**\n * @license\n * Copyright 2025\n */\n/** Boots the application. */\nimport { helper } from './util/helper';\nimport { shared } from '@lib/shared';\nimport type { Thing } from './types';\nexport function boot(): void {}\n",
    );
    write(
        root,
        "src/util/helper.ts",
        "export const helper = () => 1;\n",
    );
    write(
        root,
        "src/lib/shared/index.ts",
        "export const shared = 2;\n",
    );
    write(
        root,
        "src/types.ts",
        "export type Thing = { id: string };\n",
    );
    write(
        root,
        "src/ui/Panel.tsx",
        "export function Panel() { return null; }\n",
    );
    write(root, "src/app.test.ts", "import { boot } from './app';\n");
    write(root, "src/lib.rs", "pub mod engine;\npub fn run() {}\n");
    write(
        root,
        "src/engine.rs",
        "use crate::util::tools;\npub struct Engine;\n",
    );
    write(root, "src/util.rs", "pub mod tools;\n");
    write(root, "src/util/tools.rs", "pub fn tool() {}\n");
    write(root, "node_modules/pkg/index.js", "module.exports = 1;\n");
    write(root, "ignored/skip.ts", "export const skipped = true;\n");
    write(
        root,
        "README.md",
        "# Sample\n\nA tiny sample project for the builder.\n",
    );
}

#[test]
fn builds_files_symbols_layers_and_edges_without_the_ide() {
    let dir = tempfile::tempdir().unwrap();
    sample_project(dir.path());

    let result = build(dir.path(), &options()).unwrap();
    assert_eq!(result.mode, "full");
    assert!(!result.truncated);

    let cache = cache(dir.path());
    let paths: Vec<&str> = cache["files"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["path"].as_str().unwrap())
        .collect();
    assert!(!paths.iter().any(|p| p.starts_with("node_modules/")));
    assert!(!paths.iter().any(|p| p.starts_with("ignored/")));
    assert!(!paths.iter().any(|p| p.starts_with(".git/")));

    assert!(has_edge(&cache, "src/app.ts", "src/util/helper.ts"));
    assert!(has_edge(&cache, "src/app.ts", "src/lib/shared/index.ts"));
    assert!(has_edge(&cache, "src/app.ts", "src/types.ts"));
    assert!(has_edge(&cache, "src/app.test.ts", "src/app.ts"));
    assert!(has_edge(&cache, "src/lib.rs", "src/engine.rs"));
    assert!(has_edge(&cache, "src/engine.rs", "src/util/tools.rs"));

    let app = file(&cache, "src/app.ts");
    assert_eq!(app["language"], "typescript");
    assert_eq!(app["importedBy"], 1);
    assert_eq!(app["summarySource"], "mtui-static");
    assert_eq!(app["summary"], "Boots the application.");
    assert_eq!(app["symbols"][0]["name"], "boot");
    assert_eq!(app["symbols"][0]["kind"], "function");
    assert_eq!(file(&cache, "src/app.test.ts")["layer"], "test");
    assert_eq!(
        file(&cache, "src/ui/Panel.tsx")["symbols"][0]["kind"],
        "component"
    );
    assert_eq!(file(&cache, "src/engine.rs")["symbols"][0]["kind"], "class");
    assert_eq!(
        cache["overview"]["description"],
        "A tiny sample project for the builder."
    );
    assert!(cache["modules"]
        .as_array()
        .unwrap()
        .iter()
        .any(|m| m["id"] == "."));
}

#[test]
fn queries_read_the_built_cache_as_fresh() {
    let dir = tempfile::tempdir().unwrap();
    sample_project(dir.path());
    build(dir.path(), &options()).unwrap();

    let context =
        mtui::understand::query_context(dir.path(), "boot application helper", 5).unwrap();
    assert!(!context.stale);
    assert!(context.candidates.iter().any(|c| c.path == "src/app.ts"));

    let summary = mtui::understand::query_file(dir.path(), Path::new("src/app.ts"), false).unwrap();
    assert!(!summary.stale);
}

#[test]
fn incremental_build_keeps_semantic_summaries_only_for_unchanged_files() {
    let dir = tempfile::tempdir().unwrap();
    sample_project(dir.path());
    build(dir.path(), &options()).unwrap();

    let mut edited = cache(dir.path());
    for entry in edited["files"].as_array_mut().unwrap() {
        if entry["path"] == "src/app.ts" || entry["path"] == "src/types.ts" {
            entry["summary"] = Value::String("Semantic summary from another builder.".into());
            entry["summarySource"] = Value::String("llm".into());
        }
    }
    std::fs::write(
        dir.path().join(".tomni/understand/summary.json"),
        serde_json::to_vec(&edited).unwrap(),
    )
    .unwrap();
    write(
        dir.path(),
        "src/types.ts",
        "export type Thing = { id: string; name: string };\n",
    );

    let result = build(dir.path(), &options()).unwrap();
    assert_eq!(result.mode, "incremental");
    assert_eq!(result.changed_count, 1);
    assert_eq!(result.preserved_summary_count, 1);

    let cache = cache(dir.path());
    assert_eq!(
        file(&cache, "src/app.ts")["summary"],
        "Semantic summary from another builder."
    );
    assert_eq!(file(&cache, "src/app.ts")["summarySource"], "llm");
    assert_eq!(file(&cache, "src/types.ts")["summarySource"], "mtui-static");

    let full = build(
        dir.path(),
        &BuildOptions {
            full: true,
            ..options()
        },
    )
    .unwrap();
    assert_eq!(full.preserved_summary_count, 0);
}

#[test]
fn build_clears_the_stale_marker_and_tracks_removed_files() {
    let dir = tempfile::tempdir().unwrap();
    sample_project(dir.path());
    build(dir.path(), &options()).unwrap();

    let marker = dir.path().join(".tomni/understand/stale.json");
    std::fs::write(
        &marker,
        r#"{"version":1,"paths":["src/app.ts"],"fullRebuildRequired":false}"#,
    )
    .unwrap();
    assert_eq!(status(dir.path()).stale_marker_paths, 1);
    std::fs::remove_file(dir.path().join("src/types.ts")).unwrap();

    let result = build(dir.path(), &options()).unwrap();
    assert_eq!(result.removed_count, 1);
    assert!(!marker.exists());
    let after = status(dir.path());
    assert!(after.exists);
    assert_eq!(after.stale_marker_paths, 0);
    assert_eq!(after.builder.as_deref(), Some("mtui"));
}

#[test]
fn max_files_truncates_and_reports_it() {
    let dir = tempfile::tempdir().unwrap();
    sample_project(dir.path());
    let result = build(
        dir.path(),
        &BuildOptions {
            max_files: 3,
            ..options()
        },
    )
    .unwrap();
    assert!(result.truncated);
    assert_eq!(result.file_count, 3);
}

#[test]
fn status_reports_a_missing_cache() {
    let dir = tempfile::tempdir().unwrap();
    let report = status(dir.path());
    assert!(!report.exists);
    assert!(report.recommendation.contains("mtui understand build"));
}

#[test]
fn refuses_to_index_a_filesystem_root() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().ancestors().last().unwrap();
    assert!(mtui::understand::build::is_unsafe_index_root(root));
    assert!(!mtui::understand::build::is_unsafe_index_root(dir.path()));
    let error = build(root, &options())
        .err()
        .expect("a drive root must be rejected");
    assert!(matches!(
        error,
        mtui::error::MtuiError::InvalidArgument { .. }
    ));
}
