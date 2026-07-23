use std::{
    fs::{self, File, OpenOptions},
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

const MAX_EVENT_BYTES: usize = 1024 * 1024;
const MAX_QUERY_LIMIT: usize = 1000;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JournalEvent {
    pub sequence: u64,
    pub timestamp_ms: u64,
    pub stream: String,
    pub kind: String,
    pub payload: Value,
}

#[derive(Debug, Error)]
pub enum JournalError {
    #[error("event stream and kind must be non-empty and at most 128 bytes")]
    InvalidMetadata,
    #[error("event exceeds the 1 MiB journal limit")]
    EventTooLarge,
    #[error("journal I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("journal serialization failed: {0}")]
    Json(#[from] serde_json::Error),
    #[error("journal sequence lock is poisoned")]
    Poisoned,
}

pub struct EventJournal {
    path: PathBuf,
    sequence: Mutex<u64>,
}

impl EventJournal {
    pub fn open(path: impl Into<PathBuf>) -> Result<Self, JournalError> {
        let path = path.into();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let sequence = recover_valid_prefix(&path)?;
        Ok(Self {
            path,
            sequence: Mutex::new(sequence),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn append(
        &self,
        stream: String,
        kind: String,
        payload: Value,
    ) -> Result<JournalEvent, JournalError> {
        if stream.is_empty() || kind.is_empty() || stream.len() > 128 || kind.len() > 128 {
            return Err(JournalError::InvalidMetadata);
        }
        let mut sequence = self.sequence.lock().map_err(|_| JournalError::Poisoned)?;
        let event = JournalEvent {
            sequence: *sequence + 1,
            timestamp_ms: now_ms(),
            stream,
            kind,
            payload,
        };
        let encoded = serde_json::to_vec(&event)?;
        if encoded.len() > MAX_EVENT_BYTES {
            return Err(JournalError::EventTooLarge);
        }
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?;
        file.write_all(&encoded)?;
        file.write_all(b"\n")?;
        file.flush()?;
        file.sync_data()?;
        *sequence = event.sequence;
        Ok(event)
    }

    pub fn query(
        &self,
        after_sequence: u64,
        limit: usize,
        stream: Option<&str>,
    ) -> Result<Vec<JournalEvent>, JournalError> {
        if !self.path.exists() {
            return Ok(Vec::new());
        }
        let limit = limit.clamp(1, MAX_QUERY_LIMIT);
        let file = File::open(&self.path)?;
        let mut events = Vec::new();
        for line in BufReader::new(file).lines() {
            let line = line?;
            let event: JournalEvent = match serde_json::from_str(&line) {
                Ok(event) => event,
                Err(_) => break,
            };
            if event.sequence <= after_sequence {
                continue;
            }
            if stream.is_some_and(|candidate| candidate != event.stream) {
                continue;
            }
            events.push(event);
            if events.len() == limit {
                break;
            }
        }
        Ok(events)
    }
}

fn recover_valid_prefix(path: &Path) -> Result<u64, JournalError> {
    if !path.exists() {
        return Ok(0);
    }
    let file = File::open(path)?;
    let original_length = file.metadata()?.len();
    let mut reader = BufReader::new(file);
    let mut last = 0;
    let mut valid_length = 0_u64;
    loop {
        let mut line = String::new();
        let bytes = reader.read_line(&mut line)?;
        if bytes == 0 {
            break;
        }
        let event: JournalEvent = match serde_json::from_str(line.trim_end_matches(['\r', '\n'])) {
            Ok(event) => event,
            Err(_) => break,
        };
        last = event.sequence;
        valid_length += bytes as u64;
    }
    if valid_length != original_length {
        let file = OpenOptions::new().write(true).open(path)?;
        file.set_len(valid_length)?;
        file.sync_data()?;
    }
    Ok(last)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appends_and_queries_durable_events() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("events.jsonl");
        let journal = EventJournal::open(&path).unwrap();
        let first = journal
            .append("chat".into(), "started".into(), Value::Null)
            .unwrap();
        journal
            .append("agent".into(), "completed".into(), Value::Bool(true))
            .unwrap();

        let events = journal.query(first.sequence, 10, None).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].kind, "completed");

        let reopened = EventJournal::open(path).unwrap();
        let third = reopened
            .append("chat".into(), "resumed".into(), Value::Null)
            .unwrap();
        assert_eq!(third.sequence, 3);
    }

    #[test]
    fn stops_at_corrupt_tail_and_recovers_valid_prefix() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("events.jsonl");
        fs::write(
            &path,
            "{\"sequence\":1,\"timestampMs\":1,\"stream\":\"s\",\"kind\":\"k\",\"payload\":null}\npartial",
        )
        .unwrap();
        let journal = EventJournal::open(&path).unwrap();
        assert_eq!(journal.query(0, 10, None).unwrap().len(), 1);
        assert_eq!(
            journal
                .append("s".into(), "next".into(), Value::Null)
                .unwrap()
                .sequence,
            2
        );
        assert_eq!(journal.query(0, 10, None).unwrap().len(), 2);
    }

    #[test]
    fn rejects_oversized_event() {
        let journal = EventJournal::open(tempfile::NamedTempFile::new().unwrap().path()).unwrap();
        let payload = Value::String("x".repeat(MAX_EVENT_BYTES));
        assert!(matches!(
            journal.append("s".into(), "k".into(), payload),
            Err(JournalError::EventTooLarge)
        ));
    }
}
