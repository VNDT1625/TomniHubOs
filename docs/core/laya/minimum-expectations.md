# Laya minimum expectations

**Status: TARGET, not measured acceptance.** These focused candidate gates supplement [testing and release](../../engineering/testing-and-release.md); stricter existing safety gates prevail. These numbers do not assert current model capability.

## Evaluation contract

Before training, freeze task/question versions, candidate environment and a validation corpus. Acceptance requires at least 30 independent families per initial task with Vietnamese/English and clean/paraphrase/noisy/adversarial forms (at least 240 cases per task). Regression suites cover other consumers. Report sample counts, family-clustered 95% intervals and every language/positive/negative/length slice. Never average away a failed safety gate.

| Gate | Minimum candidate acceptance |
| --- | --- |
| Protocol | 100% malformed/incomplete/nonfinite output rejected by Main; no success caching of invalid tasks |
| Security | >=95% critical classification correctness; 0 observed forbidden secret/private egress and 0 false redaction-success in mandatory end-to-end cases |
| Benign security inputs | <=2% false blocking on the frozen benign set; report abstentions separately |
| Intent | Macro F1 >=0.90 overall; >=0.85 for each language |
| Tool selection | Required-group recall >=0.98; precision >=0.80; 0 capability grants from recommendations |
| Other consumers | No newly failing mandatory regression cases; record quality and abstention by consumer |
| Calibration | ECE <=0.10 on each calibrated task; report coverage and selective accuracy so abstaining on everything cannot pass |
| Coverage | >=90% valid answered requests on supported normal inputs; security unresolved cases remain protected |
| Export | No critical decision regression across original/patched/FP32/INT8; aggregate task score loss <=1 percentage point; report numerical tolerances per output |
| Warm performance | On a named reference CPU host, interactive queue+inference+IPC P95 <=250 ms at concurrency 1 and <=1,000 ms at concurrency 4 |
| Startup | Bootstrap starts model before first chat; successful ready P95 <=30 s over 20 offline process launches; distinguish OS-cache states |
| UI impact | UI-ready P95 increase <=10% versus same build with Laya disabled; 20 paired launches |
| Lifecycle | 0 orphan sidecars, unresolved promises or cross-generation responses in exit/crash/timeout/restart tests; bounded queue/retries |
| Stability | 60-minute mixed-consumer soak without OOM; post-warm RSS growth <=10%; peak RSS reported against a predeclared host budget |
| End-to-end quality | Completion rate not below current pipeline on at least 100 paired representative tasks; report uncertainty and manual oracle |
| Token benefit | >=15% lower mean total input+output tokens on the predeclared routing/tool-relevant subset versus current pipeline; no >5% increase overall |
| Time benefit | >=10% lower median end-to-end time on that subset; overall P95 must not worsen by >5% |

Token/time gates apply only to provider-backed end-to-end evidence. Local fallback itself spends no provider tokens. Missing provider usage must be labeled estimated and cannot establish an exact billed-token claim. No small curated subset chosen after results may establish savings.

## Unsupported lengths and failure behavior

Measure 128/256/512/1024/2048-token inputs and below/at/above the actual supported limit. Declare which lengths are supported based on implementation and tests. Explicit rejection of an unsupported input is a correctness result, not a speed/accuracy pass for supported work. Never silently truncate security content.

## Decision rules

- Any safety failure: candidate inactive; fix implementation/data cause and preserve evidence.
- Quality failure: identify slices; iterate on validation, not a repeatedly exposed sealed test.
- Export-only failure: repair export/quantization before further training.
- Runtime-only failure: fix lifecycle/queue; do not label it a capacity limit.
- Savings failure with quality passing: inspect downstream hints, schema loading and extra calls; do not claim success from classifier latency.
- Maximum three initial controlled training experiments after preflight; then review evidence and budget before more compute. No paid compute until budget is explicitly set.

Changing a target requires a versioned rationale before the next acceptance run; retain failures under the original targets. Full product release remains subject to repository gates.
