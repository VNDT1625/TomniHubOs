use std::{
    path::PathBuf,
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    hashing::{sha256_base64, sha256_file},
    journal::EventJournal,
    protocol::{Request, Response},
    supervisor::{ProcessSupervisor, SpawnRequest},
    PROTOCOL_VERSION,
};

const RUNTIME_VERSION: &str = env!("CARGO_PKG_VERSION");

pub struct DispatchResult {
    pub response: Response,
    pub shutdown: bool,
}

pub struct TomnyRuntime {
    initialized: bool,
    started_at: Instant,
    journal: EventJournal,
    supervisor: ProcessSupervisor,
}

impl TomnyRuntime {
    pub fn new(data_dir: PathBuf, max_processes: usize) -> Result<Self, std::io::Error> {
        let journal = EventJournal::open(data_dir.join("events.jsonl"))
            .map_err(|error| std::io::Error::other(error.to_string()))?;
        let supervisor = ProcessSupervisor::new(max_processes);
        supervisor.start_reaper();
        Ok(Self {
            initialized: false,
            started_at: Instant::now(),
            journal,
            supervisor,
        })
    }

    pub async fn dispatch(&mut self, request: Request) -> DispatchResult {
        if request.protocol != PROTOCOL_VERSION {
            return failed(
                request.id,
                "UNSUPPORTED_PROTOCOL",
                format!(
                    "expected protocol {PROTOCOL_VERSION}, received {}",
                    request.protocol
                ),
            );
        }
        if request.id.trim().is_empty() {
            return failed("invalid", "INVALID_REQUEST", "request id must be non-empty");
        }
        if request.method == "core.initialize" {
            return self.initialize(request);
        }
        if !self.initialized {
            return failed(
                request.id,
                "NOT_INITIALIZED",
                "core.initialize must complete before other methods",
            );
        }

        match request.method.as_str() {
            "health.check" | "lifecycle.status" => self.health(request).await,
            "lifecycle.shutdown" => {
                self.supervisor.shutdown_all().await;
                DispatchResult {
                    response: Response::success(request.id, json!({ "shuttingDown": true })),
                    shutdown: true,
                }
            }
            "core.cancel" => self.cancel(request).await,
            "hash.sha256" => self.hash(request),
            "journal.append" => self.journal_append(request),
            "journal.query" => self.journal_query(request),
            "process.spawn" => self.process_spawn(request).await,
            "process.status" => self.process_status(request).await,
            "process.terminate" => self.process_terminate(request).await,
            _ => failed(
                request.id,
                "METHOD_NOT_FOUND",
                format!("unknown method {}", request.method),
            ),
        }
    }

    pub async fn shutdown(&self) {
        self.supervisor.shutdown_all().await;
    }

    fn initialize(&mut self, request: Request) -> DispatchResult {
        let params = match parse_params::<InitializeParams>(request.params) {
            Ok(params) => params,
            Err(message) => return failed(request.id, "INVALID_PARAMS", message),
        };
        if params
            .protocol
            .as_deref()
            .is_some_and(|protocol| protocol != PROTOCOL_VERSION)
            || params
                .minimum_protocol_version
                .is_some_and(|minimum| minimum > 1)
            || params
                .maximum_protocol_version
                .is_some_and(|maximum| maximum < 1)
        {
            return failed(
                request.id,
                "UNSUPPORTED_PROTOCOL",
                "client and runtime protocol ranges do not overlap",
            );
        }
        self.initialized = true;
        DispatchResult {
            response: Response::success(
                request.id,
                json!({
                    "initialized": true,
                    "protocol": PROTOCOL_VERSION,
                    "protocolVersion": 1,
                    "runtimeVersion": RUNTIME_VERSION,
                    "client": {
                        "name": params.client_name,
                        "version": params.client_version,
                    },
                    "capabilities": [
                        "core.cancel",
                        "hash.sha256",
                        "health.check",
                        "journal.append",
                        "journal.query",
                        "lifecycle.shutdown",
                        "process.spawn",
                        "process.status",
                        "process.terminate",
                    ],
                    "limits": {
                        "maxProcesses": self.supervisor.max_processes(),
                        "maxJournalQuery": 1000,
                        "maxJournalEventBytes": 1048576,
                    },
                }),
            ),
            shutdown: false,
        }
    }

    async fn health(&self, request: Request) -> DispatchResult {
        DispatchResult {
            response: Response::success(
                request.id,
                json!({
                    "status": "healthy",
                    "pid": std::process::id(),
                    "protocol": PROTOCOL_VERSION,
                    "runtimeVersion": RUNTIME_VERSION,
                    "uptimeMs": self.started_at.elapsed().as_millis() as u64,
                    "runningProcesses": self.supervisor.running_count().await,
                    "timestampMs": now_ms(),
                }),
            ),
            shutdown: false,
        }
    }

    async fn cancel(&self, request: Request) -> DispatchResult {
        let params = match parse_params::<CancelParams>(request.params) {
            Ok(params) => params,
            Err(message) => return failed(request.id, "INVALID_PARAMS", message),
        };
        if let Some(process_id) = params.process_id {
            return match self.supervisor.terminate(&process_id).await {
                Ok(process) => {
                    success(request.id, json!({ "cancelled": true, "process": process }))
                }
                Err(error) => failed(request.id, "PROCESS_ERROR", error.to_string()),
            };
        }
        if let Some(request_id) = params.request_id {
            return success(
                request.id,
                json!({
                    "cancelled": false,
                    "requestId": request_id,
                    "reason": "request_not_running",
                }),
            );
        }
        failed(
            request.id,
            "INVALID_PARAMS",
            "provide requestId or processId",
        )
    }

    fn hash(&self, request: Request) -> DispatchResult {
        let params = match parse_params::<HashParams>(request.params) {
            Ok(params) => params,
            Err(message) => return failed(request.id, "INVALID_PARAMS", message),
        };
        let digest = match (params.bytes_base64, params.file_path) {
            (Some(value), None) => sha256_base64(&value),
            (None, Some(path)) => sha256_file(&path),
            _ => {
                return failed(
                    request.id,
                    "INVALID_PARAMS",
                    "provide exactly one of bytesBase64 or filePath",
                )
            }
        };
        match digest {
            Ok(digest) => success(
                request.id,
                json!({ "algorithm": "sha256", "digest": digest }),
            ),
            Err(error) => failed(request.id, "HASH_ERROR", error.to_string()),
        }
    }

    fn journal_append(&self, request: Request) -> DispatchResult {
        let params = match parse_params::<JournalAppendParams>(request.params) {
            Ok(params) => params,
            Err(message) => return failed(request.id, "INVALID_PARAMS", message),
        };
        match self
            .journal
            .append(params.stream, params.kind, params.payload)
        {
            Ok(event) => success(request.id, json!({ "event": event })),
            Err(error) => failed(request.id, "JOURNAL_ERROR", error.to_string()),
        }
    }

    fn journal_query(&self, request: Request) -> DispatchResult {
        let params = match parse_params::<JournalQueryParams>(request.params) {
            Ok(params) => params,
            Err(message) => return failed(request.id, "INVALID_PARAMS", message),
        };
        match self.journal.query(
            params.after_sequence.unwrap_or(0),
            params.limit.unwrap_or(100),
            params.stream.as_deref(),
        ) {
            Ok(events) => success(request.id, json!({ "events": events })),
            Err(error) => failed(request.id, "JOURNAL_ERROR", error.to_string()),
        }
    }

    async fn process_spawn(&self, request: Request) -> DispatchResult {
        let params = match parse_params::<SpawnRequest>(request.params) {
            Ok(params) => params,
            Err(message) => return failed(request.id, "INVALID_PARAMS", message),
        };
        match self.supervisor.spawn(params).await {
            Ok(process) => success(request.id, json!({ "process": process })),
            Err(error) => failed(request.id, "PROCESS_ERROR", error.to_string()),
        }
    }

    async fn process_status(&self, request: Request) -> DispatchResult {
        let params = match parse_params::<ProcessIdParams>(request.params) {
            Ok(params) => params,
            Err(message) => return failed(request.id, "INVALID_PARAMS", message),
        };
        match self.supervisor.status(&params.process_id).await {
            Ok(process) => success(request.id, json!({ "process": process })),
            Err(error) => failed(request.id, "PROCESS_ERROR", error.to_string()),
        }
    }

    async fn process_terminate(&self, request: Request) -> DispatchResult {
        let params = match parse_params::<ProcessIdParams>(request.params) {
            Ok(params) => params,
            Err(message) => return failed(request.id, "INVALID_PARAMS", message),
        };
        match self.supervisor.terminate(&params.process_id).await {
            Ok(process) => success(request.id, json!({ "process": process })),
            Err(error) => failed(request.id, "PROCESS_ERROR", error.to_string()),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InitializeParams {
    #[serde(default = "default_client_name")]
    client_name: String,
    client_version: Option<String>,
    protocol: Option<String>,
    minimum_protocol_version: Option<u32>,
    maximum_protocol_version: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HashParams {
    bytes_base64: Option<String>,
    file_path: Option<PathBuf>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct JournalAppendParams {
    stream: String,
    kind: String,
    #[serde(default)]
    payload: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct JournalQueryParams {
    after_sequence: Option<u64>,
    limit: Option<usize>,
    stream: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProcessIdParams {
    process_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CancelParams {
    request_id: Option<String>,
    process_id: Option<String>,
}

fn default_client_name() -> String {
    "unknown".into()
}

fn parse_params<T: for<'de> Deserialize<'de>>(params: Value) -> Result<T, String> {
    let params = if params.is_null() { json!({}) } else { params };
    serde_json::from_value(params).map_err(|error| error.to_string())
}

fn success(id: String, result: Value) -> DispatchResult {
    DispatchResult {
        response: Response::success(id, result),
        shutdown: false,
    }
}

fn failed(
    id: impl Into<String>,
    code: impl Into<String>,
    message: impl Into<String>,
) -> DispatchResult {
    DispatchResult {
        response: Response::failure(id, code, message),
        shutdown: false,
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

    fn request(method: &str, params: Value) -> Request {
        Request {
            protocol: PROTOCOL_VERSION.into(),
            id: "test".into(),
            method: method.into(),
            params,
        }
    }

    #[tokio::test]
    async fn requires_initialize_before_health() {
        let directory = tempfile::tempdir().unwrap();
        let mut runtime = TomnyRuntime::new(directory.path().into(), 2).unwrap();
        let response = runtime
            .dispatch(request("health.check", Value::Null))
            .await
            .response;
        assert!(!response.ok);
        assert_eq!(response.error.unwrap().code, "NOT_INITIALIZED");
    }

    #[tokio::test]
    async fn initializes_and_reports_health() {
        let directory = tempfile::tempdir().unwrap();
        let mut runtime = TomnyRuntime::new(directory.path().into(), 2).unwrap();
        let initialized = runtime
            .dispatch(request("core.initialize", json!({ "clientName": "test" })))
            .await
            .response;
        assert!(initialized.ok);
        let healthy = runtime
            .dispatch(request("health.check", Value::Null))
            .await
            .response;
        assert!(healthy.ok);
    }

    #[tokio::test]
    async fn rejects_unknown_methods_without_stopping() {
        let directory = tempfile::tempdir().unwrap();
        let mut runtime = TomnyRuntime::new(directory.path().into(), 2).unwrap();
        runtime
            .dispatch(request("core.initialize", Value::Null))
            .await;
        let response = runtime
            .dispatch(request("unknown", Value::Null))
            .await
            .response;
        assert_eq!(response.error.unwrap().code, "METHOD_NOT_FOUND");
        assert!(
            runtime
                .dispatch(request("health.check", Value::Null))
                .await
                .response
                .ok
        );
    }
}
