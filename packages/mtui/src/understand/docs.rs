//! Static analysis of document-like files for the Understand cache: Markdown,
//! plain text, AsciiDoc/reStructuredText and CSV/TSV. Everything is deterministic and
//! offline, so a folder of notes or tables gets the same kind of map as a code repository:
//! a title and outline per document, columns per table, and links between documents.

use regex::Regex;
use serde_json::{json, Value};
use std::collections::BTreeSet;

const MAX_SYMBOLS: usize = 40;
const MAX_SUMMARY_CHARS: usize = 400;
const MAX_SNIPPET_CHARS: usize = 160;
const SUMMARY_SECTIONS: usize = 6;
const SUMMARY_COLUMNS: usize = 8;

/// Languages whose files are documents rather than source code.
const DOC_LANGUAGES: [&str; 5] = ["markdown", "text", "csv", "restructuredtext", "asciidoc"];

pub(super) fn is_doc_language(language: &str) -> bool {
    DOC_LANGUAGES.contains(&language)
}

/// Extensions that are only indexed when the folder is document-oriented; in a code
/// repository stray `.txt`/`.csv` files are data, not knowledge.
pub(super) fn language_for_extra_extension(extension: &str) -> Option<&'static str> {
    match extension {
        "txt" => Some("text"),
        "csv" | "tsv" => Some("csv"),
        "rst" => Some("restructuredtext"),
        "adoc" | "asciidoc" => Some("asciidoc"),
        _ => None,
    }
}

#[derive(Debug, Default)]
pub(super) struct DocInfo {
    pub title: Option<String>,
    /// Second- and third-level headings with their 1-based line numbers.
    pub sections: Vec<(String, usize)>,
    pub snippet: Option<String>,
    pub words: usize,
    pub columns: Vec<String>,
    pub rows: usize,
}

fn clip(text: &str, limit: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= limit {
        return trimmed.to_string();
    }
    let mut clipped: String = trimmed.chars().take(limit).collect();
    clipped = clipped.trim_end().to_string();
    clipped.push('…');
    clipped
}

fn clean_heading(text: &str) -> String {
    text.trim()
        .trim_matches(|c| matches!(c, '#' | '=' | '*' | '_' | '`'))
        .trim()
        .to_string()
}

/// Headings introduced by `marker` repeated 1-6 times, as used by Markdown (`#`) and
/// AsciiDoc (`=`). Fenced code is ignored, and Markdown front matter may supply the title.
fn analyze_headings(text: &str, marker: char) -> DocInfo {
    let mut info = DocInfo::default();
    let mut in_fence = false;
    let mut in_front_matter = false;
    let mut first_heading: Option<String> = None;
    let mut front_title: Option<String> = None;
    let mut paragraph = String::new();

    for (index, line) in text.lines().enumerate() {
        let trimmed = line.trim();
        if marker == '#' && index == 0 && trimmed == "---" {
            in_front_matter = true;
            continue;
        }
        if in_front_matter {
            if trimmed == "---" || trimmed == "..." {
                in_front_matter = false;
            } else if let Some(value) = trimmed.strip_prefix("title:") {
                let value = value.trim().trim_matches(|c| c == '"' || c == '\'');
                if !value.is_empty() {
                    front_title = Some(clip(value, 100));
                }
            }
            continue;
        }
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") || trimmed == "----" {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        info.words += trimmed.split_whitespace().count();

        let depth = trimmed.chars().take_while(|c| *c == marker).count();
        if (1..=6).contains(&depth) && trimmed[depth..].starts_with(' ') {
            let heading = clean_heading(&trimmed[depth..]);
            if !heading.is_empty() {
                if first_heading.is_none() {
                    first_heading = Some(heading.clone());
                }
                if depth == 1 && info.title.is_none() {
                    info.title = Some(clip(&heading, 100));
                } else if depth <= 3 {
                    info.sections.push((clip(&heading, 80), index + 1));
                }
            }
            if info.snippet.is_none() {
                paragraph.clear();
            }
            continue;
        }
        if info.snippet.is_some() {
            continue;
        }
        if trimmed.is_empty() {
            if !paragraph.is_empty() {
                info.snippet = Some(clip(&paragraph, MAX_SNIPPET_CHARS));
            }
            continue;
        }
        let decoration = trimmed.starts_with('<')
            || trimmed.starts_with('|')
            || trimmed.starts_with("![")
            || trimmed.starts_with("[![")
            || trimmed.starts_with("---")
            || trimmed.starts_with("===");
        if !decoration {
            if !paragraph.is_empty() {
                paragraph.push(' ');
            }
            paragraph.push_str(trimmed);
        }
    }
    if info.snippet.is_none() && !paragraph.is_empty() {
        info.snippet = Some(clip(&paragraph, MAX_SNIPPET_CHARS));
    }
    info.title = info
        .title
        .take()
        .or(front_title)
        .or_else(|| first_heading.map(|heading| clip(&heading, 100)));
    info
}

/// Plain text and reStructuredText: the first line is the title, the next paragraph the snippet.
fn analyze_plain(text: &str) -> DocInfo {
    let mut info = DocInfo::default();
    let mut paragraph = String::new();
    for line in text.lines() {
        let trimmed = line.trim();
        info.words += trimmed.split_whitespace().count();
        if info.title.is_none() {
            if !trimmed.is_empty() {
                info.title = Some(clip(trimmed, 100));
            }
            continue;
        }
        if info.snippet.is_some() {
            continue;
        }
        let underline =
            !trimmed.is_empty() && trimmed.chars().all(|c| matches!(c, '=' | '-' | '~' | '^'));
        if trimmed.is_empty() {
            if !paragraph.is_empty() {
                info.snippet = Some(clip(&paragraph, MAX_SNIPPET_CHARS));
            }
        } else if !underline {
            if !paragraph.is_empty() {
                paragraph.push(' ');
            }
            paragraph.push_str(trimmed);
        }
    }
    if info.snippet.is_none() && !paragraph.is_empty() {
        info.snippet = Some(clip(&paragraph, MAX_SNIPPET_CHARS));
    }
    info
}

fn split_delimited(line: &str, delimiter: char) -> Vec<String> {
    let mut fields = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    for c in line.chars() {
        match c {
            '"' => quoted = !quoted,
            c if c == delimiter && !quoted => {
                fields.push(current.trim().to_string());
                current.clear();
            }
            other => current.push(other),
        }
    }
    fields.push(current.trim().to_string());
    fields
}

/// CSV/TSV: the header names the columns and every further non-empty line is a row.
fn analyze_table(text: &str) -> DocInfo {
    let mut lines = text.lines().filter(|line| !line.trim().is_empty());
    let Some(header) = lines.next() else {
        return DocInfo::default();
    };
    let delimiter = [',', ';', '\t']
        .into_iter()
        .max_by_key(|candidate| header.matches(*candidate).count())
        .filter(|candidate| header.contains(*candidate))
        .unwrap_or(',');
    DocInfo {
        columns: split_delimited(header, delimiter)
            .into_iter()
            .filter(|column| !column.is_empty())
            .collect(),
        rows: lines.count(),
        ..DocInfo::default()
    }
}

pub(super) fn analyze(language: &str, text: &str) -> DocInfo {
    match language {
        "markdown" => analyze_headings(text, '#'),
        "asciidoc" => analyze_headings(text, '='),
        "csv" => analyze_table(text),
        _ => analyze_plain(text),
    }
}

/// One-paragraph description used as the file summary.
pub(super) fn summary(info: &DocInfo, language: &str, label: &str) -> String {
    if language == "csv" {
        if info.columns.is_empty() {
            return "Empty table.".to_string();
        }
        let shown: Vec<&str> = info
            .columns
            .iter()
            .take(SUMMARY_COLUMNS)
            .map(String::as_str)
            .collect();
        let more = if info.columns.len() > SUMMARY_COLUMNS {
            ", …"
        } else {
            ""
        };
        return format!(
            "Table with {} column(s) ({}{}) and {} row(s).",
            info.columns.len(),
            shown.join(", "),
            more,
            info.rows
        );
    }
    let head = info.title.clone().unwrap_or_else(|| label.to_string());
    let mut text = match &info.snippet {
        Some(snippet) if !snippet.starts_with(&head) => format!("{head} — {snippet}"),
        _ => head,
    };
    if !info.sections.is_empty() {
        let names: Vec<&str> = info
            .sections
            .iter()
            .take(SUMMARY_SECTIONS)
            .map(|(name, _)| name.as_str())
            .collect();
        text.push_str(&format!(" Sections: {}.", names.join(", ")));
    }
    text.push_str(&format!(" ({} words)", info.words));
    clip(&text, MAX_SUMMARY_CHARS)
}

/// Searchable symbols: headings for documents, column names for tables.
pub(super) fn symbols(info: &DocInfo, language: &str) -> Vec<Value> {
    if language == "csv" {
        return info
            .columns
            .iter()
            .take(MAX_SYMBOLS)
            .map(|column| json!({ "name": column, "kind": "column", "line": 1 }))
            .collect();
    }
    info.sections
        .iter()
        .take(MAX_SYMBOLS)
        .map(|(name, line)| json!({ "name": name, "kind": "section", "line": line }))
        .collect()
}

// ---------------------------------------------------------------------------
// Links between documents
// ---------------------------------------------------------------------------

pub(super) struct DocPatterns {
    markdown_link: Regex,
    wikilink: Regex,
}

/// Raw link targets found in a document, before they are resolved against the file set.
#[derive(Debug, Default)]
pub(super) struct DocLinks {
    pub paths: BTreeSet<String>,
    pub wikilinks: BTreeSet<String>,
}

fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).ok();
            if let Some(value) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(value);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

impl DocPatterns {
    pub(super) fn new() -> Self {
        DocPatterns {
            markdown_link: Regex::new(r#"\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)"#)
                .expect("static regex is valid"),
            wikilink: Regex::new(r"\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]")
                .expect("static regex is valid"),
        }
    }

    /// Local Markdown links and `[[wikilinks]]`, skipping fenced code, URLs and in-page anchors.
    pub(super) fn links(&self, text: &str) -> DocLinks {
        let mut links = DocLinks::default();
        let mut in_fence = false;
        for line in text.lines() {
            let trimmed = line.trim_start();
            if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
                in_fence = !in_fence;
                continue;
            }
            if in_fence {
                continue;
            }
            for captures in self.markdown_link.captures_iter(line) {
                let raw = &captures[1];
                if raw.starts_with('#') || raw.contains("://") || raw.starts_with("mailto:") {
                    continue;
                }
                let target = raw.split(['#', '?']).next().unwrap_or_default();
                if !target.is_empty() {
                    links.paths.insert(percent_decode(target));
                }
            }
            for captures in self.wikilink.captures_iter(line) {
                let name = captures[1].trim();
                if !name.is_empty() {
                    links.wikilinks.insert(name.to_string());
                }
            }
        }
        links
    }
}
