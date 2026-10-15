use mtui::understand::build::{build, BuildOptions};
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
        ignore_patterns: Vec::new(),
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

fn notes_folder(root: &Path) {
    write(
        root,
        "README.md",
        "# Team notes\n\nEverything we decided this quarter.\n",
    );
    write(
        root,
        "notes/meeting.md",
        "---\ntitle: Budget meeting\n---\n\nWe discussed the budget for next year and agreed to hire two people.\n\n## Decisions\n\nHire two engineers.\n\n## Risks\n\nSee [the plan](plan.md#risks) and [[Glossary]].\n\n```md\n[ignored](nowhere.md)\n```\n",
    );
    write(
        root,
        "notes/plan.md",
        "# Plan\n\nThe hiring plan.\n\n## Timeline\n\nQ1 and Q2.\n",
    );
    write(root, "wiki/Glossary.md", "# Glossary\n\nTerms we use.\n");
    write(
        root,
        "notes/diary.txt",
        "Diary of a busy week\n\nMonday was long. Tuesday was longer.\n",
    );
    write(
        root,
        "data/sales.csv",
        "region,units,\"revenue, usd\"\nnorth,10,100\nsouth,20,250\n\n",
    );
    write(root, "report.pdf", "%PDF-1.4 not text");
}

#[test]
fn a_notes_folder_is_classified_as_documents_and_indexes_text_and_tables() {
    let dir = tempfile::tempdir().unwrap();
    notes_folder(dir.path());

    let result = build(dir.path(), &options()).unwrap();
    assert_eq!(result.kind, "docs");

    let cache = cache(dir.path());
    assert_eq!(cache["kind"], "docs");
    let paths: Vec<&str> = cache["files"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["path"].as_str().unwrap())
        .collect();
    assert!(paths.contains(&"notes/diary.txt"));
    assert!(paths.contains(&"data/sales.csv"));
    assert!(
        !paths.contains(&"report.pdf"),
        "binary documents are not text"
    );

    let meeting = file(&cache, "notes/meeting.md");
    let summary = meeting["summary"].as_str().unwrap();
    assert!(
        summary.starts_with("Budget meeting — We discussed the budget"),
        "{summary}"
    );
    assert!(summary.contains("Sections: Decisions, Risks."), "{summary}");
    assert_eq!(meeting["tags"][0], "docs");
    let names: Vec<&str> = meeting["symbols"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["Decisions", "Risks"]);
    assert_eq!(meeting["symbols"][0]["kind"], "section");

    let table = file(&cache, "data/sales.csv");
    assert_eq!(
        table["summary"],
        "Table with 3 column(s) (region, units, revenue, usd) and 2 row(s)."
    );
    assert_eq!(table["layer"], "data");
    assert_eq!(table["tags"][0], "table");
    assert_eq!(table["symbols"][2]["name"], "revenue, usd");

    let diary = file(&cache, "notes/diary.txt");
    assert!(diary["summary"]
        .as_str()
        .unwrap()
        .starts_with("Diary of a busy week — Monday was long."));

    assert!(cache["overview"]["description"]
        .as_str()
        .unwrap()
        .contains("Everything we decided"));
    assert!(cache["overview"]["entryPoints"]
        .as_array()
        .unwrap()
        .iter()
        .any(|p| p == "README.md"));
}

#[test]
fn markdown_links_and_wikilinks_become_edges_but_code_fences_do_not() {
    let dir = tempfile::tempdir().unwrap();
    notes_folder(dir.path());
    build(dir.path(), &options()).unwrap();
    let cache = cache(dir.path());

    assert!(has_edge(&cache, "notes/meeting.md", "notes/plan.md"));
    assert!(has_edge(&cache, "notes/meeting.md", "wiki/Glossary.md"));
    assert!(!cache["edges"]
        .as_array()
        .unwrap()
        .iter()
        .any(|e| e["to"].as_str().unwrap().contains("nowhere")));
    assert_eq!(file(&cache, "notes/plan.md")["importedBy"], 1);
}

#[test]
fn document_queries_find_notes_by_heading_and_follow_links() {
    let dir = tempfile::tempdir().unwrap();
    notes_folder(dir.path());
    build(dir.path(), &options()).unwrap();

    let context = mtui::understand::query_context(dir.path(), "hiring risks decisions", 5).unwrap();
    assert!(!context.stale);
    assert_eq!(context.candidates[0].path, "notes/meeting.md");
}

#[test]
fn stray_text_and_csv_files_in_a_code_project_are_not_indexed() {
    let dir = tempfile::tempdir().unwrap();
    for index in 0..6 {
        write(
            dir.path(),
            &format!("src/mod{index}.ts"),
            "export const value = 1;\n",
        );
    }
    write(dir.path(), "requirements.txt", "requests==2.0\n");
    write(dir.path(), "fixtures/data.csv", "a,b\n1,2\n");
    write(dir.path(), "docs/guide.md", "# Guide\n\nHow it works.\n");

    let result = build(dir.path(), &options()).unwrap();
    assert_eq!(result.kind, "code");
    let cache = cache(dir.path());
    let paths: Vec<&str> = cache["files"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["path"].as_str().unwrap())
        .collect();
    assert!(paths.contains(&"docs/guide.md"));
    assert!(!paths.contains(&"requirements.txt"));
    assert!(!paths.contains(&"fixtures/data.csv"));
}

#[test]
fn an_empty_or_headerless_table_does_not_break_the_build() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "empty.csv", "\n\n");
    write(dir.path(), "single.csv", "only,header\n");
    write(dir.path(), "note.txt", "");
    build(dir.path(), &options()).unwrap();
    let cache = cache(dir.path());
    assert_eq!(file(&cache, "empty.csv")["summary"], "Empty table.");
    assert_eq!(
        file(&cache, "single.csv")["summary"],
        "Table with 2 column(s) (only, header) and 0 row(s)."
    );
}
