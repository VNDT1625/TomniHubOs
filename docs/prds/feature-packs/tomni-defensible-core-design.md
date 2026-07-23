# Tomni Defensible Core — Outcome Intelligence Network

> **Trạng thái:** Strategic design đề xuất  
> **Mục tiêu:** xác định lõi tích lũy giúp Tomni có chỗ đứng bền vững dù đối thủ lớn sao chép tính năng  
> **Tên hệ thống:** Tomni Outcome Intelligence Network; bộ máy vận hành là Outcome Engine

## 1. Luận điểm lõi

Home, Store, IDE, đa model, OAuth/API key/CLI và Security Layer đều cần thiết nhưng có thể bị sao chép. Chúng không tự tạo hào lũy.

Lõi phòng thủ của Tomni phải là khả năng **biến mục tiêu thành kết quả thực tế đã được xác minh**, sau đó học từ kết quả đó để chọn App, Agent Capsule, model và tool tốt hơn cho lần sau.

```text
Mục tiêu người dùng
→ hiểu bối cảnh và tiêu chí thành công
→ chọn App/Capsule/Model/Tool
→ thực thi qua Trust Layer
→ xác minh kết quả
→ học riêng trong Work Graph
→ đóng góp tín hiệu tổng hợp khi opt-in
→ xếp hạng package chính xác hơn
→ creator có phân phối và doanh thu tốt hơn
→ hệ sinh thái tạo thêm lựa chọn chất lượng
```

Tomni không cạnh tranh bằng việc sở hữu model lớn nhất. Tomni cạnh tranh bằng việc **hoàn thành công việc đúng hơn, an toàn hơn và có chi phí phù hợp hơn trên nhiều model/provider**.

## 2. Core và table stakes

| Năng lực                                        | Vai trò                                |
| ----------------------------------------------- | -------------------------------------- |
| Home, Store, IDE, installer, update và rollback | Table stakes                           |
| Đa model, OAuth, API key và CLI                 | Table stakes                           |
| Sandbox, permission, Secret Vault và E2EE       | Điều kiện để được tin dùng             |
| App/UI/Capsule package contract                 | Hạ tầng phân phối                      |
| Private Work Graph                              | Tài sản cá nhân hóa tích lũy           |
| Outcome Reputation Graph                        | Network moat dựa trên hiệu quả thực tế |
| Creator marketplace và doanh thu                | Ecosystem moat                         |
| Outcome Engine kết nối toàn bộ vòng lặp         | Product core                           |

Security là giấy phép để hoạt động. Security chỉ trở thành một phần moat khi Tomni có lịch sử đáng tin cậy, execution receipt và reputation mà package không thể tự giả mạo.

## 3. Bốn thành phần của Defensible Core

### 3.1 Outcome Engine

Bộ máy điều phối từ intent đến verified outcome.

### 3.2 Private Work Graph

Bộ nhớ công việc local-first, thuộc sở hữu người dùng và cá nhân hóa routing.

### 3.3 Outcome Reputation Graph

Mạng uy tín theo hiệu quả thật của package/Capsule/model theo từng ngữ cảnh và version.

### 3.4 Agentic Package Standard + Creator Network

Chuẩn mở giúp bên ngoài xây năng lực; marketplace tạo phân phối và vòng lặp kinh tế.

Trust Layer bao quanh cả bốn thành phần.

## 4. Outcome Engine

### 4.1 Input

Mỗi yêu cầu được chuẩn hóa thành:

- mục tiêu;
- ràng buộc;
- workspace và phạm vi dữ liệu;
- ngân sách thời gian/chi phí;
- permission tối đa;
- tiêu chí thành công;
- mức cần người dùng duyệt.

Nếu thiếu tiêu chí xác minh, Engine phải hỏi hoặc đề xuất tiêu chí; không được coi câu trả lời trôi chảy là kết quả thành công.

### 4.2 Candidate resolution

Engine tìm tổ hợp phù hợp từ:

- App Package;
- Agent Capsule;
- model/provider/CLI;
- tool và MCP;
- automation;
- agent/team configuration;
- policy và credential handle khả dụng.

Ứng viên sai compatibility, vượt quyền, thiếu entitlement, vượt budget hoặc có reputation rủi ro bị loại trước khi xếp hạng.

### 4.3 Ranking

Utility được đánh giá theo ngữ cảnh:

```text
Expected success
+ personal fit
+ evidence quality
- monetary cost
- latency
- permission risk
- failure/recovery cost
```

Người dùng luôn có thể xem lý do chọn, đổi package/model hoặc khóa lựa chọn. Outcome Engine không phải black-box bắt buộc.

### 4.4 Execution

Thực thi qua:

- Agent Mesh/orchestrator hiện có;
- Package Runtime;
- Surface/Capability Registry;
- ResourceCoordinator;
- Permission Broker;
- Secret Firewall;
- event/evidence store.

Không xây thêm một agent runtime thứ hai chỉ để tạo Outcome Engine.

### 4.5 Verification

Tùy công việc, verifier có thể là:

- schema validation;
- file/artifact tồn tại và đọc được;
- build hoặc command result;
- API confirmation;
- before/after state;
- rubric/evaluator độc lập;
- policy check;
- người dùng chấp nhận;
- quan sát không bị hoàn tác trong một khoảng thời gian.

Package không được tự tuyên bố thành công.

### 4.6 Outcome Receipt

Tomni Runtime phát hành receipt gồm:

- intent class đã giảm chi tiết;
- package/Capsule/model/tool version;
- permission category;
- verifier và kết quả;
- evidence reference;
- số lần thử;
- thời gian và chi phí;
- user accept/reject/revert;
- recovery hoặc rollback nếu có.

Receipt không chứa secret hoặc raw user payload. Receipt cục bộ chi tiết hơn bản projection dùng cho network reputation.

## 5. Private Work Graph

Work Graph liên kết:

- goal, task và success criteria;
- project, workspace và artifact;
- người, team và policy;
- app, Capsule, model, tool và connector;
- run, quyết định, lỗi, evidence và outcome;
- preference và cách làm việc;
- credential reference, tuyệt đối không chứa credential value.

### 5.1 Quyền sở hữu

- local-first;
- sync tùy chọn bằng E2EE;
- export, reset và delete được;
- có provenance và thời hạn lưu;
- query theo scope/purpose;
- package chỉ thấy projection tối thiểu được cấp quyền;
- không dùng định dạng độc quyền để khóa dữ liệu người dùng.

### 5.2 Cách phát triển

Mở rộng các primitive hiện có:

- Context Store/Composer;
- workspace và conversation state;
- task/event/evidence store;
- Agent Mesh outcomes;
- Secret Vault opaque references.

Không thay toàn bộ persistence cùng lúc. Bổ sung stable ID, provenance và graph projection theo migration riêng.

## 6. Trust Layer

Trust Layer bảo đảm agent có thể hành động nhưng không sở hữu credential hoặc vượt phạm vi.

### 6.1 Secret use

```text
Agent nhận opaque handle
→ xin capability theo purpose/target
→ trusted Main-process sink resolve secret
→ sink thực hiện fill/sign/inject
→ agent chỉ nhận receipt, không nhận giá trị
```

Secret không đi vào prompt, memory, log, event, checkpoint hoặc package output.

### 6.2 Execution trust

- package signing và publisher identity;
- manifest permission;
- isolated runtime;
- exact-target/network allowlist;
- resource quota;
- consent checkpoint;
- audit receipt;
- revoke, quarantine, rollback và kill switch.

### 6.3 Trust reputation

Security incident, permission overreach, revoke latency và recovery history ảnh hưởng reputation. Star rating không thể bù cho vi phạm trust.

## 7. Ranh giới dữ liệu

### 7.1 Luôn local hoặc E2EE

Không đưa lên Reputation Graph:

- prompt, chat và file content;
- source code và artifact;
- path, URL chi tiết và danh tính;
- secret, token, cookie và browser session;
- tool argument/output thô;
- private Work Graph;
- log có dữ liệu người dùng;
- quan hệ cá nhân/team/customer.

### 7.2 Chỉ tổng hợp khi opt-in

Có thể tạo privacy-safe projection:

- intent category mức thô;
- package/Capsule/model/runtime version;
- verifier type và pass/fail;
- latency/cost/retry đã bucket hóa;
- error class không có payload;
- permission category;
- accept/reject/revert;
- ổn định sau update.

Projection phải dùng field allowlist, pseudonymous cohort, minimum cohort size, time bucketing và privacy budget. Sản phẩm vẫn hoạt động đầy đủ bằng local Work Graph khi người dùng không opt-in.

Enterprise có thể giữ toàn bộ reputation trong tenant riêng.

## 8. Outcome Reputation Graph

Reputation không phải một điểm sao toàn cục. Nó trả lời:

> Package/Capsule phiên bản này, với loại mục tiêu, model, permission và môi trường này có xác suất thành công, chi phí và rủi ro bao nhiêu?

Nguồn tín hiệu:

- runtime-signed Outcome Receipt;
- evaluator độc lập;
- delayed revert;
- recovery/rollback;
- độ ổn định sau update;
- benchmark có thể tái lập;
- lịch sử vi phạm permission/security;
- phản hồi người dùng như tín hiệu bổ sung.

### 8.1 Chống gian lận

- không nhận self-report từ package;
- artifact/publisher/version có chữ ký;
- version mới không tự kế thừa toàn bộ uy tín;
- minimum sample và confidence interval;
- time decay khi model/runtime thay đổi;
- phát hiện Sybil và anomaly;
- audit ngẫu nhiên;
- review/star chỉ là tín hiệu phụ.

### 8.2 Công bằng cho package mới

- exploration budget;
- discovery lane cho package mới;
- hiển thị confidence;
- curated starter collection;
- quyền chọn thủ công;
- creator appeal khi ranking hoặc moderation sai.

## 9. Agentic Package Standard

Standard cần khai báo thêm ngoài metadata Store:

- intent/capability declaration;
- input/output schema;
- permission, network và data-retention policy;
- model/runtime compatibility;
- success criteria;
- evaluator hook;
- outcome/provenance event contract;
- cost/risk hint;
- signature/dependency/rollback contract;
- migration/deprecation policy.

Spec, SDK, validator và conformance suite nên mở. First-party package phải dùng cùng contract.

Chiến lược:

```text
Open protocol
+ user-owned private graph
+ proprietary routing/reputation/fraud intelligence
+ creator marketplace
```

## 10. Creator flywheel

```text
Nhu cầu thật
→ creator tạo App/Capsule trong Studio
→ chạy thử như app thật trên Home
→ sinh verified outcomes
→ Store phân phối theo hiệu quả
→ creator có người dùng và doanh thu
→ creator cải thiện package
→ Outcome Engine có thêm lựa chọn tốt
```

Creator dashboard chỉ hiển thị aggregate success rate, cost, failure class và compatibility. Creator không được truy cập dữ liệu riêng của người dùng.

Marketplace chia sẻ doanh thu cạnh tranh giúp creator có lý do ở lại. Distribution dựa trên outcome tốt tạo động lực tối ưu giá trị thật thay vì click/download.

## 11. Vì sao khó bị sao chép

Không có feature tuyệt đối không thể copy. Mục tiêu là khiến đối thủ copy UI nhưng không copy ngay được:

1. Lịch sử verified outcomes theo intent/package/version/model.
2. Mạng creator đang có doanh thu và reputation.
3. Standard đã được app bên ngoài sử dụng.
4. Private Work Graph làm routing ngày càng phù hợp với từng người/team.
5. Lịch sử trust, audit và xử lý sự cố đã được chứng minh.
6. Tính trung lập giữa model/provider/CLI, trong khi nền tảng lớn có động cơ lock-in.
7. Thói quen dùng Tomni để đi từ goal đến outcome thay vì mở từng tool.

Moat chỉ hình thành nếu vòng lặp được khởi động sớm và đo kết quả thật. Số lượng tính năng không tạo moat.

## 12. North-star metric

**Verified Useful Outcomes per Meaningful Weekly Active User — VUO/WAU**

Một outcome được tính khi:

- có success criteria;
- verifier pass hoặc user accept có evidence;
- không bị revert trong cửa sổ quan sát;
- không vi phạm policy;
- receipt hợp lệ.

Metrics hỗ trợ:

- goal → verified outcome rate;
- first-pass success;
- time/cost per outcome;
- improvement so với default routing;
- user correction/package switch;
- recovery rate;
- creator có outcome và doanh thu;
- time-to-first-success của package mới;
- concentration của ranking/doanh thu;
- gross profit per outcome;
- secret exposure incident, mục tiêu bằng 0;
- permission overreach và revoke latency;
- opt-in và privacy-filter rejection rate.

## 13. Các giả thuyết phải kiểm chứng sớm

1. Người dùng có muốn giao goal cho Engine thay vì tự mở app không?
2. Verification có phản ánh giá trị thật hay chỉ pass kỹ thuật?
3. Work Graph có cải thiện routing đủ lớn để người dùng cảm nhận không?
4. Creator có tối ưu theo outcome và kiếm được tiền không?
5. Người dùng có tin privacy boundary và receipt không?
6. Chi phí AI cho mỗi outcome có giữ được gross margin không?

Nếu người dùng luôn bỏ qua Engine và chỉ mở app thủ công, giả thuyết core chưa đạt; không được che giấu bằng tăng số app.

## 14. Failure modes và kiểm soát

| Rủi ro                                | Kiểm soát                                        |
| ------------------------------------- | ------------------------------------------------ |
| Package tối ưu metric thay vì giá trị | nhiều verifier, delayed revert, audit            |
| Telemetry làm rò dữ liệu              | local-first, allowlist projection, opt-in        |
| Cold start                            | curated first-party benchmark, confidence rõ     |
| Creator giả outcome                   | runtime-signed receipt, anti-Sybil               |
| Package cũ thống trị                  | exploration budget và new-package lane           |
| Model update làm reputation lỗi thời  | version binding và time decay                    |
| AI không xác định                     | confidence, human checkpoint, abstain, rollback  |
| Gói $20 bị lỗ do compute              | budget, fallback, BYOK và profit/outcome         |
| Người dùng không opt-in               | local intelligence vẫn hoạt động                 |
| Standard phân mảnh                    | RFC, versioning, conformance suite               |
| Big tech trợ giá/copy UI              | neutrality, creator economics và outcome history |

## 15. Quyết định đã chốt

- Defensible Core là **Outcome Engine + Private Work Graph + Outcome Reputation Graph**.
- Agentic Package Standard và Creator Marketplace là động cơ phân phối.
- Trust Layer bảo vệ và tạo evidence, nhưng không được coi là moat duy nhất.
- Không thu raw user data để xây lợi thế.
- Không hứa hiệu quả AI 100%; đo xác suất, evidence, cost và risk.
- Thành công được đo bằng verified outcomes, không bằng số app hoặc lượt đăng ký.

## 16. Tài liệu liên quan

- [Hub Agent OS Migration Design](tomni-hub-agent-os-migration-design.md)
- [Package Platform Design](tomni-package-platform-design.md)
- [Execution Roadmap](tomni-hub-agent-os-execution-roadmap.md)
- [Core research](../../../core.md)
