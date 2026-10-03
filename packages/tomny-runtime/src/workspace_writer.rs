use std::path::{Component, Path, PathBuf};

use thiserror::Error;

pub const MAX_CONTENT_BYTES: usize = 1024 * 1024;
pub const NATIVE_WRITER_UNAVAILABLE: &str = "NATIVE_NO_REPARSE_WRITE_UNAVAILABLE";

#[derive(Debug)]
pub struct WriteAtomicRequest {
    pub workspace_root: PathBuf,
    pub relative_path: String,
    pub content: Vec<u8>,
    pub expected_target_digest: String,
    pub expected_content_digest: String,
}

#[derive(Debug, Error)]
pub enum WorkspaceWriterError {
    #[error("{NATIVE_WRITER_UNAVAILABLE}")]
    Unavailable,
    #[error("INVALID_WORKSPACE_WRITE_REQUEST")]
    InvalidRequest,
}

/// Validates the narrow request shape shared by the future Windows handle-based
/// writer. It intentionally performs no path-string filesystem operation.
pub fn validate_request(request: &WriteAtomicRequest) -> Result<(), WorkspaceWriterError> {
    if !request.workspace_root.is_absolute()
        || request.relative_path.is_empty()
        || request.relative_path.len() > 512
        || request.content.len() > MAX_CONTENT_BYTES
        || !is_sha256_hex(&request.expected_target_digest)
        || !is_sha256_hex(&request.expected_content_digest)
        || request.relative_path.chars().any(char::is_control)
    {
        return Err(WorkspaceWriterError::InvalidRequest);
    }

    let normalized = request.relative_path.replace('\\', "/");
    if normalized.starts_with('/')
        || normalized.contains(':')
        || normalized.split('/').any(|segment| {
            segment.is_empty()
                || segment == "."
                || segment == ".."
                || segment.ends_with('.')
                || segment.ends_with(' ')
                || is_windows_device_name(segment)
        })
        || Path::new(&normalized)
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(WorkspaceWriterError::InvalidRequest);
    }
    Ok(())
}

/// The production writer is deliberately unavailable until the Windows
/// handle-relative, no-reparse implementation is present. There is never a
/// std::fs or Node fallback for governed workspace writes.
pub fn write_atomic(_request: WriteAtomicRequest) -> Result<(), WorkspaceWriterError> {
    Err(WorkspaceWriterError::Unavailable)
}

fn is_sha256_hex(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn is_windows_device_name(segment: &str) -> bool {
    let stem = segment
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || stem
            .strip_prefix("COM")
            .or_else(|| stem.strip_prefix("LPT"))
            .is_some_and(|suffix| {
                matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
            })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(relative_path: &str) -> WriteAtomicRequest {
        WriteAtomicRequest {
            workspace_root: std::env::current_dir().unwrap(),
            relative_path: relative_path.into(),
            content: b"safe".to_vec(),
            expected_target_digest: "a".repeat(64),
            expected_content_digest: "b".repeat(64),
        }
    }

    #[test]
    fn rejects_windows_escape_and_alias_segments_before_any_effect() {
        for path in [
            "../outside.txt",
            "src/..",
            "src/file:stream",
            "src/CON",
            "src/a. ",
            "src/ok\0bad",
        ] {
            assert!(matches!(
                validate_request(&request(path)),
                Err(WorkspaceWriterError::InvalidRequest)
            ));
        }
    }

    #[test]
    fn keeps_the_writer_fail_closed_until_the_handle_relative_implementation_exists() {
        let result = write_atomic(request("src/app.ts"));
        assert!(matches!(result, Err(WorkspaceWriterError::Unavailable)));
    }
}
