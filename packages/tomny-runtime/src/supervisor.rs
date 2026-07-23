use std::{
    collections::{BTreeMap, HashMap},
    path::PathBuf,
    process::Stdio,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::{process::Child, sync::Mutex, time};
use uuid::Uuid;

const MAX_ARGUMENTS: usize = 256;
const MAX_ENVIRONMENT_ENTRIES: usize = 128;
const MAX_LIFETIME_MS: u64 = 24 * 60 * 60 * 1000;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SpawnRequest {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub cwd: Option<PathBuf>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    pub kill_after_ms: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessSnapshot {
    pub process_id: String,
    pub state: ProcessState,
    pub pid: Option<u32>,
    pub started_at_ms: u64,
    pub exit_code: Option<i32>,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ProcessState {
    Running,
    Exited,
    Terminated,
}

struct ProcessRecord {
    child: Child,
    state: ProcessState,
    started_at_ms: u64,
    exit_code: Option<i32>,
    deadline: Option<Instant>,
}

#[derive(Debug, Error)]
pub enum SupervisorError {
    #[error("process command must be non-empty")]
    EmptyCommand,
    #[error("process request exceeds argument or environment limits")]
    InvalidLimits,
    #[error("working directory does not exist or is not a directory")]
    InvalidWorkingDirectory,
    #[error("the bounded process capacity of {0} is exhausted")]
    Capacity(usize),
    #[error("process was not found")]
    NotFound,
    #[error("process operation failed: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Clone)]
pub struct ProcessSupervisor {
    records: Arc<Mutex<HashMap<String, ProcessRecord>>>,
    max_processes: usize,
    closed: Arc<AtomicBool>,
}

impl ProcessSupervisor {
    pub fn new(max_processes: usize) -> Self {
        Self {
            records: Arc::new(Mutex::new(HashMap::new())),
            max_processes: max_processes.clamp(1, 64),
            closed: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn max_processes(&self) -> usize {
        self.max_processes
    }

    pub fn start_reaper(&self) {
        let supervisor = self.clone();
        tokio::spawn(async move {
            let mut interval = time::interval(Duration::from_millis(250));
            while !supervisor.closed.load(Ordering::Relaxed) {
                interval.tick().await;
                supervisor.sweep().await;
            }
        });
    }

    pub async fn spawn(&self, request: SpawnRequest) -> Result<ProcessSnapshot, SupervisorError> {
        validate_request(&request)?;
        self.sweep().await;
        let mut records = self.records.lock().await;
        if records.len() >= self.max_processes * 16 {
            records.retain(|_, record| record.state == ProcessState::Running);
        }
        let running = records
            .values()
            .filter(|record| record.state == ProcessState::Running)
            .count();
        if running >= self.max_processes {
            return Err(SupervisorError::Capacity(self.max_processes));
        }

        let mut command = tokio::process::Command::new(&request.command);
        command
            .args(&request.args)
            .envs(&request.env)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        if let Some(cwd) = &request.cwd {
            command.current_dir(cwd);
        }
        let child = command.spawn()?;
        let process_id = Uuid::new_v4().to_string();
        let started_at_ms = now_ms();
        let deadline = request
            .kill_after_ms
            .map(|value| Instant::now() + Duration::from_millis(value));
        let snapshot = ProcessSnapshot {
            process_id: process_id.clone(),
            state: ProcessState::Running,
            pid: child.id(),
            started_at_ms,
            exit_code: None,
        };
        records.insert(
            process_id,
            ProcessRecord {
                child,
                state: ProcessState::Running,
                started_at_ms,
                exit_code: None,
                deadline,
            },
        );
        Ok(snapshot)
    }

    pub async fn status(&self, process_id: &str) -> Result<ProcessSnapshot, SupervisorError> {
        self.sweep().await;
        let mut records = self.records.lock().await;
        let record = records
            .get_mut(process_id)
            .ok_or(SupervisorError::NotFound)?;
        refresh(record)?;
        Ok(snapshot(process_id, record))
    }

    pub async fn terminate(&self, process_id: &str) -> Result<ProcessSnapshot, SupervisorError> {
        let mut records = self.records.lock().await;
        let record = records
            .get_mut(process_id)
            .ok_or(SupervisorError::NotFound)?;
        refresh(record)?;
        if record.state == ProcessState::Running {
            record.child.kill().await?;
            record.state = ProcessState::Terminated;
            record.exit_code = record
                .child
                .wait()
                .await
                .ok()
                .and_then(|status| status.code());
        }
        Ok(snapshot(process_id, record))
    }

    pub async fn shutdown_all(&self) {
        self.closed.store(true, Ordering::Relaxed);
        let mut records = self.records.lock().await;
        for record in records.values_mut() {
            if record.state == ProcessState::Running {
                let _ = record.child.kill().await;
                record.state = ProcessState::Terminated;
                record.exit_code = record
                    .child
                    .wait()
                    .await
                    .ok()
                    .and_then(|status| status.code());
            }
        }
    }

    pub async fn running_count(&self) -> usize {
        self.sweep().await;
        self.records
            .lock()
            .await
            .values()
            .filter(|record| record.state == ProcessState::Running)
            .count()
    }

    async fn sweep(&self) {
        let mut records = self.records.lock().await;
        for record in records.values_mut() {
            let _ = refresh(record);
            let expired = record
                .deadline
                .is_some_and(|deadline| deadline <= Instant::now());
            if record.state == ProcessState::Running && expired {
                let _ = record.child.kill().await;
                record.state = ProcessState::Terminated;
                record.exit_code = record
                    .child
                    .wait()
                    .await
                    .ok()
                    .and_then(|status| status.code());
            }
        }
    }
}

fn validate_request(request: &SpawnRequest) -> Result<(), SupervisorError> {
    if request.command.trim().is_empty() {
        return Err(SupervisorError::EmptyCommand);
    }
    if request.args.len() > MAX_ARGUMENTS
        || request.env.len() > MAX_ENVIRONMENT_ENTRIES
        || request
            .kill_after_ms
            .is_some_and(|value| value > MAX_LIFETIME_MS)
    {
        return Err(SupervisorError::InvalidLimits);
    }
    if request.cwd.as_ref().is_some_and(|path| !path.is_dir()) {
        return Err(SupervisorError::InvalidWorkingDirectory);
    }
    Ok(())
}

fn refresh(record: &mut ProcessRecord) -> Result<(), std::io::Error> {
    if record.state != ProcessState::Running {
        return Ok(());
    }
    if let Some(status) = record.child.try_wait()? {
        record.state = ProcessState::Exited;
        record.exit_code = status.code();
    }
    Ok(())
}

fn snapshot(process_id: &str, record: &ProcessRecord) -> ProcessSnapshot {
    ProcessSnapshot {
        process_id: process_id.to_string(),
        state: record.state,
        pid: record.child.id(),
        started_at_ms: record.started_at_ms,
        exit_code: record.exit_code,
    }
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

    #[tokio::test]
    async fn rejects_empty_commands() {
        let supervisor = ProcessSupervisor::new(1);
        let error = supervisor
            .spawn(SpawnRequest {
                command: " ".into(),
                args: Vec::new(),
                cwd: None,
                env: BTreeMap::new(),
                kill_after_ms: None,
            })
            .await
            .unwrap_err();
        assert!(matches!(error, SupervisorError::EmptyCommand));
    }

    fn long_running_request() -> SpawnRequest {
        #[cfg(windows)]
        {
            SpawnRequest {
                command: "cmd.exe".into(),
                args: vec!["/C".into(), "ping -n 3 127.0.0.1 > NUL".into()],
                cwd: None,
                env: BTreeMap::new(),
                kill_after_ms: None,
            }
        }
        #[cfg(not(windows))]
        {
            SpawnRequest {
                command: "sh".into(),
                args: vec!["-c".into(), "sleep 2".into()],
                cwd: None,
                env: BTreeMap::new(),
                kill_after_ms: None,
            }
        }
    }

    #[tokio::test]
    async fn enforces_bounded_process_capacity() {
        let supervisor = ProcessSupervisor::new(1);
        supervisor.spawn(long_running_request()).await.unwrap();
        let error = supervisor.spawn(long_running_request()).await.unwrap_err();
        assert!(matches!(error, SupervisorError::Capacity(1)));
        supervisor.shutdown_all().await;
    }

    #[tokio::test]
    async fn rejects_missing_working_directory() {
        let supervisor = ProcessSupervisor::new(1);
        let error = supervisor
            .spawn(SpawnRequest {
                command: "unused".into(),
                args: Vec::new(),
                cwd: Some(PathBuf::from("definitely-not-a-real-directory")),
                env: BTreeMap::new(),
                kill_after_ms: None,
            })
            .await
            .unwrap_err();
        assert!(matches!(error, SupervisorError::InvalidWorkingDirectory));
    }
}
