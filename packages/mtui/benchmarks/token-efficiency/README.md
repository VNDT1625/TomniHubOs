# MTUI token-efficiency benchmark

This benchmark compares raw repository/log input with the payload and complete
JSON output produced by MTUI. Token counts use `tiktoken`'s `o200k_base`
encoding. It also measures deterministic output, end-to-end CLI latency,
diagnostic-signal retention, and Compass query-anchor retention.

The checked-in corpus manifest combines:

- real local ML training and validation logs under `.training-logs`;
- a real TypeScript diagnostic log (`tcz_err.txt`);
- fresh output from the MTUI Cargo test suite;
- fresh output from a focused TomniHubOS Vitest test;
- ten MTUI source files with early, middle, and late-file symbol queries.

## Run

Build and verify MTUI first:

```powershell
cd packages/mtui
cargo test --locked
cargo build --release --locked
```

Install the tokenizer in an isolated directory and run the benchmark:

```powershell
$benchmarkDeps = Join-Path $env:TEMP 'mtui-benchmark-pydeps'
python -m pip install --target $benchmarkDeps tiktoken==0.11.0
$env:PYTHONPATH = $benchmarkDeps
python benchmarks/token-efficiency/benchmark.py
```

Each case uses two warmups followed by 15 timed invocations by default. Results
are written to `results/latest.json` and `results/latest.md`.

Use `--ablations` to include a paired uncompacted baseline and fresh-process
ablation for each named MTUI reduction stage. The environment override is
benchmark-only (`MTUI_BENCHMARK_ABLATION=1`) and is ignored during normal use.

## Interpretation rules

- Prefer **wire token reduction** for external claims. It includes all JSON
  metadata received by the agent, not only the compacted `text` field.
- Scope every percentage to the tested corpus and commit.
- Signal recall requires verbatim retention of unique normalized diagnostic
  lines and is deliberately conservative.
- Compass anchor recall requires lines containing the explicit query symbol to
  survive the returned code slice.
- Do not claim end-to-end agent task savings until a paired agent evaluation is
  run with fixed model, prompt, repository commit, and task success criteria.
