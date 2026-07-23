use anyhow::Context;
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use ignore::{Walk, WalkBuilder, WalkState};
use std::path::{Path, PathBuf};
use std::sync::Arc;

pub const DEFAULT_MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;

enum DiscoverySource {
    Explicit(Option<PathBuf>),
    Recursive(Walk),
}

/// A deterministic, ignore-aware stream of searchable files.
///
/// Directory traversal follows ripgrep-style ignore rules. A directly requested
/// file bypasses discovery ignores, matching command-line search behavior.
pub struct FileDiscovery {
    source: DiscoverySource,
    max_file_bytes: u64,
}

impl Iterator for FileDiscovery {
    type Item = PathBuf;

    fn next(&mut self) -> Option<Self::Item> {
        match &mut self.source {
            DiscoverySource::Explicit(path) => path.take(),
            DiscoverySource::Recursive(walk) => loop {
                let entry = walk.next()?;
                let Ok(entry) = entry else {
                    continue;
                };
                if entry
                    .file_type()
                    .map(|file_type| file_type.is_file())
                    .unwrap_or(false)
                    && entry
                        .metadata()
                        .map(|metadata| metadata.len() <= self.max_file_bytes)
                        .unwrap_or(false)
                {
                    return Some(entry.into_path());
                }
            },
        }
    }
}

fn build_config_ignore(project_root: &Path, patterns: &[String]) -> anyhow::Result<Gitignore> {
    let mut builder = GitignoreBuilder::new(project_root);
    for pattern in ["coverage/", "out/"]
        .into_iter()
        .chain(patterns.iter().map(String::as_str))
    {
        builder
            .add_line(None, pattern)
            .with_context(|| format!("Invalid MTUI ignore pattern `{pattern}`"))?;
    }
    builder
        .build()
        .context("Failed to build MTUI ignore matcher")
}

fn recursive_walk_builder(
    project_root: PathBuf,
    search_path: PathBuf,
    config_patterns: &[String],
) -> anyhow::Result<WalkBuilder> {
    let config_ignore = Arc::new(build_config_ignore(&project_root, config_patterns)?);
    let config_root = project_root.clone();
    let mut builder = WalkBuilder::new(search_path);
    builder
        .current_dir(project_root)
        .standard_filters(true)
        .require_git(false)
        .sort_by_file_path(|left, right| left.cmp(right))
        .filter_entry(move |entry| {
            if entry.depth() == 0 || !entry.path().starts_with(&config_root) {
                return true;
            }
            let is_dir = entry
                .file_type()
                .map(|file_type| file_type.is_dir())
                .unwrap_or(false);
            !config_ignore
                .matched_path_or_any_parents(entry.path(), is_dir)
                .is_ignore()
        });
    Ok(builder)
}

/// Discover files below `search_path` without materializing the whole tree.
///
/// Standard hidden, `.ignore`, nested `.gitignore`, global Git, and
/// `.git/info/exclude` rules are enabled. `config_patterns` are interpreted
/// using gitignore syntax relative to `project_root`.
pub fn discover_files(
    project_root: &Path,
    search_path: &Path,
    config_patterns: &[String],
    max_file_bytes: u64,
) -> anyhow::Result<FileDiscovery> {
    let project_root = project_root.components().collect::<PathBuf>();
    let search_path = search_path.components().collect::<PathBuf>();

    if search_path.is_file() {
        let within_limit = std::fs::metadata(&search_path)
            .map(|metadata| metadata.len() <= max_file_bytes)
            .unwrap_or(false);
        return Ok(FileDiscovery {
            source: DiscoverySource::Explicit(within_limit.then_some(search_path)),
            max_file_bytes,
        });
    }

    let builder = recursive_walk_builder(project_root, search_path, config_patterns)?;

    Ok(FileDiscovery {
        source: DiscoverySource::Recursive(builder.build()),
        max_file_bytes,
    })
}

/// Visit discovered files in parallel. Callers that expose ordered results must
/// sort their collected output before returning it.
pub fn visit_files_parallel<F>(
    project_root: &Path,
    search_path: &Path,
    config_patterns: &[String],
    max_file_bytes: u64,
    visitor: F,
) -> anyhow::Result<()>
where
    F: Fn(PathBuf) + Sync,
{
    let project_root = project_root.components().collect::<PathBuf>();
    let search_path = search_path.components().collect::<PathBuf>();

    if search_path.is_file() {
        if std::fs::metadata(&search_path)
            .map(|metadata| metadata.len() <= max_file_bytes)
            .unwrap_or(false)
        {
            visitor(search_path);
        }
        return Ok(());
    }

    recursive_walk_builder(project_root, search_path, config_patterns)?
        .build_parallel()
        .run(|| {
            let visitor = &visitor;
            Box::new(move |entry| {
                let Ok(entry) = entry else {
                    return WalkState::Continue;
                };
                if entry
                    .file_type()
                    .map(|file_type| file_type.is_file())
                    .unwrap_or(false)
                    && entry
                        .metadata()
                        .map(|metadata| metadata.len() <= max_file_bytes)
                        .unwrap_or(false)
                {
                    visitor(entry.into_path());
                }
                WalkState::Continue
            })
        });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_file(path: &Path, content: &str) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, content).unwrap();
    }

    #[test]
    fn skips_files_above_the_size_limit() {
        let repo = tempfile::tempdir().unwrap();
        write_file(&repo.path().join("small.txt"), "small");
        write_file(&repo.path().join("large.txt"), "too large");

        let files = discover_files(repo.path(), repo.path(), &[], 5)
            .unwrap()
            .map(|path| path.file_name().unwrap().to_string_lossy().to_string())
            .collect::<Vec<_>>();

        assert_eq!(files, vec!["small.txt"]);
    }

    #[test]
    fn explicit_file_still_respects_the_size_limit() {
        let repo = tempfile::tempdir().unwrap();
        let file = repo.path().join("large.txt");
        write_file(&file, "too large");

        assert_eq!(
            discover_files(repo.path(), &file, &[], 5).unwrap().count(),
            0
        );
    }

    #[test]
    fn config_matcher_uses_project_relative_patterns() {
        let repo = tempfile::tempdir().unwrap();
        let generated = repo.path().join("generated/drop.txt");
        write_file(&generated, "content");
        let pattern = vec!["generated/**".to_string()];

        let canonical_repo = std::fs::canonicalize(repo.path()).unwrap();
        let canonical_generated = std::fs::canonicalize(generated).unwrap();
        let matcher = build_config_ignore(&canonical_repo, &pattern).unwrap();

        assert!(matcher
            .matched_path_or_any_parents(&canonical_generated, false)
            .is_ignore());
    }

    #[test]
    fn discovery_applies_config_patterns() {
        let repo = tempfile::tempdir().unwrap();
        write_file(&repo.path().join("src/keep.txt"), "content");
        write_file(&repo.path().join("generated/drop.txt"), "content");
        let pattern = vec!["generated/**".to_string()];
        let normalized_repo = repo.path().components().collect::<PathBuf>();

        let files = discover_files(repo.path(), repo.path(), &pattern, 1024)
            .unwrap()
            .map(|path| path.strip_prefix(&normalized_repo).unwrap().to_path_buf())
            .collect::<Vec<_>>();

        assert_eq!(files, vec![PathBuf::from("src/keep.txt")]);
    }
}
