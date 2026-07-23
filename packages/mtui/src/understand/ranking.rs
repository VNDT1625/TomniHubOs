use serde::Deserialize;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};

#[derive(Debug, Deserialize, Clone)]
pub(super) struct FileEdge {
    pub from: String,
    pub to: String,
}

const STOP_WORDS: &[&str] = &[
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how", "in", "into", "is",
    "it", "of", "on", "or", "the", "this", "through", "to", "user", "with", "các", "cái", "cho",
    "của", "được", "khi", "là", "một", "người", "như", "qua", "sau", "từ", "và", "với",
];

fn normalized_tokens(text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut token = String::new();
    let characters = text.chars().collect::<Vec<_>>();
    for (index, character) in characters.iter().copied().enumerate() {
        let previous = index
            .checked_sub(1)
            .and_then(|item| characters.get(item))
            .copied();
        let next = characters.get(index + 1).copied();
        let camel_boundary = !token.is_empty()
            && character.is_uppercase()
            && (previous.is_some_and(|item| item.is_lowercase() || item.is_numeric())
                || (previous.is_some_and(char::is_uppercase)
                    && next.is_some_and(char::is_lowercase)));
        if camel_boundary {
            if token.chars().count() >= 2 && !STOP_WORDS.contains(&token.as_str()) {
                tokens.push(std::mem::take(&mut token));
            } else {
                token.clear();
            }
        }
        if character.is_alphanumeric() {
            token.extend(character.to_lowercase());
        } else if !token.is_empty() {
            if token.chars().count() >= 2 && !STOP_WORDS.contains(&token.as_str()) {
                tokens.push(std::mem::take(&mut token));
            } else {
                token.clear();
            }
        }
    }
    if token.chars().count() >= 2 && !STOP_WORDS.contains(&token.as_str()) {
        tokens.push(token);
    }
    tokens
}

pub(super) fn text_tokens(text: &str) -> BTreeSet<String> {
    normalized_tokens(text).into_iter().collect()
}

fn synonyms(term: &str) -> &'static [&'static str] {
    match term {
        "gửi" | "send" | "sending" | "submit" => &["send", "submit", "invoke"],
        "tin" | "nhắn" | "message" | "chat" | "conversation" => {
            &["message", "chat", "conversation"]
        }
        "giao" | "diện" | "ui" | "renderer" | "react" | "view" => {
            &["ui", "renderer", "react", "view"]
        }
        "lưu" | "dữ" | "liệu" | "persist" | "persistence" | "repository" | "storage" | "save" => {
            &["persist", "persistence", "repository", "storage", "save"]
        }
        "nhận" | "phản" | "hồi" | "response" | "stream" | "event" | "listener" => {
            &["response", "stream", "event", "listener"]
        }
        "ipc" | "bridge" | "invoke" | "provider" => &["ipc", "bridge", "invoke", "provider"],
        "runtime" => &["runtime", "start", "core", "orchestration"],
        "luồng" => &["flow", "stream", "route", "pipeline"],
        "truy" | "vết" => &["trace", "flow", "route"],
        "lỗi" => &["bug", "error", "failure"],
        "sửa" => &["fix", "repair", "patch"],
        "tệp" | "file" | "files" => &["path", "source", "symbol"],
        "kiểm" | "thử" => &["test", "verify", "verification"],
        "understand" => &["knowledge", "graph", "context", "summary", "builder", "map"],
        "codegraph" | "graph" => &["understand", "knowledge", "context", "map", "summary"],
        "cursor" => &["context", "rank", "ranking", "retrieval", "graph", "search"],
        "map" => &["context", "understand", "knowledge", "folder"],
        "summary" => &["understand", "information", "folder", "module"],
        "folder" => &["module", "directory", "group"],
        "query" | "search" => &["context", "rank", "ranking", "intent"],
        "mtui" => &["understand", "context", "map", "compass"],
        "adaptive" | "concurrency" => &["summary", "builder", "performance"],
        "fingerprint" => &["summary", "module", "freshness", "reuse"],
        "stale" => &["freshness", "understand", "summary"],
        _ => &[],
    }
}

/// Tokenize natural-language intent without dropping non-ASCII languages, then
/// add a deliberately small bilingual vocabulary for common code-navigation tasks.
pub(super) fn intent_terms(intent: &str) -> Vec<String> {
    let mut terms = normalized_tokens(intent);
    let original = terms.clone();
    for term in original {
        terms.extend(synonyms(&term).iter().map(|value| (*value).to_string()));
    }
    terms.sort();
    terms.dedup();
    terms
}

pub(super) const FLOW_STAGE_COUNT: usize = 5;
const UI_STAGE: usize = 0;
const TRANSPORT_STAGE: usize = 1;
const PERSISTENCE_STAGE: usize = 2;
const RUNTIME_STAGE: usize = 3;
const RESPONSE_STAGE: usize = 4;

const UI_TERMS: &[&str] = &[
    "ui", "react", "renderer", "view", "send", "sendbox", "composer", "execute", "command",
    "submit",
];
const TRANSPORT_TERMS: &[&str] = &[
    "ipc",
    "bridge",
    "invoke",
    "provider",
    "channel",
    "contract",
    "sendmessage",
];
const PERSISTENCE_TERMS: &[&str] = &[
    "persist",
    "persistence",
    "repository",
    "storage",
    "database",
    "save",
    "savemessage",
    "durable",
];
const RUNTIME_TERMS: &[&str] = &[
    "runtime",
    "start",
    "agent",
    "core",
    "orchestration",
    "processcoreevent",
];
const RESPONSE_TERMS: &[&str] = &[
    "response",
    "stream",
    "event",
    "listener",
    "completion",
    "completed",
    "handlecoreevent",
    "turncompleted",
];

fn contains_any(terms: &BTreeSet<String>, expected: &[&str]) -> bool {
    expected.iter().any(|term| terms.contains(*term))
}

pub(super) fn active_flow_stages(terms: &[String]) -> [bool; FLOW_STAGE_COUNT] {
    let terms = terms.iter().cloned().collect::<BTreeSet<_>>();
    [
        contains_any(&terms, UI_TERMS) || terms.contains("send"),
        contains_any(&terms, TRANSPORT_TERMS),
        contains_any(&terms, PERSISTENCE_TERMS),
        contains_any(&terms, RUNTIME_TERMS),
        contains_any(&terms, RESPONSE_TERMS),
    ]
}

fn stage_evidence_score(
    path_tokens: &BTreeSet<String>,
    symbol_tokens: &BTreeSet<String>,
    summary_tokens: &BTreeSet<String>,
    expected: &[&str],
) -> usize {
    expected
        .iter()
        .map(|term| {
            usize::from(path_tokens.contains(*term)) * 5
                + usize::from(symbol_tokens.contains(*term)) * 4
                + usize::from(summary_tokens.contains(*term))
        })
        .sum()
}

pub(super) fn file_flow_stage_scores(
    path: &str,
    summary: &str,
    symbols: &str,
) -> [usize; FLOW_STAGE_COUNT] {
    let path_tokens = text_tokens(path);
    let symbol_tokens = text_tokens(symbols);
    let summary_tokens = text_tokens(summary);
    let mut scores = [
        stage_evidence_score(&path_tokens, &symbol_tokens, &summary_tokens, UI_TERMS),
        stage_evidence_score(
            &path_tokens,
            &symbol_tokens,
            &summary_tokens,
            TRANSPORT_TERMS,
        ),
        stage_evidence_score(
            &path_tokens,
            &symbol_tokens,
            &summary_tokens,
            PERSISTENCE_TERMS,
        ),
        stage_evidence_score(&path_tokens, &symbol_tokens, &summary_tokens, RUNTIME_TERMS),
        stage_evidence_score(
            &path_tokens,
            &symbol_tokens,
            &summary_tokens,
            RESPONSE_TERMS,
        ),
    ];
    // A `use*Message` hook connected to the transport contract is normally the
    // response consumer even when the lightweight structural summary does not
    // retain property-access names such as `responseStream.on`.
    if path_tokens.contains("use") && path_tokens.contains("message") {
        scores[RESPONSE_STAGE] += 8;
    }
    scores
}

const IDENTITY_STOP_WORDS: &[&str] = &[
    "adapter",
    "agent",
    "bridge",
    "common",
    "conversation",
    "desktop",
    "index",
    "message",
    "native",
    "package",
    "packages",
    "params",
    "permission",
    "process",
    "renderer",
    "response",
    "runtime",
    "send",
    "service",
    "source",
    "start",
    "stream",
    "string",
    "summary",
    "typescript",
    "turn",
];

pub(super) fn file_identity_tokens(path: &str, symbols: &str) -> BTreeSet<String> {
    text_tokens(&format!("{path} {symbols}"))
        .into_iter()
        .filter(|term| {
            term.chars().count() >= 4
                && term.chars().any(char::is_alphabetic)
                && !IDENTITY_STOP_WORDS.contains(&term.as_str())
        })
        .collect()
}

fn graph_adjacency<'a>(
    edges: &'a [FileEdge],
    valid_paths: &'a HashSet<String>,
) -> BTreeMap<&'a str, BTreeSet<&'a str>> {
    let mut adjacency = BTreeMap::<&str, BTreeSet<&str>>::new();
    for edge in edges {
        if edge.from == edge.to
            || !valid_paths.contains(&edge.from)
            || !valid_paths.contains(&edge.to)
        {
            continue;
        }
        adjacency.entry(&edge.from).or_default().insert(&edge.to);
        adjacency.entry(&edge.to).or_default().insert(&edge.from);
    }
    adjacency
}

fn bounded_distances<'a>(
    adjacency: &BTreeMap<&'a str, BTreeSet<&'a str>>,
    start: &'a str,
    max_distance: usize,
) -> HashMap<&'a str, usize> {
    let mut distances = HashMap::from([(start, 0usize)]);
    let mut queue = VecDeque::from([start]);
    while let Some(current) = queue.pop_front() {
        let distance = distances.get(current).copied().unwrap_or(0);
        if distance >= max_distance {
            continue;
        }
        for neighbor in adjacency.get(current).into_iter().flatten().copied() {
            if distances.contains_key(neighbor) {
                continue;
            }
            distances.insert(neighbor, distance + 1);
            queue.push_back(neighbor);
        }
    }
    distances
}

fn is_test_path(path: &str) -> bool {
    path.contains("/tests/")
        || path.starts_with("tests/")
        || path.contains(".test.")
        || path.contains(".spec.")
}

fn active_stage_count(
    scores: &[usize; FLOW_STAGE_COUNT],
    active: &[bool; FLOW_STAGE_COUNT],
) -> usize {
    scores
        .iter()
        .zip(active)
        .filter(|(score, enabled)| **enabled && **score > 0)
        .count()
}

/// Build a compact, stage-aware neighborhood around a transport boundary and
/// a complementary persistence/runtime anchor. Route identity is inferred from
/// rare identifiers shared by both anchors (for example a subsystem name), not
/// from product- or path-specific constants.
pub(super) fn flow_route_boosts(
    edges: &[FileEdge],
    direct_scores: &BTreeMap<String, usize>,
    stage_scores: &BTreeMap<String, [usize; FLOW_STAGE_COUNT]>,
    identity_tokens: &BTreeMap<String, BTreeSet<String>>,
    active: &[bool; FLOW_STAGE_COUNT],
    valid_paths: &HashSet<String>,
) -> Option<HashMap<String, usize>> {
    if active.iter().filter(|enabled| **enabled).count() < 3 || !active[TRANSPORT_STAGE] {
        return None;
    }
    let adjacency = graph_adjacency(edges, valid_paths);
    let mut pivots = direct_scores
        .iter()
        .filter_map(|(path, direct)| {
            let stages = stage_scores.get(path)?;
            (stages[TRANSPORT_STAGE] > 0).then_some((path.as_str(), *direct, stages))
        })
        .collect::<Vec<_>>();
    pivots.sort_by(|left, right| {
        let left_score =
            left.1 * 2 + left.2[TRANSPORT_STAGE] * 12 + active_stage_count(left.2, active) * 8;
        let right_score =
            right.1 * 2 + right.2[TRANSPORT_STAGE] * 12 + active_stage_count(right.2, active) * 8;
        is_test_path(left.0)
            .cmp(&is_test_path(right.0))
            .then_with(|| right_score.cmp(&left_score))
            .then_with(|| left.0.cmp(right.0))
    });
    let pivot = pivots.first()?.0;
    let pivot_distances = bounded_distances(&adjacency, pivot, 4);

    let mut complements = direct_scores
        .iter()
        .filter_map(|(path, direct)| {
            if path == pivot || !pivot_distances.contains_key(path.as_str()) {
                return None;
            }
            let stages = stage_scores.get(path)?;
            if stages[PERSISTENCE_STAGE] == 0 {
                return None;
            }
            let distance = pivot_distances.get(path.as_str()).copied().unwrap_or(4);
            let score = direct
                + stages[PERSISTENCE_STAGE] * 12
                + stages[RUNTIME_STAGE] * 12
                + stages[RESPONSE_STAGE] * 4
                + active_stage_count(stages, active) * 20;
            Some((path.as_str(), score.saturating_sub(distance * 16), stages))
        })
        .collect::<Vec<_>>();
    complements.sort_by(|left, right| {
        is_test_path(left.0)
            .cmp(&is_test_path(right.0))
            .then_with(|| right.1.cmp(&left.1))
            .then_with(|| left.0.cmp(right.0))
    });
    let complement = complements.first()?.0;
    let complement_distances = bounded_distances(&adjacency, complement, 4);

    let mut document_frequency = HashMap::<&str, usize>::new();
    for tokens in identity_tokens.values() {
        for token in tokens {
            *document_frequency.entry(token).or_default() += 1;
        }
    }
    let pivot_identity = identity_tokens.get(pivot)?;
    let complement_identity = identity_tokens.get(complement)?;
    let route_identity = pivot_identity
        .intersection(complement_identity)
        .filter(|term| {
            document_frequency
                .get(term.as_str())
                .is_some_and(|frequency| (2..=40).contains(frequency))
        })
        .cloned()
        .collect::<BTreeSet<_>>();

    let coherent_with_route = |path: &str| {
        identity_tokens
            .get(path)
            .is_some_and(|tokens| route_identity.iter().any(|term| tokens.contains(term)))
    };
    let select_stage_anchor = |stage: usize| {
        let mut candidates = direct_scores
            .iter()
            .filter_map(|(path, direct)| {
                if path == pivot
                    || path == complement
                    || !coherent_with_route(path)
                    || pivot_distances
                        .get(path.as_str())
                        .is_none_or(|distance| *distance > 3)
                {
                    return None;
                }
                let evidence = stage_scores.get(path)?[stage];
                if evidence == 0 {
                    return None;
                }
                let distance = pivot_distances.get(path.as_str()).copied().unwrap_or(3);
                let path_tokens = text_tokens(path);
                let action_bonus = if stage == UI_STAGE
                    && ["send", "submit", "execute", "composer"]
                        .iter()
                        .any(|term| path_tokens.contains(*term))
                {
                    200
                } else {
                    0
                };
                Some((
                    path.as_str(),
                    direct + evidence * 20 + action_bonus - distance * 8,
                ))
            })
            .collect::<Vec<_>>();
        candidates.sort_by(|left, right| {
            is_test_path(left.0)
                .cmp(&is_test_path(right.0))
                .then_with(|| right.1.cmp(&left.1))
                .then_with(|| left.0.cmp(right.0))
        });
        candidates.first().map(|candidate| candidate.0)
    };
    let ui_anchor = active[UI_STAGE]
        .then(|| select_stage_anchor(UI_STAGE))
        .flatten();
    let response_anchor = active[RESPONSE_STAGE]
        .then(|| select_stage_anchor(RESPONSE_STAGE))
        .flatten();

    let mut boosts = HashMap::new();
    for path in valid_paths {
        let stages = stage_scores
            .get(path)
            .copied()
            .unwrap_or([0; FLOW_STAGE_COUNT]);
        let pivot_distance = pivot_distances.get(path.as_str()).copied();
        let complement_distance = complement_distances.get(path.as_str()).copied();
        let mut score = active_stage_count(&stages, active) * 12;
        if let Some(distance) = pivot_distance.filter(|distance| *distance <= 3) {
            score += (4 - distance) * 15;
        }
        if let Some(distance) = complement_distance.filter(|distance| *distance <= 3) {
            score += (4 - distance) * 15;
        }
        if path == pivot || path == complement {
            score += 120;
        }
        if ui_anchor == Some(path.as_str()) || response_anchor == Some(path.as_str()) {
            score += 160;
        }
        let coherence = identity_tokens
            .get(path)
            .map(|tokens| {
                route_identity
                    .intersection(tokens)
                    .map(|term| {
                        56usize.saturating_sub(
                            document_frequency.get(term.as_str()).copied().unwrap_or(56),
                        ) * 12
                    })
                    .sum::<usize>()
                    .min(360)
            })
            .unwrap_or(0);
        if coherence > 0 && pivot_distance.is_some_and(|distance| distance <= 3) {
            score += coherence;
            if complement_distance.is_some_and(|distance| distance <= 3) {
                score += 40;
            }
        }
        if score > 0 {
            boosts.insert(path.clone(), score);
        }
    }
    Some(boosts)
}

/// Propagate strong lexical anchors over the persisted file dependency graph.
///
/// Edges are treated as navigational (undirected): an importer and its dependency
/// are both useful when tracing a behavior. Only the strongest anchors expand and
/// traversal is bounded to three hops, preventing generic hub files from flooding
/// the result set.
pub(super) fn graph_boosts(
    edges: &[FileEdge],
    direct_scores: &BTreeMap<String, usize>,
    valid_paths: &HashSet<String>,
) -> HashMap<String, usize> {
    let mut adjacency = BTreeMap::<&str, BTreeSet<&str>>::new();
    for edge in edges {
        if edge.from == edge.to
            || !valid_paths.contains(&edge.from)
            || !valid_paths.contains(&edge.to)
        {
            continue;
        }
        adjacency.entry(&edge.from).or_default().insert(&edge.to);
        adjacency.entry(&edge.to).or_default().insert(&edge.from);
    }

    let mut anchors = direct_scores
        .iter()
        .filter(|(_, score)| **score > 0)
        .map(|(path, score)| (path.as_str(), *score))
        .collect::<Vec<_>>();
    anchors.sort_by(|left, right| right.1.cmp(&left.1).then_with(|| left.0.cmp(right.0)));
    anchors.truncate(6);

    let mut boosts = HashMap::<String, usize>::new();
    for (anchor, anchor_score) in anchors {
        let mut queue = VecDeque::from([(anchor, 0usize)]);
        let mut visited = HashSet::from([anchor]);
        while let Some((current, distance)) = queue.pop_front() {
            if distance >= 3 {
                continue;
            }
            let Some(neighbors) = adjacency.get(current) else {
                continue;
            };
            let mut ranked_neighbors = neighbors.iter().copied().collect::<Vec<_>>();
            ranked_neighbors.sort_by(|left, right| {
                direct_scores
                    .get(*right)
                    .unwrap_or(&0)
                    .cmp(direct_scores.get(*left).unwrap_or(&0))
                    .then_with(|| left.cmp(right))
            });
            // High-degree barrels and shared adapters are useful, but bounded fan-out
            // keeps a single hub from turning a focused route into the whole repo.
            for neighbor in ranked_neighbors.into_iter().take(24) {
                if !visited.insert(neighbor) {
                    continue;
                }
                let next_distance = distance + 1;
                let percentage = match next_distance {
                    1 => 60,
                    2 => 38,
                    _ => 24,
                };
                let propagated = (anchor_score * percentage / 100).max(1);
                boosts
                    .entry(neighbor.to_string())
                    .and_modify(|score| *score = (*score).max(propagated))
                    .or_insert(propagated);
                queue.push_back((neighbor, next_distance));
            }
        }
    }
    boosts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unicode_intent_keeps_vietnamese_and_expands_navigation_terms() {
        let terms = intent_terms("Truy vết luồng gửi tin nhắn và lưu dữ liệu rồi nhận phản hồi");
        assert!(terms.contains(&"gửi".to_string()));
        assert!(terms.contains(&"send".to_string()));
        assert!(terms.contains(&"message".to_string()));
        assert!(terms.contains(&"persistence".to_string()));
        assert!(terms.contains(&"response".to_string()));
        assert!(!terms.contains(&"và".to_string()));
    }

    #[test]
    fn graph_expansion_follows_a_bounded_route_and_ignores_disconnected_files() {
        let edges = vec![
            FileEdge {
                from: "ui.ts".into(),
                to: "contract.ts".into(),
            },
            FileEdge {
                from: "provider.ts".into(),
                to: "contract.ts".into(),
            },
            FileEdge {
                from: "provider.ts".into(),
                to: "service.ts".into(),
            },
            FileEdge {
                from: "listener.ts".into(),
                to: "contract.ts".into(),
            },
        ];
        let direct = BTreeMap::from([("ui.ts".to_string(), 100)]);
        let valid = [
            "ui.ts",
            "contract.ts",
            "provider.ts",
            "service.ts",
            "listener.ts",
            "wrong.ts",
        ]
        .into_iter()
        .map(str::to_string)
        .collect::<HashSet<_>>();

        let boosts = graph_boosts(&edges, &direct, &valid);

        assert_eq!(boosts.get("contract.ts"), Some(&60));
        assert_eq!(boosts.get("provider.ts"), Some(&38));
        assert_eq!(boosts.get("listener.ts"), Some(&38));
        assert_eq!(boosts.get("service.ts"), Some(&24));
        assert!(!boosts.contains_key("wrong.ts"));
    }
}
