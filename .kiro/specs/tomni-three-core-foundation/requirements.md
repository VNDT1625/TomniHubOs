# Requirements Document

## Introduction

## Glossary

- **Run:** Một phiên thực thi có scope và identity ổn định.
- **Capability:** Quyền hạn có scope, expiry và policy decision.
- **Projection:** Dữ liệu bounded được chiếu từ một lõi sang lõi khác.
- **Receipt:** Metadata an toàn dùng để audit/replay, không chứa secret plaintext.

## 1. Phạm vi và quyết định nền

Tính năng này chỉ lập nền tảng tích hợp cho ba lõi: **Security/Trust**, **User Understanding/Work Graph**, và **Resource Coordination + Choice**. Giai đoạn này không triển khai chức năng lõi mới, không thay thế Agent Mesh, ContextStore, ResourceCoordinator, ToolSelector, Company hay Personal Manager.

Mục tiêu là chốt contract, ranh giới sở hữu tệp, thứ tự phụ thuộc và đường dữ liệu để các tab lõi triển khai tuần tự mà không sửa đè nhau.

## 2. Hiện trạng đã đối chiếu

### 2.1 Security/Trust — đã có

- Secret Firewall nhận diện/redact tại boundary agent và MCP; durable output chỉ giữ metadata an toàn.
- Secret Context dùng opaque handle, capability, surface/purpose binding; ContextComposer không nhận plaintext.
- Agent Mesh có communication grant cho control giữa agent.
- Core/PRD đã quy định Secret Vault, trusted Main sink, scope, revoke/expiry, audit không chứa secret.

### 2.2 Security/Trust — còn thiếu trong nền tảng chung

- Capability/Permission Broker thống nhất theo `runId`, `taskId`, actor, target và expiry.
- Quyết định policy trước candidate selection và trước lease/execution.
- Audit receipt end-to-end liên kết capability decision, selection, lease, execution, evidence và outcome.
- Contract cho sandbox/quarantine, signature/SBOM/package trust; không xây package runtime trong spec này.

### 2.3 User Understanding — đã có

- ContextStore lưu profile/facts/preferences/habits với confidence, provenance, scope, sensitivity và user lock.
- ContextComposer lọc theo surface, bounded output, ưu tiên fact đã xác nhận và opaque secret policy.
- IDE ContextBuilder dùng lexical/semantic ranker, knowledge graph, changed-file boost và budget giới hạn.
- Company/Personal Manager đã có các spec và primitives riêng cần được adapter hóa, không viết lại.

### 2.4 User Understanding — còn thiếu

- Work Graph thống nhất cho goal, constraint, success criteria, task, artifact, evidence, decision và outcome.
- Projection từ context/work graph sang routing; không biến inferred facts thành quyền hoặc quyết định ngầm.
- Outcome receipt và opt-in learning/reputation; chưa được tạo thành graph mới trong giai đoạn này.

### 2.5 Resource Coordination và Choice — đã có

- ResourceCoordinator có per-kind concurrency, total memory ceiling, priority/FIFO queue, lease release, idle hook và balancing mode.
- ToolSelector có shortlist top-k, optional semantic rerank, try/reselect và SelectionLog recall.
- Company pipeline đã định hướng dùng `agent` lease; feature-pack PRD đã yêu cầu `pack-io` lease.

### 2.6 Resource/Choice — còn thiếu

- Unified candidate policy/ranking contract kết hợp capability eligibility, user fit, success evidence, cost, latency, compatibility và risk.
- Choice explanation có thể audit và hiển thị cho user.
- Run/task/event identity chung để liên kết selection với lease và outcome.
- Fairness/starvation và cancellation semantics ở boundary tích hợp; không sửa algorithm ResourceCoordinator trong spec này.

## Requirements

### Requirement 1: Chuẩn hóa một run

**User Story:** Là hệ thống, tôi muốn mọi yêu cầu có identity và scope thống nhất.

#### Acceptance Criteria

**User story:** Là hệ thống, tôi muốn mọi yêu cầu có identity và scope thống nhất để ba lõi trao đổi được mà không trộn dữ liệu.

#### Acceptance criteria
1. Mỗi run có `runId`, `rootTaskId`, `surface`, `workspaceScope`, `userId`, `createdAt`, `policyVersion` và `correlationId`.
2. Mỗi task/attempt/event có identity ổn định, parent relation và idempotency key.
3. Run state không chứa credential plaintext; secret chỉ là opaque reference/capability.
4. Contract phải hỗ trợ replay/audit mà không cần gọi lại provider hay tool.

### Requirement 2: Context tạo hiểu biết, không tạo quyền

**User Story:** Là hệ thống, tôi muốn context hỗ trợ hiểu người dùng nhưng không tự cấp quyền.

#### Acceptance Criteria

1. User request, explicit constraints, context projection và work graph projection được phân biệt.
2. Explicit request luôn thắng context khi xung đột.
3. Fact inferred/observed phải giữ provenance/confidence và không tự cấp permission.
4. Context output có budget, surface scope và redaction; lỗi composer không làm lộ secret.

### Requirement 3: Security chặn trước lựa chọn và thực thi

**User Story:** Là hệ thống, tôi muốn policy chặn hành động không được phép trước khi chạy.

#### Acceptance Criteria

1. Candidate chỉ được xếp hạng sau capability/policy preflight.
2. Mỗi execution phải có scoped capability decision gắn với run/task/target, expiry và revoke path.
3. Lease không đồng nghĩa permission; phải kiểm tra cả resource và trust policy.
4. Tất cả deny/approval/expiry/revoke được ghi receipt an toàn.

### Requirement 4: Choice giải thích được và có thể phục hồi

**User Story:** Là người dùng, tôi muốn lựa chọn có lý do và có thể thử candidate khác khi thất bại.

#### Acceptance Criteria

1. Selector trả candidate shortlist, score factors, policy filters, selected candidate và reason.
2. Selector được dùng lại từ ToolSelector/SelectionLog; không tạo selector thứ hai.
3. Failure có thể loại candidate và reselect trong bound; không lặp vô hạn.
4. Outcome chưa verified không được ghi như success signal.

### Requirement 5: Resource lease là cổng điều phối duy nhất

**User Story:** Là hệ thống, tôi muốn mọi thực thi tôn trọng budget và lease chung.

#### Acceptance Criteria

1. Agent/tool/test/pack IO khai báo `TaskKind` và ước lượng chi phí trước khi chạy.
2. Mọi execution release lease trong success, failure, timeout và cancellation.
3. Queue order, starvation, timeout và cancellation được thể hiện trong event/receipt.
4. ResourceCoordinator vẫn là nguồn sự thật cho budget; không thêm semaphore song song.

### Requirement 6: Ba lõi trao đổi qua Run Kernel contract

**User Story:** Là hệ thống, tôi muốn ba lõi trao đổi qua contract ổn định thay vì import implementation private.

#### Acceptance Criteria

1. Security nhận `RunIntent` và trả `PolicyDecision`.
2. Understanding nhận intent + allowed context scope và trả `ContextProjection`/`WorkGraphProjection`.
3. Choice nhận candidate catalog + projections + policy decision và trả `SelectionDecision`.
4. Resource nhận selected execution plan + cost estimate và trả lease.
5. Execution emits evidence/outcome; receipt cập nhật Work Graph và selection log theo opt-in/policy.
6. Không lõi nào import implementation private của lõi khác; chỉ dùng common contracts và adapters.

## 4. Ngoài phạm vi

- Không implement Outcome Engine đầy đủ, package marketplace, sandbox runtime, new database schema, UI mới, provider adapter mới hay migration hàng loạt.
- Không sửa Agent Mesh, ContextStore, ContextBuilder, ResourceCoordinator hoặc ToolSelector trong giai đoạn thiết kế.
- Không làm việc thay tab Security, User Understanding, Resource/Choice; tab foundation chỉ sở hữu contract và integration seam.

## 5. Phụ thuộc và thứ tự

1. Common run/event/receipt types.
2. Security policy/capability decision contract.
3. Context/work graph projection contract.
4. Candidate/selection/explanation contract.
5. Resource execution-plan/lease adapter.
6. Run Kernel integration seam.
7. Renderer projection/bridge chỉ sau khi Main contracts ổn định.

Mỗi bước phải có unit/contract tests và tài liệu trước khi bước kế tiếp bắt đầu.
