# Design Document

## Overview

Thiết kế này mở rộng ResourceCoordinator, AgentJobOrchestrator/AgentMeshService và ToolSelector hiện có thành một lõi hiệu quả duy nhất.

## Architecture

## 1. Quyết định kiến trúc

Mở rộng các primitive hiện có, không tạo runtime quản lý thứ hai:

- `ResourceCoordinator` tại `packages/desktop/src/process/resource/` sở hữu probe, sampler, budget, lease, drain queue, balancing và persistence.
- `AgentJobOrchestrator`/`AgentMeshService` sở hữu lifecycle/session/dependency của agent; chỉ bổ sung adapter xin lease và nhận effective concurrency từ coordinator.
- `ToolSelector`/catalog/filter/`SelectionLog` sở hữu choice; chỉ bổ sung scoring/explanation/usage metadata và advisor gate ở lớp orchestration phù hợp.
- Renderer hiện có `ResourceDashboard`, `SystemInsightPanel`, Agent settings, MCP settings và queue panel là projection/config surface; mở rộng page-private trước, bridge typed sau.
- Main là authority; Renderer chỉ nhận snapshot/event qua IPC/preload. Không import Node từ Renderer.

Tệp dùng chung thuộc Tab 1 không được sửa. Nếu cần contract mới, tạo adapter type cục bộ trong allowlist hoặc ghi dependency/owner handoff trong decision log thay vì copy contract.

## 2. Data flow

```text
machine probe + live sampler
  -> ResourceCoordinator pressure classification
  -> effective budget/concurrency
  -> AgentJobOrchestrator submits agent lease request
  -> existing coordinator queue/drain
  -> execution plan
  -> ToolSelector catalog/rules/history
  -> optional semantic filter
  -> optional bounded AI advisor (hard cases only)
  -> candidate explanation
  -> policy/health/compatibility recheck
  -> lease-gated execution
  -> timeout/cancel/release
  -> verified outcome + usage record
  -> SelectionLog/learning projection + dashboard events
```

Choice không được tự cấp lease. Resource lease không cấp permission. Advisor không được chạy trước rule-based filtering và không được quyết định nếu không có allowlist/health/resource eligibility.

## Components and Interfaces

## 3. Thành phần và thay đổi dự kiến

### 3.1 Resource Coordinator extension

Giữ `IResourceCoordinator` làm API chính. Bổ sung có kiểm soát:

- `ResourcePressure`/reason codes và sample history bounded trong `resource` module.
- `getEffectiveLimit(kind)` hoặc projection tương đương, tính từ budget + live pressure + safety floor.
- Queue metadata bounded: request id, priority, wait age, estimated cost, timeout/cancel state.
- Lease request context optional: run/task/attempt correlation, deadline và purpose; nếu shared contract bị khóa thì adapter map bằng local metadata.
- Fairness rule: priority trước, FIFO đồng hạng, aging bounded để job thấp không starvation.
- Timeout/cancel cho pending request; promise phải settle với typed cancellation/timeout error.
- Persistence chỉ lưu cấu hình/history cần thiết; active lease không khôi phục sau restart.

`setBudget` phải validate số nguyên không âm, ceiling/reserve hợp lệ và clamp concurrency theo safety cap. Khi pressure critical, giảm effective limit chứ không âm thầm mutate manual budget; explanation phải nói rõ configured vs effective.

### 3.2 Agent integration

`AgentJobOrchestrator` vẫn là owner của session/job/dependency. Trước khi executor chạy:

1. Kiểm tra job không cancelled/deadline.
2. Xác định estimated memory/tokens/priority.
3. Xin `agent` lease từ shared coordinator.
4. Dùng effective max concurrency từ lease/budget khi submit vào existing AgentMesh.
5. `try/finally` release lease sau mọi outcome.

Nếu coordinator queue, job giữ trạng thái queued với reason và wait metadata. Timeout trong queue hủy pending request; timeout khi chạy abort executor và ghi failure. Hibernation không giữ lease. Tránh double-throttle: AgentMesh maxConcurrent là limit session, ResourceCoordinator là global/resource limit; effective value là min hai bên.

### 3.3 Choice pipeline

`ToolSelector.shortlist/select` tiếp tục là API chính. Mở rộng `ScoredEntry`/selection result hoặc projection cục bộ để có:

- factors: compatibility, availability, health, historical success, latency, money/tokens, RAM/CPU, risk;
- `reasonCode` và human explanation key + interpolation args;
- source/tier (`rule`, `keyword`, `semantic`, `recall`, `advisor`);
- rejected candidates và failure details đã redaction.

Thứ tự:

1. Lọc enabled/configured/health/compatibility và policy boundary hiện có.
2. Keyword/rule deterministic.
3. Recall successful selection nhưng revalidate mọi điều kiện.
4. Semantic rerank chỉ trên bounded set và qua `semanticIndex` lease.
5. Advisor chỉ khi no candidate đạt threshold hoặc evidence mâu thuẫn; xin `agent`/model resource budget tương ứng, có timeout/token/cost cap.
6. Attempt tối đa `maxRounds`, loại candidate fail, record outcome.

Không nạp toàn catalog vào context. Advisor output phải validate schema, reject unknown candidate ids và fallback về rule-based result.

### 3.4 Cost/time/resource accounting

Tạo usage record ở resource/choice integration boundary, không tạo database runtime mới:

```ts
type ExecutionUsage = {
  runKey?: string;
  taskKey?: string;
  attemptKey?: string;
  candidateId?: string;
  modelId?: string;
  startedAt: number;
  finishedAt?: number;
  waitMs: number;
  durationMs?: number;
  estimatedMemoryMB: number;
  peakMemoryMB?: number;
  estimatedTokens?: number;
  tokensUsed?: number;
  estimatedCost?: number;
  actualCost?: number;
  status: 'running' | 'verified' | 'failed' | 'cancelled' | 'timed_out';
};
```

Usage phải bounded/atomic/persist theo convention hiện có. Không ghi secret/prompt đầy đủ. Budget UI có thể hiển thị estimate và actual cùng dấu “estimated”.

### 3.5 Learning

`SelectionLog` được mở rộng thành outcome-aware log hoặc adapter cục bộ bao quanh nó; không tạo selection log thứ hai. Chỉ `verified` mới cập nhật success weight. Failed/cancelled/timeout cập nhật negative/neutral signal riêng. Scoring dùng decay theo age, sample count tối thiểu và condition fingerprint; recall chỉ là candidate hint.

Cần có reset/retention policy và metrics: success rate, p95 latency, average cost, resource pressure at execution, fallback count. Learning failure không chặn execution.

### 3.6 Renderer projection

Mở rộng `ResourceDashboard` page-private và các projection hook hiện có để hiển thị:

- pressure/health, configured vs effective limits;
- active/queued rows với reason, wait age, estimated cost, cancel;
- usage cost/time/tokens and budget remaining;
- choice explanation: selected candidate, factors, rejected candidates, fallback tier;
- learning summary/reset.

Các action dùng Arco (`Button`, `InputNumber`, `Select`, `Table`, `Tag`, `Tooltip`, `Alert`, `Progress`) và `@icon-park/react`; text qua i18n; semantic UnoCSS tokens only. Renderer không thao tác queue/lease trực tiếp.

## Data Models

## 4. IPC và ownership

Ưu tiên mở rộng `ipcBridge.resource`/bridge registration hiện có nếu owner cho phép. Nếu cần channel mới, đặt type/handler trong resource feature allowlist và preload registration tương ứng; không sửa shared foundation của Tab 1. Event push phải bounded, clone snapshot và unsubscribe khi unmount.

Bảng ownership:

| Khu vực | Owner | Tab 4 được làm |
|---|---|---|
| `process/resource/*` | Resource/Choice | Có, mở rộng coordinator/persistence/policy |
| `process/agentRuntime/agentMesh/*` | Agent runtime | Chỉ integration hook/adapter đã thống nhất |
| `process/toolselect/*` | Resource/Choice | Có, mở rộng explanation/metrics, giữ selector |
| Resource Settings page-private | Resource/Choice | Có |
| `common/adapter/ipcBridge.ts`, preload, i18n config | Shared/Tab 1 | Không sửa; yêu cầu owner patch hoặc dùng seam đã có |
| foundation/common contracts | Tab 1 | Không sửa |
| Agent/assistant/MCP stores | Existing owners | Chỉ đọc qua public APIs |

## Error Handling

## 5. Failure behavior

- Probe/sampler lỗi: giữ snapshot cuối có tuổi dữ liệu, dùng conservative preset/effective cap, hiển thị stale reason.
- Queue đầy: reject mới với reason dịch được, không drop job cũ.
- Lease timeout/cancel: settle requester, remove pending item, emit state, không crash Main.
- Executor lỗi/kill: release lease trong finally, record outcome, cho job khác tiếp tục.
- Candidate unavailable: reject candidate và reselect bounded.
- Advisor unavailable/invalid/over budget: log fallback reason, dùng deterministic shortlist.
- Learning persistence lỗi: warning + continue execution; không biến kết quả thành success.
- Restart: clear active/queued in-memory leases; durable job restore phải revalidate.

## Correctness Properties

### Property 1: Tổng memory lease không vượt ceiling

Validates: Requirements 2.3, 5.2

- Tổng `estCostMB` của active leases không vượt `maxTotalMemoryMB`.

**Validates: Requirements 2.3, 5.2**

### Property 2: Concurrency không vượt effective limit

Validates: Requirements 1.5, 2.2, 2.3

- Active count theo kind không vượt effective concurrency.

**Validates: Requirements 1.5, 2.2, 2.3**

### Property 3: Lease có release path

Validates: Requirements 2.5, 5.3

- Mọi granted lease có đúng một release path.

**Validates: Requirements 2.5, 5.3**

### Property 4: Máy yếu không spawn quá tải

Validates: Requirements 1.5, 3.1

- Weak-machine mode làm giảm concurrency/queue tăng, không tăng spawn rate.

**Validates: Requirements 1.5, 3.1**

### Property 5: Queue giữ fairness

Validates: Requirements 3.2, 3.4, 3.5

- Queue order giữ priority/FIFO/aging invariant và cancellation không làm kẹt queue.

**Validates: Requirements 3.2, 3.4, 3.5**

### Property 6: Advisor chỉ chạy cho hard case

Validates: Requirements 4.2, 4.3

- Advisor call rate bằng zero cho request rule-based đạt threshold.

**Validates: Requirements 4.2, 4.3**

### Property 7: Explanation nhất quán

Validates: Requirements 4.5, 7.1

- Selection explanation khớp chosen/tried/rejected ids.

**Validates: Requirements 4.5, 7.1**

### Property 8: Chỉ verified outcome học tích cực

Validates: Requirements 6.1, 6.2

- Chỉ verified outcome cập nhật positive learning signal.

**Validates: Requirements 6.1, 6.2**

### Property 9: Replay không thực thi

- Replay/log read không gọi provider, tool hoặc advisor.

**Validates: Requirements 6.3, 6.4**

## Testing Strategy

## 7. Testing strategy

- Unit Main: probe classification, budget clamp, effective limit, queue ordering/aging/cancel/timeout, lease release, persistence corruption.
- Agent contract: concurrency min calculation, queued/resume, hibernate, executor failure/abort release.
- Choice contract: deterministic ranking, recall revalidation, semantic lease, advisor gating/schema rejection, bounded reselect/explanation.
- Usage/learning: estimate vs actual, timeout/cancel status, decay, reset, redaction and bounded retention.
- Renderer DOM: dashboard states, queue/pressure/explanation controls, disabled/manual limits, i18n key coverage.
- No real provider/AI/network in unit tests; inject clock, sampler, scheduler, catalog, attempt, advisor, fs and coordinator.

## 8. Rollback and observability

Mỗi slice có feature flag/config fallback về behavior hiện có. Khi lỗi, tắt advisor/semantic first, sau đó tắt learning projection; không tắt lease gate. Log structured reason codes, queue depth, effective cap, lease lifecycle, selection tier và outcome; không log secrets.
