# Tomny Runtime

Native sidecar services for Tomny Core. The Electron main process owns policy and
orchestration; this runtime owns bounded, durable, or CPU-sensitive operations.

## Transport

The binary reads one JSON request per stdin line and writes one JSON response per
stdout line. The protocol is a custom versioned envelope, not JSON-RPC:

```json
{
  "protocol": "tomny.runtime.v1",
  "id": "1",
  "method": "core.initialize",
  "params": { "protocol": "tomny.runtime.v1", "minimumProtocolVersion": 1, "maximumProtocolVersion": 1 }
}
```

Every connection must successfully call `core.initialize` before other methods.
Malformed lines receive an `INVALID_REQUEST` response and do not terminate the
runtime.

## Methods

- `core.initialize`, `core.cancel`
- `health.check`, `lifecycle.status`, `lifecycle.shutdown`
- `hash.sha256` for base64 bytes or a file path
- `journal.append`, `journal.query`
- `process.spawn`, `process.status`, `process.terminate`

Process count, argument count, environment size, and lifetime are bounded.
Child stdio is disconnected so an unattended child cannot block on a full pipe.
Journal frames are capped at 1 MiB, synced after append, and a corrupt tail is
truncated to the last valid event during recovery.

## Build and verify

```text
cargo build --release
cargo test
cargo clippy --all-targets --all-features -- -D warnings
```

Use `--data-dir <path>` to select durable storage and `--max-processes <n>`
to configure process capacity. The production launcher must provide an
application-owned data directory.
