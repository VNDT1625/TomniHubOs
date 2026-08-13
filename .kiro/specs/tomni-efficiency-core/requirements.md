# Requirements Document

## Introduction

Tomni Efficiency Core mở rộng các primitive ResourceCoordinator và ToolSelector hiện có để điều phối an toàn, giải thích được và tiết kiệm tài nguyên.

## Glossary

- **Coordinator:** `ResourceCoordinator`, nguồn sự thật duy nhất cho budget và lease.
- **Lease:** quyền giữ một phần ngân sách tài nguyên trong thời gian chạy tác vụ.
- **Effective limit:** giới hạn sau khi kết hợp cấu hình người dùng, session và áp lực máy.
- **Advisor:** AI tùy chọn chỉ dùng cho trường hợp khó sau rule-based selection.
- **Verified outcome:** kết quả đã qua verification policy và được phép làm tín hiệu học.

## 1. Mục tiêu và phạm vi

Tomni Efficiency Core mở rộng `ResourceCoordinator` hiện có thành nguồn sự thật duy nhất cho điều phối tài nguyên và lựa chọn thực thi. Không tạo resource manager, scheduler, semaphore hoặc tool selector thứ hai.

Phạm vi gồm sáu năng lực hoàn chỉnh:

1. Đọc tình trạng máy và áp dụng mức an toàn.
2. Giới hạn tác nhân chạy đồng thời.
3. Xếp hàng công việc khi không đủ tài nguyên.
4. Chọn AI, công cụ và gói phù hợp bằng quy tắc/số liệu trước, AI chỉ là phương án khó.
5. Kiểm soát thời gian, chi phí và mức dùng tài nguyên.
6. Học từ kết quả thực tế có kiểm soát, không biến kết quả chưa xác minh thành tín hiệu thành công.

Mọi năng lực phải có xử lý Main, projection trạng thái cho Renderer, giới hạn do người dùng điều chỉnh, giải thích quyết định, kiểm thử, đa ngôn ngữ và tài liệu.

## 2. Hiện trạng làm nền

- `packages/desktop/src/process/resource/resourceCoordinator.ts` đã có probe máy, budget theo `TaskKind`, tổng RAM, reserve cho người dùng, lease, priority/FIFO queue, idle hook, preset, balancing loop và persistence.
- `leaseTypes.ts` đã định nghĩa các loại tác vụ nặng, request/lease/state.
- `resourceBridge.ts` và `ResourceSettings/ResourceDashboard.tsx` đã có đường trạng thái máy, budget, active/queued activity, preset, mode và adjustment history.
- `AgentJobOrchestrator`/`AgentMeshService` đã có session, dependency, priority, `maxConcurrent`, hibernate và token usage; phải được điều chỉnh để dùng resource gate chung, không thay thế bằng scheduler mới.
- `toolselect/catalog.ts`, `keywordFilter.ts`, `semanticFilter.ts`, `toolSelector.ts`, `selectionLog.ts` đã có catalog, keyword trước semantic, top-k, retry/reselect và recall.
- Agent/assistant/MCP catalog và các cấu hình hiện có là nguồn candidate/config; không tạo catalog song song.
- System Insight đã có static profile, live metrics và process priority projection; cần tái sử dụng khi bổ sung tín hiệu tải.

## 3. Nguyên tắc bất biến

- ResourceCoordinator là cổng duy nhất trước mọi tác vụ nặng; luôn release lease trong success, failure, timeout và cancellation.
- Khi máy yếu hoặc đang chịu tải, giảm effective concurrency và đưa việc vào queue; không spawn thêm để rồi làm treo ứng dụng.
- Lease chỉ biểu thị tài nguyên, không cấp quyền. Policy/permission vẫn kiểm tra ở boundary hiện có.
- Quyết định thông thường dùng số liệu máy, budget, compatibility, lịch sử thành công, latency và cost. Không gọi AI để quyết định các trường hợp có thể giải bằng rule.
- Mọi quyết định chọn AI/tool/package phải trả lý do, factors, candidates bị loại và dữ liệu đã dùng.
- Queue có giới hạn, thứ tự ổn định, cancellation và timeout; không để promise chờ vô hạn.
- State/event/log không chứa credential hay prompt nhạy cảm vượt giới hạn đã được redaction.
- Không sửa file thuộc Tab 1: shared foundation/common contracts, bootstrap/navigation hoặc file ownership được xác nhận riêng. Các thay đổi IPC/i18n chung phải được giao diện/owner phê duyệt trước.

## Requirements

## 4. User stories và acceptance criteria

### Requirement 1: Quan sát máy

**User Story:** Là hệ thống, tôi muốn đọc profile tĩnh và áp lực sống để chọn mức chạy an toàn.

#### Acceptance Criteria

1. Probe phải trả RAM tổng, CPU cores, GPU khả dụng, disk trống và nguồn thời gian đo.
2. Sampler phải cung cấp CPU/RAM/pressure theo chu kỳ, xử lý lỗi và dữ liệu thiếu theo hướng an toàn.
3. Coordinator phải phân loại tối thiểu `healthy`, `constrained`, `critical`, kèm reason code và timestamp.
4. Dashboard hiển thị profile, metrics, mức áp lực, budget effective và cảnh báo queue; không hiển thị dữ liệu chưa xác nhận như chắc chắn.
5. Khi `critical`, effective concurrency của agent và tác vụ nặng giảm về mức an toàn cấu hình; tác vụ mới xếp hàng.

### Requirement 2: Giới hạn agent đồng thời

**User Story:** Là người dùng, tôi muốn đặt giới hạn tác nhân nhưng không thể vượt giới hạn máy.

#### Acceptance Criteria

1. Agent run phải xin `agent` lease trước khi executor spawn/chạy.
2. Effective limit là min của user budget, session/request cap, global safety cap và live resource cap.
3. Không được chạy quá `maxConcurrent` theo session hoặc tổng budget; các job còn lại có trạng thái queued.
4. UI cho phép chỉnh giới hạn theo mode/preset và hiển thị configured/effective limit cùng lý do chênh lệch.
5. Agent job phải release lease khi hoàn tất, lỗi, abort, timeout hoặc process bị hibernate.

### Requirement 3: Queue chống quá tải

**User Story:** Là người dùng, tôi muốn việc được chờ có thứ tự thay vì làm ứng dụng treo.

#### Acceptance Criteria

1. Queue dùng cơ chế drain của ResourceCoordinator; không thêm queue scheduler riêng cho agent/tool.
2. Thứ tự ưu tiên cao trước, cùng ưu tiên FIFO; không để priority thấp bị đói vô hạn.
3. Mỗi queued item có id, kind, priority, created/enqueued time, estimated cost, reason, timeout và cancellation state.
4. UI hiển thị active, queued, blocked reason, estimated wait nếu có, và cho phép cancel/reorder chỉ trong phạm vi policy.
5. Queue có bounded capacity; khi đầy phải trả lỗi có thể dịch và không làm mất các job đã nhận.
6. Restart không tự khôi phục lease đang chạy; job durable chỉ resume qua cơ chế AgentJobStateStore hiện có và phải re-check resource.

### Requirement 4: Chọn AI, tool và package

**User Story:** Là hệ thống, tôi muốn chọn candidate phù hợp, tiết kiệm và giải thích được.

#### Acceptance Criteria

1. Dùng catalog và `ToolSelector` hiện có; không tạo selector mới.
2. Pipeline mặc định: eligibility/config/health -> keyword/rule ranking -> lịch sử thành công -> optional semantic rerank -> bounded attempt/reselect.
3. Chỉ gọi AI advisor khi ambiguity, conflicting evidence hoặc không có candidate rule-based đạt ngưỡng; advisor bị giới hạn token/cost/time và không được tự bypass policy/resource.
4. Candidate scoring phải xét capability/compatibility, expected success, latency, monetary cost, token cost, RAM/CPU estimate, package availability và risk.
5. Kết quả trả candidate shortlist top-k, chosen, tried, rejected reasons, factor values, explanation, selector tier và fallback plan.
6. Tool/package failure phải loại candidate trong bound và reselect; không retry vô hạn.
7. UI cho phép xem “vì sao chọn”, dữ liệu đầu vào, candidate bị loại và nút điều chỉnh ưu tiên/cost ceiling nếu user có quyền.

### Requirement 5: Thời gian, chi phí và mức dùng

**User Story:** Là người dùng, tôi muốn kiểm soát ngân sách và ngăn tác vụ chạy quá lâu.

#### Acceptance Criteria

1. Mỗi execution plan khai báo deadline/timeout, estimated tokens, estimated cost, estimated memory và priority.
2. Coordinator/agent execution ghi start, wait, run, end, active memory estimate, token/cost usage và outcome.
3. Timeout phải abort executor, release lease, cập nhật queue/event và không làm crash Main.
4. Budget gồm concurrency, memory ceiling, user reserve; budget cost/time có thể đặt ở lớp selection/execution mà không phá ResourceCoordinator contract.
5. UI hiển thị usage hiện tại, budget còn lại, over-budget reason và cho phép chỉnh limit với validation.
6. Preset saver/balanced/performance phải làm thay đổi rõ effective concurrency/model/tool policy.

### Requirement 6: Học từ kết quả thực tế

**User Story:** Là hệ thống, tôi muốn cải thiện lựa chọn từ kết quả đã xác minh.

#### Acceptance Criteria

1. Chỉ ghi success signal khi outcome được xác minh theo verification policy; failed/cancelled/timed-out được ghi riêng.
2. Learning record liên kết request fingerprint, candidate, model/package version, conditions, latency, cost, resource usage, outcome và timestamp.
3. Dùng `SelectionLog` hiện có làm persistence/recall seam; log có giới hạn kích thước, atomic write và redaction.
4. Recall không được bỏ qua health, compatibility, policy hoặc resource check hiện tại.
5. Số liệu mới phải decay/weight theo thời gian và điều kiện; không để một lần thành công bất thường thống trị mãi.
6. UI hiển thị dữ liệu học và cho phép xóa/reset learning data; mọi text đi qua i18n.

### Requirement 7: Trạng thái, i18n, test và tài liệu

**User Story:** Là người dùng, tôi muốn trạng thái, giới hạn, lựa chọn và kết quả được hiển thị rõ ràng, đa ngôn ngữ và kiểm thử được.

#### Acceptance Criteria

1. Main cung cấp typed projection qua bridge hiện có; Renderer không import Node/Main implementation.
2. UI dùng Arco và `@icon-park/react`, UnoCSS semantic tokens, không raw interactive HTML/hardcoded colors.
3. Tất cả text mới có key trong module resource/agent/tool/monitor phù hợp và có locale cho các ngôn ngữ được cấu hình.
4. Unit/contract tests bao phủ lease invariant, weak-machine throttling, queue ordering/cancel/timeout, selection explanation, advisor gating, budget accounting và learning validation.
5. Tài liệu phải mô tả ownership, data flow, knobs, reason codes, failure/rollback và cách đo trước/sau.

## 5. Ngoài phạm vi

- Không tạo ResourceCoordinator thứ hai, Agent scheduler thứ hai hoặc ToolSelector thứ hai.
- Không thay Agent Mesh, Company, Personal Manager, MCP registry hay provider implementation.
- Không xây package marketplace/install runtime mới.
- Không sửa shared foundation do Tab 1 quản lý; chỉ tạo adapter/file thuộc allowlist của Tab 4 sau khi owner xác nhận.
- Không dùng AI cho mọi quyết định mặc định.
