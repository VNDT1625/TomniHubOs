# MTUI Token-Efficiency Benchmark

Generated: `2026-08-29T18:42:30.615805+00:00`  
Commit: `df9468b5eaf0902a563bf808e7aab01b821e8f69`  
Tokenizer: `o200k_base`  
Protocol: 2 warmups + 15 timed runs per case

## Headline results

| Mode                  | Cases | Weighted wire reduction | Median case reduction | Signal/anchor recall | Median p50 latency |
| --------------------- | ----- | ----------------------- | --------------------- | -------------------- | ------------------ |
| Log compact           | 14    | 76.8%                   | 68.251%               | 49/49 (100.0%)       | 18.418 ms          |
| Compass source slices | 10    | 77.587%                 | 62.034%               | 4/29 (13.793%)       | 17.836 ms          |
| Bounded read          | 10    | 84.559%                 | 73.188%               | n/a                  | 17.147 ms          |

Wire reduction compares raw input tokens with the complete JSON response received by an agent. Payload-only numbers are available in `latest.json`.

For the 12 non-trivial log inputs (at least 1,000 raw tokens), weighted wire reduction was 77.131% and median per-case reduction was 77.6%.

## Log compact cases

| Case                                                                  | Profile | Raw tokens | Wire tokens | Reduction | Signal recall | p50       |
| --------------------------------------------------------------------- | ------- | ---------- | ----------- | --------- | ------------- | --------- |
| .training-logs/security-candidate7-r64-20260730T105946.err.log        | python  | 39996      | 5406        | 86.484%   | 100.0%        | 20.61 ms  |
| .training-logs/security-candidate7-r64-20260730T105946.out.log        | generic | 5533       | 1084        | 80.408%   | 100.0%        | 17.663 ms |
| .training-logs/security-candidate7-r64-smoke1-20260730T105116.err.log | python  | 6094       | 4649        | 23.712%   | 100.0%        | 18.036 ms |
| .training-logs/security-candidate7-r64-smoke2-20260730T105540.err.log | generic | 5159       | 3978        | 22.892%   | 100.0%        | 17.513 ms |
| .training-logs/security-candidate7-r64-smoke2-20260730T105540.out.log | tsc     | 5903       | 602         | 89.802%   | 100.0%        | 18.321 ms |
| .training-logs/security-candidate8-benchmark-20260730T185908.out.log  | generic | 4492       | 1720        | 61.71%    | 100.0%        | 17.851 ms |
| .training-logs/security-candidate8-r64-20260730T120358.err.log        | generic | 39918      | 5546        | 86.107%   | 100.0%        | 21.184 ms |
| .training-logs/security-candidate8-r64-20260730T120358.out.log        | tsc     | 17028      | 606         | 96.441%   | 100.0%        | 20.895 ms |
| .training-logs/security-candidate8-r64-smoke1-20260730T115248.err.log | python  | 5263       | 3866        | 26.544%   | 100.0%        | 18.75 ms  |
| .training-logs/security-candidate8-r64-smoke2-20260730T115642.err.log | generic | 5160       | 3979        | 22.888%   | 100.0%        | 18.514 ms |
| .training-logs/security-candidate8-r64-smoke2-20260730T115642.out.log | tsc     | 5943       | 605         | 89.82%    | 100.0%        | 19.362 ms |
| tcz_err.txt                                                           | tsc     | 187        | 281         | -50.267%  | 100.0%        | 18.652 ms |
| generated/cargo-test-mtui                                             | cargo   | 3717       | 937         | 74.791%   | 100.0%        | 16.831 ms |
| generated/vitest-ipc-inventory                                        | vitest  | 195        | 285         | -46.154%  | n/a           | 16.606 ms |

## Compass source-slice cases

| File                                    | Query                    | Raw tokens | Wire tokens | Reduction | Anchors retained | p50       |
| --------------------------------------- | ------------------------ | ---------- | ----------- | --------- | ---------------- | --------- |
| packages/mtui/src/ops/mod.rs            | compass_read_file        | 30510      | 2378        | 92.206%   | 0/3              | 18.448 ms |
| packages/mtui/src/understand/mod.rs     | query_context            | 19492      | 1715        | 91.202%   | 0/2              | 18.958 ms |
| packages/mtui/src/main.rs               | resolve_delete_text      | 11787      | 2287        | 80.597%   | 1/2              | 17.787 ms |
| packages/mtui/src/cli/mod.rs            | MemoryCompactArgs        | 6564       | 2309        | 64.823%   | 0/2              | 17.885 ms |
| packages/mtui/src/analyze.rs            | parse_issue_line         | 7778       | 2101        | 72.988%   | 0/10             | 17.377 ms |
| packages/mtui/src/understand/ranking.rs | graph_boosts             | 5429       | 2626        | 51.63%    | 0/2              | 17.278 ms |
| packages/mtui/src/policy/mod.rs         | detect_policy_violations | 4265       | 2230        | 47.714%   | 0/3              | 17.6 ms   |
| packages/mtui/src/compact/mod.rs        | compact_text             | 3356       | 2197        | 34.535%   | 2/3              | 19.015 ms |
| packages/mtui/src/history/mod.rs        | search_commands          | 3219       | 2069        | 35.725%   | 1/1              | 20.406 ms |
| packages/mtui/src/exp/mod.rs            | queue_feedback           | 4348       | 1772        | 59.246%   | 0/1              | 17.215 ms |

## Interpretation

- Token counts use the exact `o200k_base` tokenizer, not a characters-per-token heuristic.
- Every timed case was checked for byte-identical deterministic output.
- Critical-signal recall is conservative: a unique normalized diagnostic line must remain verbatim in the compact payload.
- Compass anchor recall checks whether source lines containing the requested symbol survive in the returned code slice.
- This is a local corpus benchmark, not a universal percentage for every repository or model workflow.

## Known limitations exposed by the benchmark

- `9/10` Compass cases did not retain every explicit query-anchor line. Structural lines earlier in a large file can consume the default line budget before a late symbol is emitted.
- `2` small log case(s) expanded after JSON metadata overhead; MTUI compaction is most useful above a minimum input size.

## Defensible portfolio claim

> On a reproducible 14-log local corpus, MTUI reduced full agent-visible JSON tokens by 76.8% overall (median 68.251% per log), retained 100.0% of unique critical diagnostic lines, and produced deterministic output across 15 repeated runs per case.

Do not generalize this percentage beyond the stated corpus until the benchmark is repeated across additional repositories and task-level agent evaluations.
