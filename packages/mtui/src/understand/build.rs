//! Self-contained Understand/codegraph builder.
//!
//! `mtui understand build` produces the same `summary.json` that the query
//! commands (`map`, `context`, `summary`, `info`) read, so MTUI no longer
//! depends on the IDE having built the graph. The pass is deterministic and
//! offline: file walking, language detection, symbol scan, import edges,
//! architectural layer, module grouping and static summaries. Semantic
//! summaries written earlier by another builder are preserved for files whose
//! content fingerprint has not changed.

use super::{docs, fingerprint_of, is_code_like_file, language_for_path, storage};
use crate::error::MtuiError;
use regex::Regex;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_FILE_BYTES: u64 = 1_000_000;
const MAX_SYMBOLS_PER_FILE: usize = 40;
const MIN_MODULE_FILES: usize = 3;
/// Entries the walker may visit before the scan stops, so a huge tree with few
/// code files cannot run for minutes.
const MAX_VISITED_ENTRIES: usize = 300_000;
const STATIC_SOURCE: &str = "mtui-static";
const SKIP_DIRS: &[&str] = &[
    ".git",
    ".mtui",
    ".tomni",
    ".omni",
    ".tomny",
    ".tmp",
    ".claude",
    ".next",
    ".turbo",
    "node_modules",
    "target",
    "dist",
    "build",
    "coverage",
    "out",
    "vendor",
    "__pycache__",
    "venv",
];
const SKIP_FILES: &[&str] = &["package-lock.json", "npm-shrinkwrap.json"];

pub struct BuildOptions {
    /// Discard preserved semantic summaries and rebuild every entry statically.
    pub full: bool,
    /// Stop scanning after this many files and mark the result truncated.
    pub max_files: usize,
    /// Extra glob patterns (project-relative) that must not be indexed.
    pub ignore_patterns: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct BuildResult {
    pub command: String,
    pub mode: String,
    /// `code` or `docs`: how the folder was classified and therefore which files were indexed.
    pub kind: String,
    pub path: String,
    pub built_at: u64,
    pub file_count: usize,
    pub module_count: usize,
    pub edge_count: usize,
    pub added_count: usize,
    pub changed_count: usize,
    pub removed_count: usize,
    pub preserved_summary_count: usize,
    pub skipped_count: usize,
    pub truncated: bool,
}

#[derive(Debug, Serialize)]
pub struct StatusResult {
    pub command: String,
    pub exists: bool,
    pub path: String,
    pub built_at: Option<u64>,
    pub builder: Option<String>,
    pub file_count: usize,
    pub module_count: usize,
    pub edge_count: usize,
    pub stale_marker_paths: usize,
    pub full_rebuild_required: bool,
    pub recommendation: String,
}

struct SourceFile {
    path: String,
    content: String,
    language: &'static str,
    fingerprint: String,
}

struct Node {
    path: String,
    label: String,
    group: String,
    layer: &'static str,
    language: &'static str,
    fingerprint: String,
    symbols: Vec<Value>,
    doc: Option<String>,
    summary: String,
    summary_source: String,
}

struct Patterns {
    ts_symbols: Vec<(Regex, &'static str)>,
    rust_symbols: Vec<(Regex, &'static str)>,
    py_symbols: Vec<(Regex, &'static str)>,
    go_symbols: Vec<(Regex, &'static str)>,
    js_import: Regex,
    js_require: Regex,
    rust_mod: Regex,
    rust_use: Regex,
    py_from: Regex,
    py_import: Regex,
    layer_test_name: Regex,
    layer_test_word: Regex,
    layer_config_ext: Regex,
    layer_config_rc: Regex,
    layer_config_word: Regex,
    layer_api: Regex,
    layer_data: Regex,
    layer_service: Regex,
    layer_ui: Regex,
    layer_util: Regex,
}

fn re(pattern: &str) -> Regex {
    Regex::new(pattern).expect("static regex is valid")
}

impl Patterns {
    fn new() -> Self {
        Patterns {
            ts_symbols: vec![
                (
                    re(
                        r"^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)",
                    ),
                    "function",
                ),
                (
                    re(
                        r"^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)",
                    ),
                    "class",
                ),
                (
                    re(r"^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)"),
                    "interface",
                ),
                (
                    re(r"^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*[=<]"),
                    "type",
                ),
                (
                    re(r"^\s*(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)"),
                    "enum",
                ),
                (
                    re(r"^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)"),
                    "const",
                ),
            ],
            rust_symbols: vec![
                (
                    re(
                        r"^\s*(?:pub(?:\([^)]*\))?\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+(\w+)",
                    ),
                    "function",
                ),
                (re(r"^\s*(?:pub(?:\([^)]*\))?\s+)?struct\s+(\w+)"), "class"),
                (re(r"^\s*(?:pub(?:\([^)]*\))?\s+)?enum\s+(\w+)"), "enum"),
                (
                    re(r"^\s*(?:pub(?:\([^)]*\))?\s+)?trait\s+(\w+)"),
                    "interface",
                ),
                (re(r"^\s*(?:pub(?:\([^)]*\))?\s+)?type\s+(\w+)"), "type"),
                (
                    re(r"^\s*(?:pub(?:\([^)]*\))?\s+)?(?:const|static)\s+(\w+)"),
                    "constant",
                ),
            ],
            py_symbols: vec![
                (re(r"^\s*(?:async\s+)?def\s+(\w+)"), "function"),
                (re(r"^\s*class\s+(\w+)"), "class"),
            ],
            go_symbols: vec![
                (re(r"^func\s+(?:\([^)]*\)\s*)?(\w+)"), "function"),
                (re(r"^type\s+(\w+)\s+(?:struct|interface)"), "class"),
            ],
            js_import: re(
                r#"(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]"#,
            ),
            js_require: re(r#"(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)"#),
            rust_mod: re(r"(?m)^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;"),
            rust_use: re(r"(?m)^\s*(?:pub(?:\([^)]*\))?\s+)?use\s+crate::([\w:]+)"),
            py_from: re(r"(?m)^\s*from\s+(\.*)([\w.]*)\s+import\s+"),
            py_import: re(r"(?m)^\s*import\s+([\w.]+)"),
            layer_test_name: re(r"\.(test|spec)\.[a-z0-9]+$"),
            layer_test_word: re(r"(?:^|[^a-z])(test|spec)(?:[^a-z]|$)"),
            layer_config_ext: re(r"\.config\.[a-z0-9]+$"),
            layer_config_rc: re(r"^\..*rc(\.[a-z]+)?$"),
            layer_config_word: re(
                r"(tsconfig|webpack|vite\.config|rollup|babel|eslint|prettier|jest|vitest)",
            ),
            layer_api: re(r"(?:^|[^a-z])(api|route|router|controller|endpoint|handler)"),
            layer_data: re(r"(?:^|[^a-z])(model|schema|entity|repository|repo|store|dao)"),
            layer_service: re(
                r"(?:^|[^a-z])(service|usecase|use-case|manager|provider|logic|domain)",
            ),
            layer_ui: re(r"(?:^|[^a-z])(component|page|view|screen|widget|layout)"),
            layer_util: re(r"(?:^|[^a-z])(util|helper|format)"),
        }
    }

    /// Heuristic architectural layer, most specific first (same order as the IDE builder).
    fn infer_layer(&self, rel: &str) -> &'static str {
        let p = rel.replace('\\', "/").to_lowercase();
        let base = p.rsplit('/').next().unwrap_or(&p).to_string();
        let segs: Vec<&str> = p.split('/').collect();
        let has = |names: &[&str]| names.iter().any(|name| segs.contains(name));

        if self.layer_test_name.is_match(&base)
            || self.layer_test_word.is_match(&base)
            || has(&["test", "tests", "__tests__", "spec", "__mocks__"])
        {
            return "test";
        }
        if self.layer_config_ext.is_match(&base)
            || self.layer_config_rc.is_match(&base)
            || self.layer_config_word.is_match(&base)
            || has(&["config", "configs"])
        {
            return "config";
        }
        if self.layer_api.is_match(&base)
            || has(&["bridge", "bridges", "preload"])
            || has(&[
                "api",
                "apis",
                "routes",
                "route",
                "controllers",
                "endpoints",
                "handlers",
            ])
        {
            return "api";
        }
        if self.layer_data.is_match(&base)
            || has(&[
                "db",
                "database",
                "models",
                "model",
                "stores",
                "store",
                "repository",
                "repositories",
                "entities",
                "schema",
                "schemas",
                "dao",
                "migrations",
            ])
        {
            return "data";
        }
        if self.layer_service.is_match(&base)
            || has(&[
                "process",
                "services",
                "service",
                "usecases",
                "use-cases",
                "managers",
                "providers",
                "logic",
                "domain",
            ])
        {
            return "service";
        }
        if base.ends_with(".tsx")
            || base.ends_with(".jsx")
            || self.layer_ui.is_match(&base)
            || has(&[
                "renderer",
                "components",
                "component",
                "pages",
                "page",
                "views",
                "view",
                "ui",
                "screens",
                "widgets",
                "layouts",
            ])
        {
            return "ui";
        }
        if self.layer_util.is_match(&base)
            || has(&[
                "utils", "util", "helpers", "helper", "lib", "libs", "common", "shared", "types",
            ])
        {
            return "util";
        }
        "unknown"
    }

    fn scan_symbols(&self, language: &str, path: &str, text: &str) -> Vec<Value> {
        let rules = match language {
            "typescript" | "javascript" => &self.ts_symbols,
            "rust" => &self.rust_symbols,
            "python" => &self.py_symbols,
            "go" => &self.go_symbols,
            _ => return Vec::new(),
        };
        let jsx = path.ends_with(".tsx") || path.ends_with(".jsx");
        let mut symbols = Vec::new();
        for (index, line) in text.lines().enumerate() {
            if line.len() > 400 {
                continue;
            }
            for (rule, kind) in rules {
                let Some(captures) = rule.captures(line) else {
                    continue;
                };
                let name = captures.get(1).map(|m| m.as_str()).unwrap_or_default();
                if name.is_empty() {
                    continue;
                }
                let upper = name.chars().next().is_some_and(|c| c.is_ascii_uppercase());
                let kind = match *kind {
                    "const" => {
                        if line.contains("=>") || line.contains("function") {
                            if jsx && upper {
                                "component"
                            } else {
                                "function"
                            }
                        } else {
                            "constant"
                        }
                    }
                    "function" if jsx && upper => "component",
                    "function" if language == "python" && line.starts_with(char::is_whitespace) => {
                        "method"
                    }
                    other => other,
                };
                symbols.push(json!({ "name": name, "kind": kind, "line": index + 1 }));
                break;
            }
            if symbols.len() >= MAX_SYMBOLS_PER_FILE {
                break;
            }
        }
        symbols
    }
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn internal(message: impl Into<String>) -> MtuiError {
    MtuiError::Internal {
        message: message.into(),
    }
}

fn parent_dir(path: &str) -> String {
    match path.rfind('/') {
        Some(index) => path[..index].to_string(),
        None => ".".to_string(),
    }
}

fn depth(dir: &str) -> usize {
    if dir == "." {
        0
    } else {
        dir.matches('/').count() + 1
    }
}

/// Collapse `.` and `..` segments of a forward-slash relative path.
fn normalize_path(path: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for segment in path.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            other => parts.push(other),
        }
    }
    parts.join("/")
}

fn join_path(dir: &str, rest: &str) -> String {
    if dir == "." || dir.is_empty() {
        normalize_path(rest)
    } else {
        normalize_path(&format!("{dir}/{rest}"))
    }
}

/// Languages that make a folder a code project when they dominate.
const CODE_LANGUAGES: [&str; 9] = [
    "typescript",
    "javascript",
    "rust",
    "python",
    "go",
    "java",
    "kotlin",
    "swift",
    "cpp",
];

fn extension_of(path: &Path) -> String {
    path.extension()
        .map(|ext| ext.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

/// `.txt`, `.csv`, `.rst`, `.adoc`: indexed only for document-oriented folders.
fn is_doc_extra(path: &Path) -> bool {
    docs::language_for_extra_extension(&extension_of(path)).is_some()
}

fn language_of(path: &Path) -> &'static str {
    docs::language_for_extra_extension(&extension_of(path))
        .unwrap_or_else(|| language_for_path(path))
}

/// A folder is document-oriented when documents and tables make up most of what is indexed.
fn detect_kind(sources: &[SourceFile]) -> &'static str {
    let code = sources
        .iter()
        .filter(|source| CODE_LANGUAGES.contains(&source.language))
        .count();
    let documents = sources
        .iter()
        .filter(|source| docs::is_doc_language(source.language))
        .count();
    if documents > 0 && documents * 10 >= (documents + code) * 6 {
        "docs"
    } else {
        "code"
    }
}

fn collect_files(
    root: &Path,
    options: &BuildOptions,
) -> Result<(Vec<SourceFile>, usize, bool), MtuiError> {
    let ignore_globs: Vec<glob::Pattern> = options
        .ignore_patterns
        .iter()
        .filter_map(|pattern| glob::Pattern::new(pattern).ok())
        .collect();
    let walker = ignore::WalkBuilder::new(root)
        .hidden(true)
        .git_ignore(true)
        .git_global(false)
        .git_exclude(true)
        .require_git(false)
        .sort_by_file_path(|a, b| a.cmp(b))
        .filter_entry(|entry| {
            if entry.depth() == 0 {
                return true;
            }
            let is_dir = entry.file_type().is_some_and(|kind| kind.is_dir());
            !(is_dir && SKIP_DIRS.contains(&entry.file_name().to_string_lossy().as_ref()))
        })
        .build();

    let mut files = Vec::new();
    let mut skipped = 0usize;
    let mut truncated = false;
    let mut visited = 0usize;
    for entry in walker {
        visited += 1;
        if visited > MAX_VISITED_ENTRIES {
            truncated = true;
            break;
        }
        let Ok(entry) = entry else {
            skipped += 1;
            continue;
        };
        if !entry.file_type().is_some_and(|kind| kind.is_file()) {
            continue;
        }
        let path = entry.path();
        let Ok(relative) = path.strip_prefix(root) else {
            continue;
        };
        let rel = relative.to_string_lossy().replace('\\', "/");
        let name = rel.rsplit('/').next().unwrap_or(&rel);
        if !(is_code_like_file(path) || is_doc_extra(path))
            || SKIP_FILES.contains(&name)
            || name.ends_with(".min.js")
            || ignore_globs.iter().any(|glob| glob.matches(&rel))
        {
            continue;
        }
        if files.len() >= options.max_files {
            truncated = true;
            break;
        }
        let too_large = entry
            .metadata()
            .map(|meta| meta.len() > MAX_FILE_BYTES)
            .unwrap_or(true);
        if too_large {
            skipped += 1;
            continue;
        }
        let Ok(content) = std::fs::read_to_string(path) else {
            skipped += 1;
            continue;
        };
        let content = content.trim_start_matches('\u{feff}').to_string();
        files.push(SourceFile {
            language: language_of(path),
            fingerprint: fingerprint_of(&content),
            path: rel,
            content,
        });
    }
    Ok((files, skipped, truncated))
}

fn usable_doc_line(body: &str) -> Option<String> {
    let body = body.trim().trim_start_matches(['*', '!', '/', '#']).trim();
    let lower = body.to_lowercase();
    if body.is_empty()
        || body.starts_with('@')
        || lower.contains("copyright")
        || lower.contains("spdx")
        || lower.contains("@license")
    {
        return None;
    }
    let mut text: String = body.chars().take(160).collect();
    if let Some(end) = text.find(". ") {
        text.truncate(end + 1);
    }
    Some(text)
}

/// First meaningful leading comment (or Markdown heading) of a file.
fn leading_doc(language: &str, text: &str) -> Option<String> {
    if language == "markdown" {
        return text
            .lines()
            .take(30)
            .find_map(|line| line.trim().strip_prefix('#').and_then(usable_doc_line));
    }
    let mut in_block = false;
    let mut block_is_license = false;
    for line in text.lines().take(60) {
        let t = line.trim();
        if t.is_empty() {
            continue;
        }
        if in_block || t.starts_with("/*") {
            if !in_block {
                in_block = true;
                block_is_license = false;
            }
            let lower = t.to_lowercase();
            if lower.contains("@license") || lower.contains("copyright") || lower.contains("spdx") {
                block_is_license = true;
            }
            let ends = t.contains("*/");
            let body = t.trim_start_matches("/**").trim_start_matches("/*");
            let body = body.trim_end_matches("*/");
            if !block_is_license {
                if let Some(doc) = usable_doc_line(body) {
                    return Some(doc);
                }
            }
            if ends {
                in_block = false;
            }
            continue;
        }
        if t.starts_with("//") || (t.starts_with('#') && !t.starts_with("#!")) {
            if let Some(doc) = usable_doc_line(t) {
                return Some(doc);
            }
            continue;
        }
        if t.starts_with("\"\"\"") || t.starts_with("'''") {
            return usable_doc_line(t.trim_matches(|c| c == '"' || c == '\''));
        }
        if t.starts_with("#!") || t.starts_with("'use ") || t.starts_with("\"use ") {
            continue;
        }
        break;
    }
    None
}

fn prominent_names(symbols: &[Value]) -> (Vec<String>, usize) {
    const ORDER: [&str; 8] = [
        "component",
        "class",
        "function",
        "interface",
        "type",
        "enum",
        "method",
        "constant",
    ];
    let mut names = Vec::new();
    for kind in ORDER {
        for symbol in symbols {
            if symbol.get("kind").and_then(Value::as_str) == Some(kind) {
                if let Some(name) = symbol.get("name").and_then(Value::as_str) {
                    if !names.iter().any(|existing| existing == name) {
                        names.push(name.to_string());
                    }
                }
            }
        }
    }
    let total = names.len();
    names.truncate(5);
    let more = total.saturating_sub(names.len());
    (names, more)
}

fn static_summary(node: &Node, imported_by: usize) -> String {
    if let Some(doc) = &node.doc {
        return doc.clone();
    }
    let (names, more) = prominent_names(&node.symbols);
    let mut text = format!("{} {} file `{}`", node.layer, node.language, node.label);
    if !names.is_empty() {
        text.push_str(&format!(" declaring {}", names.join(", ")));
        if more > 0 {
            text.push_str(&format!(" (+{more} more)"));
        }
    }
    if imported_by > 0 {
        text.push_str(&format!("; imported by {imported_by} file(s)"));
    }
    text.push('.');
    text
}

// ---------------------------------------------------------------------------
// Import graph
// ---------------------------------------------------------------------------

struct PathAliases {
    base_url: String,
    rules: Vec<(String, Vec<String>)>,
}

fn strip_json_comments(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    let mut in_string = false;
    while let Some(c) = chars.next() {
        if in_string {
            out.push(c);
            if c == '\\' {
                if let Some(next) = chars.next() {
                    out.push(next);
                }
            } else if c == '"' {
                in_string = false;
            }
            continue;
        }
        match c {
            '"' => {
                in_string = true;
                out.push(c);
            }
            '/' if chars.peek() == Some(&'/') => {
                for next in chars.by_ref() {
                    if next == '\n' {
                        out.push('\n');
                        break;
                    }
                }
            }
            '/' if chars.peek() == Some(&'*') => {
                chars.next();
                let mut prev = '\0';
                for next in chars.by_ref() {
                    if prev == '*' && next == '/' {
                        break;
                    }
                    prev = next;
                }
            }
            _ => out.push(c),
        }
    }
    out
}

fn load_path_aliases(root: &Path) -> PathAliases {
    let empty = PathAliases {
        base_url: ".".to_string(),
        rules: Vec::new(),
    };
    let Ok(text) = std::fs::read_to_string(root.join("tsconfig.json")) else {
        return empty;
    };
    let stripped = strip_json_comments(text.trim_start_matches('\u{feff}'));
    let trailing_comma = re(r",\s*([}\]])");
    let cleaned = trailing_comma.replace_all(&stripped, "$1");
    let Ok(json) = serde_json::from_str::<Value>(&cleaned) else {
        return empty;
    };
    let options = json.get("compilerOptions");
    let base_url = options
        .and_then(|o| o.get("baseUrl"))
        .and_then(Value::as_str)
        .map(normalize_path)
        .filter(|b| !b.is_empty())
        .unwrap_or_else(|| ".".to_string());
    let rules = options
        .and_then(|o| o.get("paths"))
        .and_then(Value::as_object)
        .map(|paths| {
            paths
                .iter()
                .map(|(pattern, targets)| {
                    let targets = targets
                        .as_array()
                        .map(|items| {
                            items
                                .iter()
                                .filter_map(|item| item.as_str().map(str::to_string))
                                .collect()
                        })
                        .unwrap_or_default();
                    (pattern.clone(), targets)
                })
                .collect()
        })
        .unwrap_or_default();
    PathAliases { base_url, rules }
}

fn resolve_script_file(candidate: &str, files: &HashSet<String>) -> Option<String> {
    for ext in ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"] {
        let path = format!("{candidate}{ext}");
        if files.contains(&path) {
            return Some(path);
        }
    }
    for js_ext in [".js", ".jsx", ".mjs"] {
        if let Some(stem) = candidate.strip_suffix(js_ext) {
            for ts_ext in [".ts", ".tsx"] {
                let path = format!("{stem}{ts_ext}");
                if files.contains(&path) {
                    return Some(path);
                }
            }
        }
    }
    for ext in ["ts", "tsx", "js", "jsx"] {
        let path = format!("{candidate}/index.{ext}");
        if files.contains(&path) {
            return Some(path);
        }
    }
    None
}

fn resolve_script_import(
    from: &str,
    spec: &str,
    aliases: &PathAliases,
    files: &HashSet<String>,
) -> Option<String> {
    if spec.starts_with("./") || spec.starts_with("../") {
        return resolve_script_file(&join_path(&parent_dir(from), spec), files);
    }
    for (pattern, targets) in &aliases.rules {
        let star = match pattern.split_once('*') {
            Some((prefix, suffix)) => {
                if spec.len() >= prefix.len() + suffix.len()
                    && spec.starts_with(prefix)
                    && spec.ends_with(suffix)
                {
                    Some(&spec[prefix.len()..spec.len() - suffix.len()])
                } else {
                    continue;
                }
            }
            None => {
                if spec == pattern {
                    None
                } else {
                    continue;
                }
            }
        };
        for target in targets {
            let substituted = match star {
                Some(value) => target.replace('*', value),
                None => target.clone(),
            };
            if let Some(found) =
                resolve_script_file(&join_path(&aliases.base_url, &substituted), files)
            {
                return Some(found);
            }
        }
    }
    None
}

fn rust_module_dir(from: &str) -> String {
    let stem = from
        .rsplit('/')
        .next()
        .and_then(|name| name.strip_suffix(".rs"))
        .unwrap_or_default();
    let dir = parent_dir(from);
    if matches!(stem, "mod" | "main" | "lib") {
        dir
    } else {
        join_path(&dir, stem)
    }
}

fn rust_crate_root(from: &str) -> Option<String> {
    let segments: Vec<&str> = from.split('/').collect();
    let index = segments.iter().rposition(|segment| *segment == "src")?;
    Some(segments[..=index].join("/"))
}

/// Resolve Markdown links and `[[wikilinks]]` to indexed files.
fn resolve_doc_links(
    file: &SourceFile,
    links: &docs::DocLinks,
    files: &HashSet<String>,
    stems: &HashMap<String, Vec<String>>,
) -> BTreeSet<String> {
    let dir = parent_dir(&file.path);
    let mut targets = BTreeSet::new();
    for raw in &links.paths {
        let base = match raw.strip_prefix('/') {
            Some(rooted) => normalize_path(rooted),
            None => join_path(&dir, raw),
        };
        let candidates = [
            base.clone(),
            format!("{base}.md"),
            format!("{base}/README.md"),
            format!("{base}/index.md"),
        ];
        if let Some(hit) = candidates
            .into_iter()
            .find(|candidate| files.contains(candidate))
        {
            targets.insert(hit);
        }
    }
    for name in &links.wikilinks {
        let stem = name
            .rsplit('/')
            .next()
            .unwrap_or(name)
            .trim_end_matches(".md")
            .to_lowercase();
        if let Some(paths) = stems.get(&stem) {
            let pick = paths
                .iter()
                .find(|path| parent_dir(path) == dir)
                .or_else(|| paths.first());
            if let Some(pick) = pick {
                targets.insert(pick.clone());
            }
        }
    }
    targets
}

fn extract_edges(
    patterns: &Patterns,
    doc_patterns: &docs::DocPatterns,
    stems: &HashMap<String, Vec<String>>,
    aliases: &PathAliases,
    file: &SourceFile,
    files: &HashSet<String>,
) -> BTreeSet<String> {
    let mut targets = BTreeSet::new();
    match file.language {
        "typescript" | "javascript" => {
            for regex in [&patterns.js_import, &patterns.js_require] {
                for captures in regex.captures_iter(&file.content) {
                    if let Some(spec) = captures.get(1) {
                        if let Some(target) =
                            resolve_script_import(&file.path, spec.as_str(), aliases, files)
                        {
                            targets.insert(target);
                        }
                    }
                }
            }
        }
        "rust" => {
            let module_dir = rust_module_dir(&file.path);
            for captures in patterns.rust_mod.captures_iter(&file.content) {
                let name = &captures[1];
                for candidate in [
                    format!("{}/{name}.rs", module_dir),
                    format!("{}/{name}/mod.rs", module_dir),
                ] {
                    let candidate = normalize_path(&candidate);
                    if files.contains(&candidate) {
                        targets.insert(candidate);
                        break;
                    }
                }
            }
            if let Some(crate_root) = rust_crate_root(&file.path) {
                for captures in patterns.rust_use.captures_iter(&file.content) {
                    let segments: Vec<&str> = captures[1]
                        .split("::")
                        .filter(|segment| !segment.is_empty())
                        .collect();
                    for take in (1..=segments.len()).rev() {
                        let base = format!("{crate_root}/{}", segments[..take].join("/"));
                        let hit = [format!("{base}.rs"), format!("{base}/mod.rs")]
                            .into_iter()
                            .find(|candidate| files.contains(candidate));
                        if let Some(hit) = hit {
                            targets.insert(hit);
                            break;
                        }
                    }
                }
            }
        }
        "python" => {
            let dir = parent_dir(&file.path);
            for captures in patterns.py_from.captures_iter(&file.content) {
                let dots = captures[1].len();
                let module = captures[2].replace('.', "/");
                if module.is_empty() {
                    continue;
                }
                let bases: Vec<String> = if dots > 0 {
                    let mut base = dir.clone();
                    for _ in 1..dots {
                        base = parent_dir(&base);
                    }
                    vec![join_path(&base, &module)]
                } else {
                    vec![normalize_path(&module), join_path(&dir, &module)]
                };
                for base in bases {
                    let hit = [format!("{base}.py"), format!("{base}/__init__.py")]
                        .into_iter()
                        .find(|candidate| files.contains(candidate));
                    if let Some(hit) = hit {
                        targets.insert(hit);
                        break;
                    }
                }
            }
            for captures in patterns.py_import.captures_iter(&file.content) {
                let module = captures[1].replace('.', "/");
                for base in [normalize_path(&module), join_path(&dir, &module)] {
                    let hit = [format!("{base}.py"), format!("{base}/__init__.py")]
                        .into_iter()
                        .find(|candidate| files.contains(candidate));
                    if let Some(hit) = hit {
                        targets.insert(hit);
                        break;
                    }
                }
            }
        }
        "markdown" => {
            let links = doc_patterns.links(&file.content);
            targets.extend(resolve_doc_links(file, &links, files, stems));
        }
        _ => {}
    }
    targets.remove(&file.path);
    targets
}

// ---------------------------------------------------------------------------
// Modules and overview
// ---------------------------------------------------------------------------

fn dominant_layer(nodes: &[&Node]) -> &'static str {
    let mut counts: BTreeMap<&'static str, usize> = BTreeMap::new();
    for node in nodes {
        *counts.entry(node.layer).or_default() += 1;
    }
    counts
        .into_iter()
        .max_by(|a, b| a.1.cmp(&b.1).then(b.0.cmp(a.0)))
        .map(|(layer, _)| layer)
        .unwrap_or("unknown")
}

fn build_modules(
    nodes: &[Node],
    imported_by: &HashMap<String, usize>,
    edges: &BTreeSet<(String, String)>,
    previous: &HashMap<String, Value>,
) -> Vec<Value> {
    let mut buckets: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for (index, node) in nodes.iter().enumerate() {
        buckets
            .entry(parent_dir(&node.path))
            .or_default()
            .push(index);
    }
    let max_depth = buckets.keys().map(|dir| depth(dir)).max().unwrap_or(0);
    for level in (1..=max_depth).rev() {
        let at_level: Vec<String> = buckets
            .keys()
            .filter(|dir| depth(dir) == level)
            .cloned()
            .collect();
        for dir in at_level {
            if buckets.get(&dir).map_or(0, Vec::len) < MIN_MODULE_FILES {
                let moved = buckets.remove(&dir).unwrap_or_default();
                buckets.entry(parent_dir(&dir)).or_default().extend(moved);
            }
        }
    }

    let module_ids: BTreeSet<String> = buckets.keys().cloned().collect();
    let mut module_of_file: HashMap<&str, &str> = HashMap::new();
    for (dir, indices) in &buckets {
        for index in indices {
            module_of_file.insert(nodes[*index].path.as_str(), dir.as_str());
        }
    }
    let nearest_parent = |dir: &str| -> Option<String> {
        let mut current = dir.to_string();
        while current != "." {
            current = parent_dir(&current);
            if module_ids.contains(&current) {
                return Some(current);
            }
        }
        None
    };
    let mut children: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for id in &module_ids {
        if let Some(parent) = nearest_parent(id) {
            children.entry(parent).or_default().push(id.clone());
        }
    }
    let mut relations: HashMap<&str, HashMap<&str, usize>> = HashMap::new();
    for (from, to) in edges {
        let (Some(a), Some(b)) = (
            module_of_file.get(from.as_str()),
            module_of_file.get(to.as_str()),
        ) else {
            continue;
        };
        if a != b {
            *relations.entry(a).or_default().entry(b).or_default() += 1;
            *relations.entry(b).or_default().entry(a).or_default() += 1;
        }
    }

    let mut modules = Vec::new();
    for (dir, indices) in &buckets {
        let members: Vec<&Node> = indices.iter().map(|i| &nodes[*i]).collect();
        let mut paths: Vec<String> = members.iter().map(|n| n.path.clone()).collect();
        paths.sort();
        let fingerprint_source = members
            .iter()
            .map(|n| format!("{}:{}", n.path, n.fingerprint))
            .collect::<Vec<_>>()
            .join("\n");
        let fingerprint = fingerprint_of(&fingerprint_source);
        let mut ranked: Vec<&&Node> = members.iter().collect();
        ranked.sort_by(|a, b| {
            imported_by
                .get(&b.path)
                .unwrap_or(&0)
                .cmp(imported_by.get(&a.path).unwrap_or(&0))
                .then(a.path.cmp(&b.path))
        });
        let entry_files: Vec<String> = ranked.iter().take(3).map(|n| n.path.clone()).collect();
        let layer = dominant_layer(&members);
        let label = if dir == "." {
            "root".to_string()
        } else {
            dir.rsplit('/').next().unwrap_or(dir).to_string()
        };
        let kept = previous
            .get(dir)
            .filter(|old| old.get("fingerprint").and_then(Value::as_str) == Some(&fingerprint))
            .and_then(|old| old.get("summary").and_then(Value::as_str))
            .filter(|summary| !summary.is_empty())
            .map(str::to_string);
        let summary = kept.unwrap_or_else(|| {
            format!(
                "{} file(s), mostly {} layer; key files: {}.",
                members.len(),
                layer,
                entry_files
                    .iter()
                    .map(|p| p.rsplit('/').next().unwrap_or(p))
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        });
        let mut related: Vec<(&&str, &usize)> = relations
            .get(dir.as_str())
            .map(|m| m.iter().collect())
            .unwrap_or_default();
        related.sort_by(|a, b| b.1.cmp(a.1).then(a.0.cmp(b.0)));
        let related: Vec<String> = related
            .iter()
            .take(5)
            .map(|(id, _)| id.to_string())
            .collect();
        modules.push(json!({
            "id": dir,
            "label": label,
            "layer": layer,
            "summary": summary,
            "fingerprint": fingerprint,
            "fileCount": members.len(),
            "files": paths,
            "parentId": nearest_parent(dir),
            "childModuleIds": children.get(dir).cloned().unwrap_or_default(),
            "relatedModuleIds": related,
            "entryFiles": entry_files,
        }));
    }
    modules
}

fn read_json(path: &Path) -> Option<Value> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()
}

fn build_overview(root: &Path, nodes: &[Node], module_count: usize, kind: &str) -> Value {
    let package = read_json(&root.join("package.json"));
    let name = package
        .as_ref()
        .and_then(|p| p.get("name").and_then(Value::as_str))
        .map(str::to_string)
        .or_else(|| root.file_name().map(|n| n.to_string_lossy().to_string()))
        .unwrap_or_else(|| "project".to_string());
    let readme = ["README.md", "readme.md"]
        .iter()
        .find_map(|file| std::fs::read_to_string(root.join(file)).ok())
        .and_then(|text| {
            text.split("\n\n")
                .map(str::trim)
                .find(|block| {
                    !block.is_empty()
                        && !block.starts_with('#')
                        && !block.starts_with('<')
                        && !block.starts_with('[')
                        && !block.starts_with('!')
                })
                .map(|block| block.chars().take(240).collect::<String>())
        });
    let description = package
        .as_ref()
        .and_then(|p| p.get("description").and_then(Value::as_str))
        .filter(|d| !d.is_empty())
        .map(str::to_string)
        .or(readme)
        .unwrap_or_else(|| {
            if kind == "docs" {
                let tables = nodes.iter().filter(|node| node.language == "csv").count();
                format!(
                    "{name}: {} document(s) and {tables} table(s) in {module_count} folder group(s).",
                    nodes.len() - tables
                )
            } else {
                format!("{name}: {} files in {module_count} modules.", nodes.len())
            }
        });

    let mut technologies: Vec<String> = Vec::new();
    if let Some(package) = &package {
        const KNOWN: [(&str, &str); 14] = [
            ("electron", "Electron"),
            ("react", "React"),
            ("vue", "Vue"),
            ("svelte", "Svelte"),
            ("next", "Next.js"),
            ("express", "Express"),
            ("vite", "Vite"),
            ("vitest", "Vitest"),
            ("@playwright/test", "Playwright"),
            ("typescript", "TypeScript"),
            ("unocss", "UnoCSS"),
            ("tailwindcss", "Tailwind CSS"),
            ("prisma", "Prisma"),
            ("better-sqlite3", "SQLite"),
        ];
        for (dependency, label) in KNOWN {
            let present = ["dependencies", "devDependencies"].iter().any(|section| {
                package
                    .get(section)
                    .and_then(Value::as_object)
                    .is_some_and(|deps| deps.contains_key(dependency))
            });
            if present {
                technologies.push(label.to_string());
            }
        }
    }
    if root.join("Cargo.toml").is_file() {
        technologies.push("Rust".to_string());
    }
    let mut language_counts: BTreeMap<&str, usize> = BTreeMap::new();
    for node in nodes {
        if matches!(
            node.language,
            "typescript"
                | "javascript"
                | "rust"
                | "python"
                | "go"
                | "java"
                | "kotlin"
                | "swift"
                | "cpp"
        ) {
            *language_counts.entry(node.language).or_default() += 1;
        }
    }
    let mut languages: Vec<(&str, usize)> = language_counts.into_iter().collect();
    languages.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)));
    for (language, _) in languages.into_iter().take(3) {
        let label = match language {
            "typescript" => "TypeScript",
            "javascript" => "JavaScript",
            "rust" => "Rust",
            "python" => "Python",
            other => other,
        };
        if !technologies.iter().any(|t| t == label) {
            technologies.push(label.to_string());
        }
    }

    let known: HashSet<&str> = nodes.iter().map(|n| n.path.as_str()).collect();
    let mut entry_points: Vec<String> = Vec::new();
    if let Some(package) = &package {
        if let Some(main) = package.get("main").and_then(Value::as_str) {
            entry_points.push(main.trim_start_matches("./").to_string());
        }
    }
    for candidate in [
        "src/main.rs",
        "src/lib.rs",
        "src/index.ts",
        "src/main.ts",
        "src/index.js",
        "main.py",
        "app.py",
        "main.go",
    ] {
        if known.contains(candidate) {
            entry_points.push(candidate.to_string());
        }
    }
    if kind == "docs" {
        for candidate in ["README.md", "readme.md", "index.md", "INDEX.md"] {
            if known.contains(candidate) {
                entry_points.push(candidate.to_string());
            }
        }
    }
    json!({
        "tagline": name,
        "description": description,
        "technologies": technologies,
        "entryPoints": entry_points,
    })
}

// ---------------------------------------------------------------------------
// Stale marker handling
// ---------------------------------------------------------------------------

#[derive(Default)]
struct MarkerSnapshot {
    paths: BTreeSet<String>,
    full_rebuild_required: bool,
}

fn read_marker(root: &Path) -> MarkerSnapshot {
    let Some(json) = read_json(&storage::stale_marker_path(root)) else {
        return MarkerSnapshot::default();
    };
    MarkerSnapshot {
        paths: json
            .get("paths")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(|p| p.replace('\\', "/").trim_start_matches("./").to_string())
                    .collect()
            })
            .unwrap_or_default(),
        full_rebuild_required: json
            .get("fullRebuildRequired")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    }
}

/// Drop the stale marker entries this build covered, keeping anything MTUI
/// recorded while the scan was running.
fn settle_stale_marker(root: &Path, before: &MarkerSnapshot) {
    let marker = storage::canonical_stale_marker_path(root);
    let Some(_lock) = crate::ops::acquire_understand_stale_lock(
        root,
        crate::ops::UNDERSTAND_LOCK_STALE_AFTER,
        crate::ops::UNDERSTAND_LOCK_WAIT_TIMEOUT,
    ) else {
        return;
    };
    let current = read_marker(root);
    let new_paths: BTreeSet<String> = current.paths.difference(&before.paths).cloned().collect();
    let new_full = current.full_rebuild_required && !before.full_rebuild_required;
    if new_paths.is_empty() && !new_full {
        let _ = std::fs::remove_file(&marker);
        return;
    }
    let now = chrono::Utc::now().to_rfc3339();
    let payload = json!({
        "version": 1,
        "firstUpdatedAt": now,
        "updatedAt": now,
        "reason": "mtui_write",
        "pathCount": new_paths.len(),
        "paths": new_paths,
        "fullRebuildRequired": new_full,
    });
    if let Ok(encoded) = serde_json::to_vec_pretty(&payload) {
        let _ = crate::fs::atomic_write(&marker, &encoded);
    }
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/// A drive root or the user home directory is never a code project; indexing it would
/// walk the whole profile. MTUI resolves its root from the nearest `.git`/`.mtui`, so a stray
/// marker in a parent directory can otherwise select one of these by accident.
pub fn is_unsafe_index_root(project_root: &Path) -> bool {
    let canonical =
        std::fs::canonicalize(project_root).unwrap_or_else(|_| project_root.to_path_buf());
    if canonical.parent().is_none() {
        return true;
    }
    ["USERPROFILE", "HOME"].iter().any(|name| {
        std::env::var_os(name)
            .and_then(|home| std::fs::canonicalize(home).ok())
            .is_some_and(|home| home == canonical)
    })
}

/// Scan `project_root` and (re)write the canonical Understand summary cache.
pub fn build(project_root: &Path, options: &BuildOptions) -> Result<BuildResult, MtuiError> {
    if is_unsafe_index_root(project_root) {
        return Err(MtuiError::InvalidArgument {
            message: format!(
                "Refusing to index {}: not a project directory",
                project_root.display()
            ),
            suggestion: "Run inside a project, or create a .mtui directory in the folder to index"
                .to_string(),
        });
    }
    let snapshot_at = now_millis();
    let marker_before = read_marker(project_root);
    let summary_path = storage::canonical_understand_dir(project_root).join("summary.json");
    std::fs::create_dir_all(storage::canonical_understand_dir(project_root))
        .map_err(|e| internal(format!("Failed to create understand directory: {e}")))?;

    let previous_cache = if options.full {
        None
    } else {
        read_json(&storage::summary_path(project_root))
    };
    let previous_files: HashMap<String, Value> = previous_cache
        .as_ref()
        .and_then(|c| c.get("files").and_then(Value::as_array))
        .map(|items| {
            items
                .iter()
                .filter_map(|v| Some((v.get("path")?.as_str()?.to_string(), v.clone())))
                .collect()
        })
        .unwrap_or_default();
    let previous_modules: HashMap<String, Value> = previous_cache
        .as_ref()
        .and_then(|c| c.get("modules").and_then(Value::as_array))
        .map(|items| {
            items
                .iter()
                .filter_map(|v| Some((v.get("id")?.as_str()?.to_string(), v.clone())))
                .collect()
        })
        .unwrap_or_default();

    let (mut sources, skipped_count, truncated) = collect_files(project_root, options)?;
    let kind = detect_kind(&sources);
    if kind == "code" {
        // Stray .txt/.csv files in a code project are data, not documentation.
        sources.retain(|source| !is_doc_extra(Path::new(&source.path)));
    }
    let patterns = Patterns::new();
    let doc_patterns = docs::DocPatterns::new();
    let aliases = load_path_aliases(project_root);
    let known: HashSet<String> = sources.iter().map(|s| s.path.clone()).collect();
    let mut stems: HashMap<String, Vec<String>> = HashMap::new();
    for source in &sources {
        if docs::is_doc_language(source.language) {
            if let Some(stem) = Path::new(&source.path).file_stem() {
                stems
                    .entry(stem.to_string_lossy().to_lowercase())
                    .or_default()
                    .push(source.path.clone());
            }
        }
    }

    let mut edges: BTreeSet<(String, String)> = BTreeSet::new();
    let mut nodes: Vec<Node> = Vec::with_capacity(sources.len());
    for source in &sources {
        for target in extract_edges(&patterns, &doc_patterns, &stems, &aliases, source, &known) {
            edges.insert((source.path.clone(), target));
        }
        let label = source
            .path
            .rsplit('/')
            .next()
            .unwrap_or(&source.path)
            .to_string();
        let doc_info = docs::is_doc_language(source.language)
            .then(|| docs::analyze(source.language, &source.content));
        nodes.push(Node {
            group: source
                .path
                .split('/')
                .next()
                .unwrap_or(&source.path)
                .to_string(),
            layer: if source.language == "csv" {
                "data"
            } else {
                patterns.infer_layer(&source.path)
            },
            language: source.language,
            fingerprint: source.fingerprint.clone(),
            symbols: match &doc_info {
                Some(info) => docs::symbols(info, source.language),
                None => patterns.scan_symbols(source.language, &source.path, &source.content),
            },
            doc: match &doc_info {
                Some(info) => Some(docs::summary(info, source.language, &label)),
                None => leading_doc(source.language, &source.content),
            },
            label,
            summary: String::new(),
            summary_source: STATIC_SOURCE.to_string(),
            path: source.path.clone(),
        });
    }

    let mut imported_by: HashMap<String, usize> = HashMap::new();
    for (_, to) in &edges {
        *imported_by.entry(to.clone()).or_default() += 1;
    }

    let mut added_count = 0usize;
    let mut changed_count = 0usize;
    let mut preserved = 0usize;
    for node in &mut nodes {
        let count = imported_by.get(&node.path).copied().unwrap_or(0);
        match previous_files.get(&node.path) {
            None => added_count += 1,
            Some(old) => {
                let same =
                    old.get("fingerprint").and_then(Value::as_str) == Some(&node.fingerprint);
                let source = old
                    .get("summarySource")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let summary = old.get("summary").and_then(Value::as_str).unwrap_or("");
                if !same {
                    changed_count += 1;
                } else if !summary.is_empty() && source != STATIC_SOURCE && source != "fallback" {
                    node.summary = summary.to_string();
                    node.summary_source = source.to_string();
                    preserved += 1;
                }
            }
        }
        if node.summary.is_empty() {
            node.summary = static_summary(node, count);
        }
    }
    let current_paths: HashSet<&str> = nodes.iter().map(|n| n.path.as_str()).collect();
    let removed_count = previous_files
        .keys()
        .filter(|path| !current_paths.contains(path.as_str()))
        .count();

    let modules = build_modules(&nodes, &imported_by, &edges, &previous_modules);
    let overview = build_overview(project_root, &nodes, modules.len(), kind);
    let files_json: Vec<Value> = nodes
        .iter()
        .map(|node| {
            let first_tag = match node.language {
                "csv" => "table",
                language if docs::is_doc_language(language) => "docs",
                _ => node.layer,
            };
            let mut tags = vec![first_tag.to_string(), node.language.to_string()];
            tags.dedup();
            json!({
                "path": node.path,
                "label": node.label,
                "group": node.group,
                "layer": node.layer,
                "summary": node.summary,
                "summarySource": node.summary_source,
                "tags": tags,
                "symbols": node.symbols,
                "language": node.language,
                "importedBy": imported_by.get(&node.path).copied().unwrap_or(0),
                "fingerprint": node.fingerprint,
            })
        })
        .collect();
    let edges_json: Vec<Value> = edges
        .iter()
        .map(|(from, to)| json!({ "from": from, "to": to }))
        .collect();
    let built_at = now_millis();
    let cache = json!({
        "version": 2,
        "rootPath": project_root.to_string_lossy(),
        "graphVersion": 5,
        "kind": kind,
        "builder": "mtui",
        "builderVersion": env!("CARGO_PKG_VERSION"),
        "builtAt": built_at,
        "sourceSnapshotAt": snapshot_at,
        "overview": overview,
        "runbook": null,
        "modules": modules,
        "files": files_json,
        "edges": edges_json,
    });
    let encoded = serde_json::to_vec(&cache)
        .map_err(|e| internal(format!("Failed to encode understand cache: {e}")))?;
    crate::fs::atomic_write(&summary_path, &encoded)
        .map_err(|e| internal(format!("Failed to write understand cache: {e}")))?;
    settle_stale_marker(project_root, &marker_before);

    Ok(BuildResult {
        command: "understand build".to_string(),
        mode: if previous_cache.is_some() {
            "incremental"
        } else {
            "full"
        }
        .to_string(),
        kind: kind.to_string(),
        path: summary_path.to_string_lossy().to_string(),
        built_at,
        file_count: nodes.len(),
        module_count: modules.len(),
        edge_count: edges.len(),
        added_count,
        changed_count,
        removed_count,
        preserved_summary_count: preserved,
        skipped_count,
        truncated,
    })
}

/// Report the state of the Understand cache without modifying anything.
pub fn status(project_root: &Path) -> StatusResult {
    let path = storage::summary_path(project_root);
    let marker = read_marker(project_root);
    let cache = read_json(&path);
    let count = |key: &str| {
        cache
            .as_ref()
            .and_then(|c| c.get(key).and_then(Value::as_array))
            .map_or(0, Vec::len)
    };
    let recommendation = if cache.is_none() {
        "Run `mtui understand build` to create the cache."
    } else if marker.full_rebuild_required || !marker.paths.is_empty() {
        "Run `mtui understand build` to refresh changed files."
    } else {
        "Cache is current."
    };
    StatusResult {
        command: "understand status".to_string(),
        exists: cache.is_some(),
        path: path.to_string_lossy().to_string(),
        built_at: cache
            .as_ref()
            .and_then(|c| c.get("builtAt").and_then(Value::as_u64)),
        builder: cache
            .as_ref()
            .and_then(|c| c.get("builder").and_then(Value::as_str))
            .map(str::to_string),
        file_count: count("files"),
        module_count: count("modules"),
        edge_count: count("edges"),
        stale_marker_paths: marker.paths.len(),
        full_rebuild_required: marker.full_rebuild_required,
        recommendation: recommendation.to_string(),
    }
}
