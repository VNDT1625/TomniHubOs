# Tomny Defensible Core — Outcome Intelligence Network

> **Design conformance:** [Tomny Hub OS Visual Design System](tomni-hub-visual-design.md) là nguồn
> sự thật cho typography, glass, spacing, control, popup và responsive. Mock ASCII bên dưới
> chỉ mô tả information architecture; không được dùng để tạo một visual system khác.


> **Trạng thái:** Strategic design đề xuất  
> **Mục tiêu:** xác định lõi tích lũy giúp Tomny có chỗ đứng bền vững dù đối thủ lớn sao chép tính năng
> **Tên hệ thống:** Tomny Outcome Intelligence Network; bộ máy vận hành là Outcome Engine

## 1. Luận điểm lõi

Home, Store, IDE, đa model, OAuth/API key/CLI và Security Layer đều cần thiết nhưng có thể bị sao chép. Chúng không tự tạo hào lũy.

Lõi phòng thủ của Tomny phải là khả năng **biến mục tiêu thành kết quả thực tế đã được xác minh**, sau đó học từ kết quả đó để chọn App, Agent Capsule, model và tool tốt hơn cho lần sau.

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

Tomny không cạnh tranh bằng việc sở hữu model lớn nhất. Tomny cạnh tranh bằng việc **hoàn thành công việc đúng hơn, an toàn hơn và có chi phí phù hợp hơn trên nhiều model/provider**.

## 2. Core và table stakes

| Năng lực                                        | Vai trò                                |
| ----------------------------------------------- | -------------------------------------- |
| Home, Store, IDE, installer, update và rollback | Table stakes                           |
| Đa model, OAuth, API key và CLI                 | Table stakes                           |
| Sandbox, permission, Secret Vault và E2EE       | Điều kiện để được tin dùng             |
| App/UI/Capsule package contract                 | Hạ tầng phân phối                      |
| Private Work Graph                              | Tài sản cá nhân hóa tích lũy           |
| User Understanding Core                       | Product core cá nhân hóa theo bối cảnh |
| Efficiency Orchestrator                       | Product core tối ưu verified outcome   |
| Outcome Reputation Graph                        | Network moat dựa trên hiệu quả thực tế |
| Creator marketplace và doanh thu                | Ecosystem moat                         |
| Outcome Engine kết nối toàn bộ vòng lặp         | Product core                           |

Security là giấy phép để hoạt động. Security chỉ trở thành một phần moat khi Tomny có lịch sử đáng tin cậy, execution receipt và reputation mà package không thể tự giả mạo.

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
User Understanding Core là reasoning layer nối Private Work Graph với Outcome Engine; nó không thay đổi bốn tài sản tạo moat ở trên.
Efficiency Orchestrator là policy layer tối ưu cách Outcome Engine dùng bốn thành phần; nó không phải thành phần moat thứ năm hay scheduler thứ hai.

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

Tomny Runtime phát hành receipt gồm:

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

## 6. Security Core — Privacy Compiler

Security Core bảo đảm agent có thể hành động nhưng external model không nhận secret, danh tính hoặc quan hệ dữ liệu không cần thiết. Nó hoạt động như một **Privacy Compiler**: tạo projection tối thiểu vẫn đủ để hoàn thành mục tiêu, thay vì block dữ liệu ngay khi phát hiện rủi ro.


> **Trạng thái:** normative target design. Các primitive hiện có như Secret Vault, Secret
> Firewall, OCR/extraction và Permission Broker được mở rộng theo contract này; không tạo một
> security runtime thứ hai.

Quyết định chuẩn:

```text
Dữ liệu an toàn, tối thiểu                         → ALLOW
Có thể ẩn/tách dữ liệu mà vẫn hoàn thành nhiệm vụ → TRANSFORM_AND_ALLOW
Cần người dùng chọn phạm vi                        → ASK
Chỉ có thể xử lý an toàn tại máy                   → LOCAL_ONLY
Không tồn tại projection an toàn hoặc vượt quyền   → BLOCK
```

`BLOCK` là phương án cuối. Phát hiện dữ liệu nhạy cảm đơn thuần phải ưu tiên biến đổi và tiếp tục
công việc.

### 6.1 Bất biến bảo mật

- Mọi payload rời máy đều đi qua cùng một egress gate, bất kể nguồn là Chat, Agent Capsule, App
  Package, CLI, MCP, browser automation hay background worker.
- Mọi egress đều qua backend deterministic; semantic verifier local chỉ bắt buộc với dữ liệu mới chưa có receipt, screenshot và candidate ngữ cảnh/linkability chưa được policy giải quyết.
- Secret được thay bằng capability handle; plaintext không đi vào external prompt.
- Dữ liệu cá nhân được tách thành thuộc tính cần cho nhiệm vụ và liên kết định danh không cần thiết.
- Model local không được đọc Vault plaintext, cấp permission, mở network hoặc nới policy.
- Lỗi, timeout, thiếu model hoặc output sai schema không được âm thầm chuyển thành `ALLOW`.
- Biến đổi phải bảo toàn mục đích nghiệp vụ của yêu cầu.

### 6.2 Data Territory, pre-label và ba choke point

#### Data Territory

Trong onboarding hoặc lần đầu một workspace cần dùng file, Tomny xin quyền đọc đối với **folder do
người dùng chọn rõ ràng**. Không mặc định quét toàn bộ ổ đĩa. Các root đã cấp quyền tạo thành Data
Territory của workspace.

```text
User chọn folder
→ Permission Broker cấp read scope
→ initial inventory theo quota
→ extract/OCR local
→ Layer 1 classify
→ khi cần, Layer 2 semantic classify
→ lưu Data Label + Security Receipt theo content hash
→ filesystem watcher theo dõi create/modify/move/delete
```

File mới hoặc thay đổi trực tiếp trong Territory được đưa vào background queue để gắn nhãn. Label
không chỉ ghi file “có/không có dữ liệu nhạy cảm”; nó lưu category, span/bounding box, sensitivity,
linkability, task-neutral transformation options, extraction/model/policy version và content hash.
Raw content không được sao chép vào label database.

Receipt mất hiệu lực khi content hash, extraction version hoặc policy thay đổi. File ngoài Territory
được scan on-demand trước lần egress đầu tiên. File chưa scan không được mặc định coi là safe.

Initial inventory không đọc đồng thời toàn bộ Territory. Nó ưu tiên file người dùng/agent sắp dùng,
file mới và file nhỏ; phần còn lại scan nền theo quota. Watcher debounce/coalesce nhiều write của cùng
file, chỉ scan khi kích thước/mtime đã ổn định. Folder sinh dữ liệu lớn như cache, build output hoặc
`node_modules` có thể bỏ khỏi pre-scan nhưng không khỏi egress gate: nếu agent thực sự đọc chúng,
Tomny vẫn scan on-demand trước khi gửi ra ngoài.

#### Ba choke point

1. **User prompt/input:** backend scan text ngay khi gửi. User input được serialize nên tải thấp;
   Layer 2 chỉ chạy khi có ngữ nghĩa/linkability chưa giải quyết hoặc policy yêu cầu.
2. **Agent/tool output:** stdout, stderr, command result, browser result và generated text đi qua
   Layer 1 trước khi được thêm vào external context. Output trỏ tới file dùng Data Label/Receipt;
   output ngoài ý muốn chưa có label được scan như dữ liệu mới.
3. **Screen capture và visual payload:** mỗi ảnh mới chạy OCR/QR/metadata và hard detector local,
   sau đó bắt buộc qua local vision-semantic review trước khi egress. Redact theo bounding box,
   rasterize và re-scan; không gửi ảnh gốc chỉ vì OCR không thấy chữ.

Agent/subagent trao đổi nội bộ không tạo model job nếu dữ liệu không rời máy. External model call chỉ
được mở bằng receipt từ đúng choke point; first-party package không có đường tắt.

#### Pipeline quyết định

```text
Prompt / output / screenshot / file reference
  ↓
Data Label + receipt còn hiệu lực?
  ├─ Có → lấy projection đã duyệt
  └─ Không → Normalize + extract/OCR → Backend Layer 1
                                      ↓
                         detect entity + hard policy
                                      ↓
                         Deterministic Transformer
                                      ↓
               Còn ngữ nghĩa/linkability chưa giải quyết?
                    ├─ Có → Qwen3.5-0.8B local
                    └─ Không → Policy Engine
                                      ↓
                         bounded transform + re-scan
                                      ↓
ALLOW / TRANSFORM_AND_ALLOW / ASK / LOCAL_ONLY / BLOCK
```

Qwen chỉ trả classification và transformation plan có schema; backend áp dụng thay đổi. Projection
được quét lại tối đa một vòng. Egress chỉ mở khi Policy Engine nhận receipt hợp lệ.

### 6.3 Backend Security Layer 1

Layer 1 deterministic, audit được và có quyền ưu tiên cao nhất. Nó xử lý:

- API key, password, token, cookie, private key và credential format;
- secret fingerprint, alias và Vault mapping đã biết;
- email, số điện thoại, định danh chính phủ, tài khoản và dữ liệu tài chính;
- permission, workspace boundary, target allowlist và retention policy;
- OCR text, QR/barcode, metadata ảnh/tệp và document extraction;
- file type, archive nesting, encryption, macro/executable và resource budget;
- policy bắt buộc của user, workspace, enterprise và package manifest.

Layer 1 có thể `BLOCK` ngay khi hành vi vượt quyền hoặc bị hard policy cấm. Riêng việc tìm thấy dữ
liệu nhạy cảm phải ưu tiên tạo safe projection.

### 6.4 Qwen3.5-0.8B Security Layer 2

Qwen3.5-0.8B là semantic verifier local mặc định cho candidate cần hiểu ngữ cảnh, screenshot và
dữ liệu mới chưa thể gắn nhãn chắc chắn. Receipt hợp lệ không gọi lại model. Contract không khóa vendor.

Model nhận ra:

- PII diễn đạt tự nhiên mà rule/regex không thấy;
- nhiều thuộc tính riêng lẻ khi ghép lại có thể tái nhận diện;
- quan hệ giữa danh tính, hành vi, vị trí, thời gian, tổ chức và sở thích;
- dữ liệu task-required so với ngữ cảnh thừa;
- prompt injection, social engineering hoặc yêu cầu lấy plaintext từ Vault;
- ngữ cảnh bí mật trong OCR, document, source code và nội dung doanh nghiệp.

Cấu hình mặc định:

- chạy hoàn toàn local, không có network permission;
- non-thinking classifier path;
- context 4K–8K theo chunk, không nạp toàn bộ Work Graph;
- constrained JSON output;
- model pack được ký, versioned, cập nhật và rollback độc lập;
- model missing/crash/timeout chuyển `ASK` hoặc `LOCAL_ONLY`, không bypass.

Qwen không được resolve handle, đọc/ghi Vault, sửa permission, tự gửi network hoặc tự viết lại
prompt rồi yêu cầu hệ thống tin không kiểm chứng.

Security envelope chỉ gồm content/projection cần xét, source, purpose, destination class, actor
scope, entity category, linkability, policy version và phép biến đổi được cho phép. Nó không chứa
plaintext secret, toàn bộ private profile, dữ liệu ngoài workspace hay stable user ID xuyên
provider.

Output bắt buộc:

```yaml
decision: transform_and_allow
risk: 24
confidence: 0.97
categories: [identity, coarse_location, preference]
reasonCodes: [REMOVE_DIRECT_IDENTITY, RETAIN_TASK_REQUIRED_LOCATION]
transformations:
  - entityId: IDENTITY_1
    action: remove
  - entityId: LOCATION_1
    action: retain
  - entityId: PREFERENCE_1
    action: retain
egressFields: [sanitized_content]
policyVersion: security-policy-v1
modelVersion: qwen3.5-0.8b-security-v1
```

### 6.5 Privacy Transformer và selective disclosure

Qwen đề xuất; backend chỉ thực thi tập phép biến đổi hữu hạn:

Hard detector chỉ tạo **entity candidate**, không tự quyết định che dựa trên chuỗi trùng khớp.
Mỗi candidate được Policy Engine đánh giá theo bốn trục:

- `sensitivity`: bản thân dữ liệu nhạy cảm đến đâu;
- `linkability`: có thể liên kết tới danh tính cụ thể hay không;
- `necessity`: có cần để hoàn thành purpose hiện tại hay không;
- `destinationTrust`: dữ liệu chuẩn bị đi tới đâu và retention thế nào.

Ví dụ `Hồ Chí Minh`, `Ho Chi Minh City` và `TP.HCM` có thể được normalize về cùng entity location,
nhưng việc match không đồng nghĩa phải che:

| Nội dung và purpose | Hành động |
| --- | --- |
| “Tôi yêu Hồ Chí Minh” trong trò chuyện chung | giữ; không có direct identity |
| “Tìm món ăn ở Hồ Chí Minh” | giữ vì task-required |
| “Nguyễn Văn A ở Hồ Chí Minh, tìm món ăn” | bỏ tên, giữ thành phố |
| địa chỉ nhà đầy đủ nhưng chỉ cần gợi ý theo thành phố | generalize về Hồ Chí Minh |
| danh tính + vị trí chính xác + thời gian hiện tại | unlink, hỏi hoặc local-only |

Chỉ hard secret có invariant rõ như credential plaintext mới tự động chuyển sang Vault/capability.
PII và dữ liệu ngữ cảnh phải qua purpose-aware policy; nếu backend không đủ chắc chắn mới chuyển
candidate đó tới Qwen, không gửi toàn bộ prompt để phân tích lại.

| Phép biến đổi | Mục đích |
| --- | --- |
| `retain` | Giữ thuộc tính thật sự cần cho nhiệm vụ |
| `remove` | Xóa định danh/ngữ cảnh không cần thiết |
| `mask` | Che một phần nhưng giữ format cần thiết |
| `generalize` | Giảm độ chính xác, ví dụ địa chỉ → thành phố |
| `pseudonymize` | Thay người/tổ chức bằng nhãn theo request |
| `vault_reference` | Lưu/tìm secret và thay bằng capability handle |
| `local_tool` | Giữ giá trị local và thực hiện tại trusted sink |
| `summarize_safe` | Tạo mô tả không còn chi tiết nhạy cảm |

Pseudonym phải theo request/purpose, không ổn định xuyên provider để tránh trở thành tracking ID.
Mỗi phép biến đổi giữ source span và reason code để audit nhưng receipt không lưu plaintext.

Security Core phân biệt **độ nhạy** với **khả năng liên kết tới một người cụ thể**.

```text
Input:
“Tôi là Nguyễn Văn A, sống tại Hồ Chí Minh và thích món cay.
Hãy tìm món phù hợp.”

Safe projection:
“Người dùng đang ở Hồ Chí Minh và thích món cay.
Hãy đề xuất món ăn phù hợp.”
```

`Hồ Chí Minh` và `món cay` được giữ vì cần cho nhiệm vụ. Tên, account, stable user ID và dữ liệu
không liên quan bị loại. Model ngoài hiểu đủ để làm việc nhưng không biết người dùng là ai.

| Mức | Ví dụ | Policy mặc định |
| --- | --- | --- |
| `public` | dữ liệu công khai | allow nếu đúng purpose |
| `internal` | dữ liệu dự án không định danh | allow theo workspace |
| `personal` | sở thích/vị trí thô chưa gắn danh tính | retain tối thiểu hoặc generalize |
| `secret_high` | danh tính + hành vi/vị trí/thời gian/sở thích | unlink, pseudonymize hoặc local-only |
| `critical` | credential, tài chính, y tế, sinh trắc học, ID chính phủ | vault/local tool; cấm egress plaintext |

Nhiều field `personal` phải được nâng thành `secret_high` khi tổ hợp có thể tái nhận diện.

### 6.6 Secret-to-capability contract

Nếu secret đã có trong Vault:

```text
sk-live-... → secret-ref://request-scoped-handle
```

Nếu chưa có:

```text
Detect → lưu OS-encrypted Vault → tạo handle → thay plaintext
```

Handle phải opaque, ngắn hạn và ràng buộc với agent, package, action, target, purpose. External
model chỉ biết có credential phù hợp và tool nào được phép gọi. Khi tool nhận handle, Permission
Broker đối chiếu scope, trusted Main-process sink resolve secret rồi fill/sign/inject hoặc gọi API
cục bộ. Agent chỉ nhận kết quả tối thiểu và receipt, không nhận giá trị.

### 6.7 Policy, dữ liệu phức tạp và release gate

Thứ tự ưu tiên:

```text
Hard deny / legal-enterprise rule
> user/workspace policy
> permission + destination policy
> Layer 1 findings
> Layer 2 recommendation
> agent/package request
```

Policy mặc định `private`: Critical chỉ qua Vault/local tool; Secret High phải được unlink hoặc xử
lý local. Profile `balanced` cho phép giữ thuộc tính task-required sau khi unlink/generalize và hỏi
khi confidence thấp. Enterprise có policy ký riêng. Không profile nào được tắt bảo vệ credential
plaintext.

Xử lý định dạng:

- **Text:** normalize Unicode, phát hiện obfuscation, scan rule, semantic review và re-scan.
- **Ảnh:** local OCR, QR/barcode, metadata và visual review; redact theo bounding box, rasterize rồi
  re-scan. Không gửi ảnh gốc chỉ vì OCR không thấy chữ.
- **Document:** trích xuất text, metadata, embedded image/annotation; xuất bản sanitize riêng,
  không sửa artifact gốc.
- **Archive:** giới hạn nesting, số file, kích thước sau giải nén và thời gian. Archive mã hóa,
  format không hỗ trợ hoặc vượt budget chuyển `ASK`/`LOCAL_ONLY`, không được coi là safe.

Hiệu năng multi-agent:

- cache theo `content hash + extraction version + policy version + destination class + purpose`;
- không chia cache giữa trust scope khác nhau;
- incremental scan, batch chunk, immutable artifact deduplication;
- inference queue ưu tiên tương tác và quota riêng cho background;
- concurrency do ResourceCoordinator điều phối;
- timeout luôn fail sang `ASK`/`LOCAL_ONLY`.

Mỗi Security Receipt chứa hash, source, purpose, destination class, entity category,
transformation reason, rule/model/policy version, decision, confidence, latency và final egress
field list; không chứa raw payload nhạy cảm.

Release gate ban đầu:

- credential/critical plaintext recall ≥99% trên bộ test khóa;
- linked-identity recall ≥95%;
- JSON schema validity ≥99,9%;
- false-positive trên safe projection ≤2%;
- integration test không có egress bypass;
- model missing/crash/timeout không fail-open;
- ảnh/file sanitize được re-scan;
- raw secret không xuất hiện trong prompt, log, event, checkpoint hoặc receipt.

Chỉ fine-tune sau khi baseline prompt/schema đã benchmark. Dataset dùng dữ liệu tổng hợp,
adversarial và de-identified; không train bằng raw secret/private profile. Nếu 0.8B không đạt gate,
nâng model pack hoặc thu hẹp auto-egress, không hạ policy.



#### Tiền lệ trong ngành và ranh giới của Tomny

| Hệ thống | Primitive đã được chứng minh | Phần Tomny kế thừa/khác biệt |
| --- | --- | --- |
| [Microsoft Purview](https://learn.microsoft.com/en-us/purview/apply-sensitivity-label-automatically) | scan và auto-label file/email at rest | Data Territory local-first, label theo content hash và receipt dùng cho agent |
| [Microsoft Presidio](https://microsoft.github.io/presidio/text_anonymization/) | rule, regex, NER, context và anonymizer cho text/ảnh | dùng như Layer 1 primitive; quyết định che/giữ vẫn theo purpose và linkability |
| [Google Sensitive Data Protection](https://docs.cloud.google.com/sensitive-data-protection/docs/inspect-sensitive-text-de-identify) | pseudonymization/tokenization và re-identification bằng key | capability handle không tiết lộ plaintext cho external model |
| [AWS Bedrock Guardrails](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-components.html) | kiểm tra và mask/block sensitive data ở input/output | Tomny ưu tiên transform-and-allow, thêm file label, screenshot và local execution |
| [NVIDIA NeMo Guardrails](https://docs.nvidia.com/nemo/microservices/latest/guardrails/terminology.html) | input/retrieval/execution/output rails và task model riêng | tham khảo rail architecture; không dùng NeMo thay Qwen vì NeMo là framework, không phải semantic model |

Các primitive trên chứng minh hướng scan, label, mask/tokenize và guard input/output có tiền lệ.
Phần cần Tomny tự chứng minh bằng benchmark là tổ hợp local-first gồm Data Territory, selective
disclosure theo purpose, reusable receipt, capability handle và semantic verifier nhỏ chạy trên
laptop người dùng.

### 6.8 Queue, model load và resource budget

Baseline tối thiểu dùng để thiết kế và benchmark ban đầu:

- Intel Core i7-11800H, 8 core/16 thread;
- RAM 16 GB;
- NVIDIA RTX 3050 Laptop 4 GB;
- Windows + Electron Hub + nhiều agent/subagent hoạt động đồng thời.

Qwen3.5-0.8B Q4 có artifact khoảng 563 MB. Đây chỉ là kích thước tải; working set thực tế còn
model mapping, runtime, context/KV cache và buffer. Release budget mục tiêu trên baseline:

| Hạng mục | Budget mục tiêu |
| --- | --- |
| Download model Q4 | khoảng 0,6 GB |
| Dung lượng cài gồm runtime/metadata | không quá 1,0 GB |
| GPU working set text verifier | không quá 1,3 GB VRAM |
| CPU-mode working set | không quá 1,5 GB RAM |
| CPU khi model warm nhưng idle | trung bình dưới 1% |
| Số model instance | đúng 1 instance dùng chung toàn hệ thống |

Các số working set/latency là release budget, phải được xác nhận bằng benchmark thực trên máy
baseline; không được coi là số đo hoàn tất trước khi runtime được tích hợp.

#### Đơn vị được xếp hàng

Không kiểm duyệt lại internal message giữa parent agent và subagent. Mọi egress boundary tạo một
gate check nhẹ; chỉ gate có dữ liệu mới, screenshot, receipt hết hạn hoặc candidate ngữ nghĩa chưa
giải quyết mới tạo Security Model Job. Cache hit chỉ xác minh hash/policy/target bằng backend.

Tomny duy trì một sanitized conversation mirror. Mỗi lượt chỉ quét phần delta mới cùng attachment,
tool output và thay đổi policy; phần lịch sử đã có Security Receipt hợp lệ được tái sử dụng. Nếu
purpose, destination, policy hoặc content thay đổi thì cache mất hiệu lực.

```text
N agent/subagent
  → Egress Gate
  → deduplicate + delta extraction
  → bounded priority queue
  → conditional Security Model Worker; cache hit không chạy inference
  → final policy decision
  → external request
```

#### Priority và fairness

| Priority | Loại việc |
| --- | --- |
| P0 | user đang chờ gửi chat hoặc xác nhận tool |
| P1 | agent/subagent chuẩn bị gọi external model/tool |
| P2 | attachment/file preflight đã được yêu cầu |
| P3 | background re-scan, index hoặc model warm-up |

Queue dùng weighted fair scheduling theo agent để một subagent nhiều request không làm nghẽn toàn
Hub. Mỗi agent tối đa 2 job chờ; phần vượt quá bị backpressure tại orchestrator. Job hết relevance
khi agent bị cancel, prompt bị thay hoặc user dừng tác vụ phải được hủy trước inference.

Giới hạn mặc định:

- global queue tối đa 32 job metadata; payload lớn nằm trong encrypted temp store, không giữ bản
  sao trong RAM;
- `balanced`: một inference worker, tối đa 2 active sequences bằng continuous batching khi GPU đủ;
- `saver`: một active sequence, CPU thread cap 4, không tự bật vision review;
- `performance`: tối đa 2 active sequences; chỉ tăng thêm sau benchmark và resource lease;
- micro-batch window 20–50 ms cho burst đồng thời nhưng P0 không bị giữ quá deadline.

Không tạo process/model riêng cho từng agent. Mười agent dùng chung một worker và context của từng
job được cách ly bằng request envelope.

#### Model lifecycle

- Model không chặn thời gian mở Hub; worker lazy-load khi phiên agent đầu tiên cần external egress.
- External request đầu tiên chờ model `ready`; trong thời gian load không có bypass.
- Giữ model warm khi còn agent hoạt động hoặc queue chưa rỗng.
- Unload sau 10 phút idle, khi hệ điều hành báo memory pressure hoặc ResourceCoordinator thu hồi
  lease.
- Không unload giữa job; cancel, drain queue rồi release GPU/RAM an toàn.
- Model file được memory-map một lần; các agent không tạo bản sao weights.
- Download, verify chữ ký và atomic install diễn ra nền. Model thiếu/hỏng chuyển request sang
  `ASK`/`LOCAL_ONLY`, không gửi dữ liệu chưa kiểm duyệt.

#### Resource pressure policy trên baseline 16 GB/4 GB

- Ưu tiên GPU cho text verifier nếu còn ít nhất 1,5 GB VRAM sau khi reserve cho Electron/UI.
- Nếu GPU đang bận, chuyển sang CPU với tối đa 4 thread và process priority thấp.
- RAM trống dưới 2,5 GB: dừng P3, giải phóng cache/package idle và giữ concurrency bằng 1.
- RAM trống dưới 1,5 GB: không chạy vision review hoặc preflight lớn đồng thời; queue và thông báo
  chờ tài nguyên.
- OCR, document extraction và archive scan dùng lease riêng; không chạy song song vô hạn với model.
- Payload ảnh/file được stream/chunk, không nạp toàn bộ archive vào RAM.

#### Latency SLO: lý tưởng và release ceiling

Đo từ lúc Egress Gate nhận delta tới khi có decision/receipt; không tính thời gian external model.
Mục tiêu trên laptop baseline i7-11800H, RAM 16 GB, RTX 3050 4 GB:

| Đường xử lý | Mục tiêu lý tưởng P50 | Release ceiling P95 |
| --- | ---: | ---: |
| Receipt/cache hit | ≤2 ms | ≤10 ms |
| Prompt text qua backend Layer 1 | ≤5 ms | ≤20 ms |
| Tool/output text qua backend + policy | ≤10 ms | ≤30 ms |
| Candidate ngắn cần Qwen semantic | ≤150 ms | ≤500 ms |
| OCR + Layer 1 cho screenshot | ≤300 ms | ≤1.000 ms |
| Vision semantic sau OCR | ≤750 ms | ≤2.000 ms |
| Cold model load lần đầu | ≤1.500 ms | ≤3.000 ms |
| Burst 10 cache hit | ≤50 ms toàn bộ | ≤100 ms toàn bộ |
| Burst 10 semantic candidate có batch | ≤1.000 ms toàn bộ | ≤3.000 ms toàn bộ |

SLO cấp task:

- luồng bình thường có ≥80% receipt/backend-only: security overhead lý tưởng ≤3% tổng thời gian;
- release không được vượt 10% P95 tổng thời gian task;
- không request text bình thường nào được cộng cố định 1–4 giây;
- screenshot/file có thể chậm hơn nhưng chỉ trả chi phí khi artifact mới hoặc receipt hết hiệu lực;
- nếu semantic P95 vượt 500 ms kéo dài, giảm context/chunk, fine-tune classifier hoặc thay model;
- nếu queue wait vượt compute time, admission controller phải giảm agent egress concurrency.

Đây là target cần benchmark, không phải số đo đã đạt. Benchmark phải báo riêng queue wait, extraction,
Layer 1, Qwen prefill/decode, transform/re-scan và tổng wall-clock để tránh che giấu bottleneck.

### 6.9 Secret capability execution

```text
Agent nhận opaque handle
→ xin capability theo purpose/target
→ trusted Main-process sink resolve secret
→ sink thực hiện fill/sign/inject
→ agent chỉ nhận receipt, không nhận giá trị
```

Secret không đi vào prompt, memory, log, event, checkpoint hoặc package output.

### 6.10 Execution trust

- package signing và publisher identity;
- manifest permission;
- isolated runtime;
- exact-target/network allowlist;
- resource quota;
- consent checkpoint;
- audit receipt;
- revoke, quarantine, rollback và kill switch.

### 6.11 Trust reputation

Security incident, permission overreach, revoke latency và recovery history ảnh hưởng reputation. Star rating không thể bù cho vi phạm trust.

## 7. User Understanding Core — Contextual Causal User Model

> **Trạng thái:** normative target design. Core này mở rộng Private Work Graph và Outcome Engine;
> không tạo một hồ sơ tâm lý bí mật tách khỏi quyền kiểm soát của người dùng.

### 7.1 Mục tiêu và ranh giới

User Understanding Core giúp Tomny trả lời và hành động ngày càng đúng ý người dùng bằng cách học
**trong bối cảnh nào, vì cơ chế nào, người dùng có xu hướng chọn một kết quả**. Core không biến một
lựa chọn lặp lại thành đặc điểm tính cách tuyệt đối.

```text
Context + State + Goal + candidate mechanism M
→ dự đoán lựa chọn B và độ tin cậy
→ thử nghiệm hoặc hỏi người dùng theo risk
→ quan sát accept/edit/reject/revert/outcome
→ phân loại nguyên nhân
→ cập nhật M → B trong đúng phạm vi
```

Bất biến:

- chỉ dẫn rõ ràng hiện tại của người dùng luôn thắng dự đoán;
- mọi đặc điểm đều có scope, bối cảnh, freshness và confidence;
- trạng thái tạm thời không được tự động nâng thành tính cách ổn định;
- tương quan A/C/D/E cùng dẫn đến B chưa đủ chứng minh cơ chế M;
- Core phải tìm counterexample và biết abstain khi chưa đủ bằng chứng;
- mục tiêu là cộng tác hiệu quả, không chẩn đoán lâm sàng, thao túng, gây nghiện hoặc tối ưu ép mua;
- người dùng xem, sửa, phủ nhận, tạm dừng và xóa được dữ liệu suy luận.

### 7.2 Mô hình dữ liệu chuẩn

Mỗi observation không chỉ lưu “người dùng chọn B”. Nó phải chứa:

| Thành phần | Nội dung tối thiểu |
| --- | --- |
| `ContextFrame` | loại nhiệm vụ, domain, workspace, channel, urgency, risk, phase và các lựa chọn khả dụng |
| `UserState` | tín hiệu trạng thái tạm thời, nguồn tín hiệu, confidence và thời hạn hết hiệu lực |
| `GoalFrame` | mục tiêu, success criteria, ưu tiên tốc độ/chất lượng/chi phí/kiểm soát |
| `ActionCandidate` | B đã đề xuất, phương án thay thế và lý do lựa chọn |
| `OutcomeSignal` | accept, edit, reject, revert, explicit feedback và verified outcome |
| `MechanismHypothesis` | mô tả M, scope, evidence ủng hộ/phản đối, counterexample và confidence |
| `PredictionReceipt` | model/policy/version, projection đã dùng, latency và kết quả thực tế |

Ví dụ hypothesis hợp lệ:

```text
Không: “Người dùng luôn thích câu trả lời ngắn.”
Có: “Khi mục tiêu đã rõ và người dùng đang yêu cầu thực thi ngay,
     họ ưu tiên câu trả lời ngắn hơn giải thích — confidence 0.86.”
```

Dữ liệu nhận dạng, tâm lý, thói quen và liên kết chéo khiến một người có thể bị nhận diện thuộc
`SECRET_HIGH`. Raw evidence local/E2EE; model ngoài chỉ nhận task-scoped projection tối thiểu.


#### 7.2.1 Đọc lại lịch sử chat và dựng lại bối cảnh trước quyết định

Lịch sử chat là evidence gốc để hiểu **vì sao** một preference hoặc hypothesis tồn tại. Trước mọi
quyết định có cá nhân hóa, User Understanding Core phải lấy lại các đoạn hội thoại liên quan và dựng
`DecisionContext`; không được chỉ đọc profile đã compact hoặc câu cuối hiện tại rồi suy đoán.

```text
Current request + recent turn window
→ tạo retrieval query theo task/topic/entity/workspace/decision
→ lấy explicit memory + episode chat liên quan + correction/rejection/outcome cũ
→ lấy cả evidence phản đối và context shift
→ rerank theo relevance, scope, recency, provenance và outcome strength
→ dựng DecisionContext có citation tới message/episode nguồn
→ suy luận M → B hoặc ABSTAIN/hỏi người dùng
→ ghi Prediction Receipt và feedback sau quyết định
```

Các tầng lịch sử bắt buộc xem xét:

| Tầng | Nội dung | Chính sách |
| --- | --- | --- |
| `RecentWindow` | các lượt gần nhất của phiên hiện tại | luôn có; ưu tiên chỉ dẫn mới nhất |
| `RelevantEpisodes` | đoạn chat cũ cùng chủ đề, task, entity hoặc quyết định | hybrid search theo keyword, embedding và graph |
| `WorkspaceHistory` | quyết định, constraint và outcome trong project/workspace hiện tại | không trộn workspace nếu chưa có căn cứ |
| `ExplicitMemory` | fact/preference người dùng đã xác nhận | trọng số cao nhưng vẫn kiểm tra freshness và scope |
| `CorrectionHistory` | edit, reject, revert, “không phải ý tôi” và lý do | bắt buộc lấy khi dự đoán hành vi hoặc style |
| `OutcomeHistory` | lựa chọn nào thực tế tạo kết quả tốt/xấu | mạnh hơn accept thụ động nếu verifier đáng tin |
| `CounterEvidence` | trường hợp tương tự nhưng người dùng chọn khác | bắt buộc cho hypothesis M có ảnh hưởng quyết định |

`DecisionContext` tối thiểu gồm:

```json
{
  "current_instruction": "Yêu cầu rõ ràng ở lượt hiện tại",
  "active_scope": ["user", "workspace", "task", "session"],
  "relevant_history": [
    {
      "episode_id": "local-episode-id",
      "message_refs": ["message-id"],
      "relation": "same_task_and_decision",
      "summary": "Bản tóm tắt bảo toàn ý nghĩa",
      "age": "14d",
      "outcome": "accepted_after_edit",
      "sensitivity": "SECRET_HIGH"
    }
  ],
  "supporting_evidence": ["evidence-id"],
  "counter_evidence": ["evidence-id"],
  "unresolved_conflicts": [],
  "history_coverage": 0.82,
  "reconstruction_confidence": 0.78
}
```

Bất biến retrieval:

- không đưa toàn bộ transcript vào context theo mặc định; chỉ lấy episode đủ liên quan trong token budget;
- chỉ dẫn hiện tại thắng lịch sử, kể cả khi lịch sử có confidence cao;
- quote hoặc summary phải giữ `message_ref`, timestamp, workspace, speaker và provenance;
- ưu tiên cùng task/workspace/phase hơn semantic similarity chung chung;
- phải lấy ít nhất một counterexample khi dùng hypothesis hành vi có tác động vừa hoặc cao;
- lịch sử mâu thuẫn, quá cũ hoặc khác scope làm giảm confidence thay vì bị bỏ qua;
- nếu coverage thấp, Core dùng lựa chọn trung lập hoặc hỏi lại, không bịa “gu người dùng”;
- raw chat, identity link và psychological evidence chỉ được xử lý local/E2EE;
- model ngoài chỉ nhận projection theo purpose, không nhận transcript hoặc ID nguồn;
- Temporary Session và conversation bị người dùng loại khỏi memory không được retrieval;
- người dùng có thể xem đoạn lịch sử nào đã ảnh hưởng quyết định và loại nó khỏi lần sau.

Chiến lược retrieval mặc định:

1. lấy 6–20 lượt gần nhất tùy token budget;
2. hybrid-search top 20–50 episode ứng viên;
3. filter theo permission, scope, retention và sensitivity;
4. rerank còn 3–10 episode bằng task similarity, context similarity, freshness và outcome evidence;
5. bổ sung correction/counterexample bị thiếu;
6. compact thành projection ngắn, có citation nội bộ và uncertainty;
7. cache theo `user + workspace + task + decision + history_version + policy_version`.

Core chỉ quét sâu lịch sử khi quyết định thật sự phụ thuộc người dùng, có mâu thuẫn hoặc người dùng
tham chiếu “lần trước/cách của tôi”. Với yêu cầu rõ ràng, low-impact, retrieval recent window và cache
là đủ. Background consolidation tạo index và episode trước để đường foreground không phải đọc lại
hàng nghìn tin nhắn.

### 7.3 Vòng học và cách xử lý từ chối

Một lần từ chối không tự động làm giảm quan hệ M → B. Core phải phân loại nguyên nhân trước:

| Nguyên nhân khả dĩ | Cập nhật |
| --- | --- |
| Bối cảnh đã thay đổi | cập nhật context boundary, không phạt M ngoài phạm vi mới |
| Trạng thái tạm thời thay đổi | cập nhật `UserState` với TTL, không đổi trait dài hạn |
| M được suy luận sai | giảm `P(M \| Context)` và tăng evidence phản đối |
| M đúng nhưng thực hiện B kém | giữ hypothesis; giảm chất lượng action/template/tool đã dùng |
| Có constraint mạnh hơn M | ghi interaction giữa các điều kiện và thứ tự ưu tiên |
| Người dùng đang khám phá | ghi exploration event, chưa coi là preference reversal |
| Phản hồi phủ định rõ ràng | giảm mạnh hoặc đóng hypothesis theo scope người dùng chỉ định |

Cập nhật phải dựa trên `P(B | M, Context, State, Goal)`, không dùng `P(B | M)` đơn độc. Core cũng tìm
hai loại đối chứng: có M nhưng không chọn B, và không có M nhưng vẫn chọn B. Điều này hạn chế vòng
lặp tự xác nhận.

Tín hiệu cập nhật mặc định:

- xác nhận trực tiếp: trọng số rất cao;
- accept không sửa và outcome tốt: tăng vừa;
- edit nhẹ: tăng ít và học phần bị sửa;
- reject/revert: kích hoạt phân loại nguyên nhân, không phạt mù;
- evidence lặp lại ở nhiều bối cảnh: tăng khả năng M là cơ chế ổn định;
- dữ liệu cũ hoặc mâu thuẫn: time decay và giảm confidence;
- “chấp nhận vì tiện” không được coi ngang với xác nhận rõ ràng.

### 7.4 Khi nào đủ dữ liệu

Không có ngưỡng chung theo số ngày hoặc số tin nhắn. Đủ dữ liệu được quyết định theo từng khả năng:

| Loại hiểu biết | Ngưỡng khởi đầu đề xuất | Điều kiện bổ sung |
| --- | ---: | --- |
| Dữ kiện người dùng nói rõ | 1 xác nhận | lưu provenance và quyền sửa/xóa |
| Cách diễn đạt, độ dài, tone | 3–5 lựa chọn | ít nhất 2 phiên hoặc bối cảnh |
| Thói quen làm việc | 5–10 task | có outcome hoặc edit/revert |
| Gu UI/thẩm mỹ | 10–20 lựa chọn | có so sánh hoặc lần sửa cụ thể |
| Cơ chế ra quyết định M | 20–50 observation | đa bối cảnh, counterexample và user validation |

Một hypothesis chỉ được tự động áp dụng khi coverage, consistency, freshness, context similarity và
outcome lift cùng đạt policy threshold. Nhiều observation trong cùng một bối cảnh không tạo quyền
khái quát sang bối cảnh khác.

### 7.5 Chính sách gọi Core

| Thời điểm | Thành phần | Hành vi |
| --- | --- | --- |
| Mọi request | deterministic retrieval/cache | lấy projection liên quan; không gọi LLM |
| Bối cảnh mơ hồ hoặc đổi nhanh | classifier/0.8B | phân loại context, state và nhu cầu cá nhân hóa |
| Nhiều lựa chọn hợp lệ, preference ảnh hưởng kết quả | 2B reasoner | đề xuất M, xếp hạng B và confidence |
| Người dùng sửa, reject hoặc revert | 2B reasoner | phân loại nguyên nhân rồi mới cập nhật |
| Mâu thuẫn, high impact hoặc bối cảnh mới | 4B/model API ngoài | phân tích sâu hoặc abstain/hỏi người dùng |
| Kết thúc task/phiên | background consolidation | cập nhật hypothesis, decay và compact evidence |

| Confidence | Low impact | High impact |
| ---: | --- | --- |
| `>= 0.85` | tự áp dụng, có undo | áp dụng minh bạch hoặc checkpoint theo policy |
| `0.60–0.85` | thử B và quan sát | đề xuất B, chờ xác nhận |
| `< 0.60` | dùng lựa chọn trung lập | hỏi người dùng hoặc abstain |

Không gọi Psychology Reasoner khi chỉ dẫn đã rõ, chỉ có một đáp án kỹ thuật đúng, cá nhân hóa không
thay đổi kết quả hoặc tác vụ không nằm trong purpose đã cấp.

### 7.6 External Model API chủ động gọi User Understanding Core

Mọi model/provider/CLI được Tomny cấp tool `user_context.resolve` để chủ động yêu cầu projection khi
nó nhận ra rằng hiểu người dùng có thể làm thay đổi chất lượng câu trả lời.

Tool description yêu cầu model gọi khi:

- người dùng nói “theo gu/cách của tôi” hoặc tham chiếu lựa chọn trước;
- có nhiều đáp án hợp lý và lựa chọn phụ thuộc preference;
- tone, độ dài, mức chi tiết hoặc workflow ảnh hưởng đáng kể tới outcome;
- yêu cầu mới mâu thuẫn với projection đang có;
- model sắp hỏi lại điều Tomny có thể đã biết;
- quyết định có tác động cao cần biết mức tự chủ hoặc cách xin duyệt phù hợp.

Không gọi chỉ để tò mò về người dùng hoặc lấy thêm dữ liệu không cần cho nhiệm vụ.

Request contract đề xuất:

```json
{
  "purpose": "prepare_response",
  "task_summary": "Thiết kế lựa chọn triển khai Core 2",
  "decision": "response_depth_and_autonomy",
  "options": ["short_execute", "explain_then_execute", "ask_first"],
  "current_context": {
    "task_mode": "architecture_discussion",
    "urgency": "normal",
    "risk": "medium"
  },
  "required_dimensions": ["communication_style", "decision_style"],
  "max_sensitivity": "preference",
  "correlation_id": "run-scoped-id"
}
```

Response contract đề xuất:

```json
{
  "recommended_option": "explain_then_execute",
  "confidence": 0.78,
  "scope": "architecture_discussion",
  "instructions": [
    "Lead with the decision",
    "Keep implementation details available but compact"
  ],
  "uncertainties": ["No recent high-risk decision evidence"],
  "action": "apply_with_easy_override",
  "expires_at": "task-end",
  "receipt_id": "local-receipt-id"
}
```

External model không nhận raw history, identity graph, psychological notes hoặc evidence nhạy cảm.
Nó nhận projection đủ dùng cho quyết định hiện tại. Tool call đi qua Privacy Compiler và response
được scope theo purpose.

External model không được trực tiếp ghi memory. Nó chỉ gửi observation về
`user_context.record_outcome`; backend xác minh provenance, phân loại tín hiệu và quyết định cập
nhật. Mọi ghi/xóa profile nhạy cảm cần local policy và audit receipt.

#### Chống vòng lặp gọi model

Nếu User Understanding Core dùng model API ngoài để suy luận M, tool `user_context.resolve` không
được expose lại trong chính lượt evaluator đó:

- `call_depth <= 1` cho một `correlation_id`;
- cấm recursive call về cùng provider/request;
- timeout/failure trả `ABSTAIN`, không tự chuyển thành confidence cao;
- deduplicate request giống nhau trong task;
- cache projection theo context hash, purpose và policy version;
- external escalation không được gọi tiếp một external psychology evaluator khác.

### 7.7 Chính sách model và fine-tuning

Baseline cho laptop 16 GB RAM, RTX 3050 Laptop 4 GB:

| Tầng | Model/logic đề xuất | Vai trò |
| --- | --- | --- |
| Retrieval | rules + embedding/index | lấy evidence và context tương tự |
| Gate | deterministic classifier; tùy chọn Qwen3.5-0.8B | phát hiện ambiguity và chọn có cần reasoner |
| Default reasoner | Qwen3.5-2B Q4, LoRA/SFT | suy luận hypothesis M, prediction B và rejection cause |
| Escalation | Qwen3.5-4B hoặc model API ngoài | case mâu thuẫn, mới hoặc high impact |

Qwen3.5-0.8B không là psychology brain chính. Fine-tuning giúp format, taxonomy và task behavior nhưng
không thay thế hoàn toàn năng lực suy luận nền. Model/provider là adapter có thể thay; Work Graph,
evidence, policy và calibrated feedback mới là tài sản tích lũy.

Training data không dùng raw chat dump. Dataset chuẩn hóa thành:

```text
ContextFrame
+ candidate mechanisms
+ positive evidence
+ counterexamples/hard negatives
+ predicted options
+ actual choice
+ outcome/revert
+ correct confidence/abstention
```

Dataset phải có tiếng Việt tự nhiên, biến thể diễn đạt, tình huống cùng hành động nhưng khác cơ chế,
và cùng cơ chế nhưng hành động khác vì constraint. Tách train/eval theo người và theo thời gian để
tránh model chỉ ghi nhớ pattern của một user.

### 7.8 Hiệu năng và hàng đợi

| Path | Latency mục tiêu khi warm |
| --- | ---: |
| retrieval/cache | 5–30 ms |
| deterministic/embedding gate | 10–50 ms |
| 0.8B gate nếu cần | 50–250 ms |
| 2B short reasoning | 300–1,200 ms |
| 4B/external deep reasoning | 1–3 giây, chưa tính provider/network outlier |

Phân bổ request mục tiêu:

- 80–90% request không gọi psychology LLM, overhead dưới 50 ms;
- 10–20% request gọi 2B, chỉ block khi personalization ảnh hưởng quyết định;
- dưới 2% request escalation sâu;
- consolidation chạy nền và nhường tài nguyên cho foreground agent.

Mọi inference local phải xin lease từ ResourceCoordinator. Chỉ một psychology inference nặng chạy
cùng lúc trên baseline; không giữ 0.8B, 2B và 4B đồng thời trong VRAM 4 GB. Khi agent/subagent tải
cao, dùng cached projection, hạ priority consolidation và queue deep analysis thay vì tranh GPU.
Cold-load phải được đo riêng; idle preload chỉ bật khi resource preset cho phép.

### 7.9 Quyền riêng tư, đạo đức và quyền kiểm soát

- Hồ sơ tâm lý và liên kết danh tính mặc định `SECRET_HIGH`, local-first/E2EE.
- Không suy luận hoặc sử dụng thuộc tính nhạy cảm nếu không cần cho purpose được cấp.
- Không dùng vulnerability, mood hoặc personality để định giá, ép mua, gây nghiện hay tăng engagement.
- Không đưa ra chẩn đoán sức khỏe tâm thần hoặc trình bày hypothesis như sự thật khách quan.
- Mọi projection có nút “Vì sao Tomny chọn cách này?”, sửa, phủ nhận và undo.
- Người dùng có thể pause learning, dùng Temporary Session, xóa từng hypothesis hoặc toàn bộ profile.
- Xóa phải loại evidence, derived hypothesis, cache và future projection theo retention policy.
- Team/workspace memory không tự hợp nhất vào personal psychology profile.

### 7.10 UX minh bạch

- **What Tomny understands:** facts, preferences, workflows và hypotheses theo từng scope;
- **Why this decision:** context, confidence và loại evidence, không hiển thị chain-of-thought;
- **Correct:** sửa B, sửa scope hoặc giải thích constraint mới;
- **Forget/Pause:** xóa, decay ngay hoặc tạm dừng học;
- **Activity receipt:** model/policy nào đã dùng projection và cho purpose gì;
- **External access:** provider nào đã nhận projection nào, không chỉ ghi “AI đã truy cập”.

Core không hiển thị nhãn phán xét như “nóng tính”, “thiếu kiên nhẫn”. UI diễn đạt hành vi có điều
kiện, ví dụ “Khi đang triển khai lỗi nhỏ, bạn thường muốn câu trả lời ngắn và hành động ngay”.

### 7.11 Benchmark và release gate

Mức hoàn thiện mục tiêu là **Level 4/5 — contextual adaptive user model**, không tuyên bố Digital Twin
hoàn hảo.

| Khả năng | Release target ban đầu |
| --- | ---: |
| nhớ fact được xác nhận | 95–99% |
| style/tone/độ dài | 85–95% |
| context classification | 80–90% |
| workflow preference | 80–90% |
| lựa chọn đơn giản | 75–88% |
| UI/aesthetic preference | 70–85% |
| state so với stable trait | 65–80% |
| mechanism M → B trong scope đã biết | 60–78% |
| generalize M sang context mới | 60–75% |

Đây là target benchmark, không phải cam kết trước đo. Release gate còn yêu cầu:

- first-pass acceptance tăng có ý nghĩa so với baseline không cá nhân hóa;
- số lần nhắc lại preference giảm tối thiểu 50% trên cohort benchmark;
- false cross-context generalization dưới ngưỡng đã chốt bằng test;
- confidence được calibration, không chỉ accuracy cao;
- tỷ lệ gọi Core không cần thiết và latency nằm trong SLO;
- privacy projection red-team không lộ raw identity/evidence;
- inspect/correct/delete/undo hoạt động 100% trong acceptance suite;
- explicit instruction override đạt 100% trong deterministic tests.

Benchmark phải chứa case từ chối do các nguyên nhân ở mục 7.3, counterexample, context shift, cold
start, dữ liệu mâu thuẫn, external proactive tool call, recursion attack và resource pressure.


#### 7.11.1 Mẫu tham chiếu thị trường và tiêu chuẩn phải học

> **Ngày đối chiếu:** 2026-07-24. Bảng chỉ ghi năng lực được nhà cung cấp công khai; “chưa thể hiện”
> không khẳng định hệ thống nội bộ của họ không có, mà chỉ có nghĩa tài liệu công khai chưa đủ để dùng
> làm bằng chứng.

| Hệ thống | Năng lực đã công khai | Tiêu chuẩn Tomny nên học | Phần Tomny phải đi xa hơn |
| --- | --- | --- | --- |
| [ChatGPT Memory](https://help.openai.com/en/articles/11146739-how-does-reference-saved-memories-work) | tách Saved Memories và Reference Chat History; dùng chat cũ để cá nhân hóa; memory từ lịch sử thay đổi theo thời gian; có bật/tắt/xóa và Temporary Chat | phân biệt dữ kiện cần giữ bền với tín hiệu lấy lại từ lịch sử; quyền điều khiển dễ hiểu | citation tới episode đã ảnh hưởng quyết định; scope theo task/workspace; correction/outcome; hypothesis M → B và counterexample chưa được mô tả công khai |
| [Claude chat search và memory](https://support.claude.com/en/articles/11817273-use-claude-s-chat-search-and-memory-to-build-on-previous-context) | tìm chat cũ bằng RAG như tool call; memory dạng entry có category; memory/project summary tách theo project; incognito chat; pause/reset | retrieval minh bạch như một tool; isolation theo project; memory có cấu trúc và cập nhật liên tục | hợp nhất history retrieval với causal context, verified outcome, privacy projection xuyên nhiều model/package |
| [Claude connected-app suggestions](https://support.claude.com/en/articles/14730684-how-claude-suggests-connected-apps) | dùng yêu cầu hiện tại và memory từ hội thoại trước để chủ động gợi ý app phù hợp | memory phải ảnh hưởng quyết định tool/app đúng lúc, không chỉ đổi văn phong | xếp hạng package/model/agent bằng UserFit + chi phí + capability + outcome; có reason receipt và quyền override |
| [Gemini Personalization](https://support.google.com/gemini/answer/16598623?hl=en) | cá nhân hóa từ past chats, preference/instructions và Connected Apps | kết hợp nhiều nguồn thay vì chỉ chat | local-first projection, provenance theo evidence, không khóa vào một provider |
| [Gemini Connected Apps](https://support.google.com/gemini/answer/16836988?hl=en-4) | có thể dùng Photos, YouTube, Workspace, Search, Maps và dữ liệu liên quan để hiểu preference, relationship và tạo gợi ý/tác vụ cá nhân hóa | personal context phải bao phủ thế giới công việc thực tế và quan hệ giữa dữ liệu | permission theo purpose, tách identity khỏi thuộc tính cần dùng, context graph do người dùng sở hữu |
| [Microsoft 365 Copilot Memory](https://support.microsoft.com/en-us/microsoft-365-copilot/manage-copilot-memory-in-microsoft-365-copilot) | suy ra vai trò, nhiệm vụ thường làm, kỹ năng muốn cải thiện; có thể hỏi trước khi lưu; merge/update/delete memory | profile công việc có cấu trúc; xác nhận người dùng với memory quan trọng | giải thích evidence/bối cảnh của từng suy luận; phân loại reject; học từ verified outcome thay vì chỉ chat inference |
| [Microsoft Copilot personalization](https://support.microsoft.com/en-US/Microsoft-365-Copilot/personalize-what-microsoft-365-copilot-remembers) | dùng saved memory, inference từ chat history, custom instructions và temporary chat; ghi nhớ style, topic, goal, recurring task | kết hợp explicit instruction và inferred memory; temporary mode không học | context boundary, confidence calibration, counterexample và cross-model portability |
| [Apple Intelligence/Siri](https://www.apple.com/apple-intelligence/) | personal context từ messages, email, notes, photos và nội dung trên màn hình; tích hợp sâu với OS | trải nghiệm hiểu người dùng ở cấp hệ điều hành và hành động xuyên app | hoạt động trung lập trên nhiều model/CLI/package; profile inspectable và outcome-driven |
| [Apple App Intents context](https://developer.apple.com/documentation/appintents/providing-contextual-cues-to-apple-intelligence-and-siri) | app khai báo entity và nội dung đang hiển thị để hệ thống hiểu người dùng đang nói tới gì | app/package phải cung cấp schema entity/action chuẩn thay vì để model đoán UI | nối app schema với Work Graph, history episode, policy và Prediction Receipt của Tomny |
| [Mem0](https://docs.mem0.ai/core-concepts/memory-operations/add) | trích xuất fact/preference/decision từ hội thoại; conflict resolution; vector/graph retrieval; scoping theo user/session/agent | pipeline extract → resolve conflict → store → retrieve; metadata và graph tùy chọn | causal hypothesis có counterevidence, state/trait separation, security classification và verified outcome |
| [Zep Context Graph](https://help.getzep.com/concepts) | temporal knowledge graph từ chat, document và business data; facts thay đổi theo thời gian; context block token-efficient; retrieval được công bố dưới 200 ms | temporal fact, episode, graph relation và compact context; lịch sử không bị đóng băng | local/E2EE ownership, explicit instruction precedence, psychology safety và decision-specific projection |
| [Letta memory hierarchy](https://docs.letta.com/guides/core-concepts/memory/context-hierarchy) | tách in-context memory block, file, archival memory và external RAG; agent có tool tìm conversation history | phân tầng memory theo độ quan trọng và quy mô; để agent tìm lại khi cần | policy tự quyết định tầng retrieval, scope theo người/workspace, provenance/correction/outcome và Privacy Compiler |

Các mẫu phải hấp thụ thành baseline của Tomny:

1. **ChatGPT:** UX quản lý saved memory, reference history và Temporary Session.
2. **Claude:** tìm lại chat như tool call có thể quan sát; memory entry có category; tách project.
3. **Gemini:** personal context đa nguồn và connected-app breadth.
4. **Microsoft:** profile công việc có cấu trúc, merge/update memory và hỏi trước khi lưu dữ kiện quan trọng.
5. **Apple:** OS-level context, onscreen entity/action schema và privacy-oriented execution.
6. **Mem0:** extraction, conflict resolution, metadata scope và hybrid vector/graph memory.
7. **Zep:** temporal graph, fact invalidation, episode history và context block ngắn.
8. **Letta:** hierarchy giữa core memory, archival memory, files và on-demand conversation search.

Tomny không được tự nhận khác biệt chỉ vì “có memory”. Khác biệt hợp lệ chỉ được ghi nhận khi benchmark
chứng minh đồng thời:

- retrieval đúng đoạn chat liên quan và cả evidence phản đối;
- dựng đúng bối cảnh, scope, phase và constraint tại thời điểm lịch sử;
- phân biệt fact, preference, state, trait và hypothesis;
- giải thích quyết định bằng evidence citation mà không lộ chain-of-thought;
- học từ correction, reject, revert và verified outcome;
- dùng cùng một user model xuyên model, CLI, agent, package và app;
- raw profile local/E2EE, external model chỉ nhận projection tối thiểu;
- người dùng inspect, correct, forget, pause, exclude episode và undo được;
- cá nhân hóa tăng outcome nhưng không tối ưu thao túng hoặc ép mua.

#### 7.11.2 Benchmark riêng cho history-to-decision

| Chỉ số | MVP gate | Production target |
| --- | ---: | ---: |
| relevant-episode recall@10 | >= 80% | >= 90% |
| precision@10 | >= 70% | >= 85% |
| lấy đúng correction/reject liên quan | >= 85% | >= 95% |
| lấy counterevidence với decision impact vừa/cao | >= 90% | >= 98% |
| temporal contradiction resolution | >= 85% | >= 95% |
| current explicit instruction precedence | 100% | 100% |
| history citation/provenance completeness | 100% | 100% |
| false cross-workspace contamination | < 1% | < 0.1% |
| excluded/temporary episode leakage | 0 | 0 |
| raw history gửi ra provider ngoài | 0 | 0 |
| warm hybrid retrieval p95 | <= 150 ms | <= 80 ms |
| decision-context compact size | <= 2,000 tokens | <= 1,000 tokens mặc định |
| first-pass acceptance lift so với no-history baseline | >= 8% | >= 15% |

Bộ eval phải có: tham chiếu “lần trước”, cùng từ khóa nhưng khác mục tiêu, preference đổi theo thời gian,
workspace trùng tên, sửa ý ngay trong phiên, reject không phải do preference, thông tin bị xóa, Temporary
Session, lịch sử có prompt injection, nhiều người trong cùng team, multilingual Vietnamese/English và
case không có episode đủ liên quan. Phải so sánh ít nhất bốn baseline: current-turn only, recent-window,
profile-only và hybrid history + causal context của Tomny.

### 7.12 Lộ trình triển khai

1. **Schema + receipts:** ContextFrame, observation, hypothesis, prediction và provenance.
2. **Retrieval-only MVP:** explicit facts/preference, context-scoped projection, inspect/edit/delete.
   - Lập episode index từ toàn bộ chat được phép học, giữ message reference, workspace, timestamp và provenance.
   - Dựng `DecisionContext` từ recent window, relevant episodes, correction, outcome và counterevidence.
   - Benchmark current-turn, recent-window, profile-only và hybrid history trước khi bật reasoner.

3. **Feedback loop:** accept/edit/reject/revert và rejection-cause labeling.
4. **Local reasoner:** 2B LoRA/SFT, confidence/abstention và benchmark tiếng Việt.
5. **External tool contract:** `user_context.resolve`, Privacy Compiler projection và recursion guard.
6. **Escalation policy:** 4B/provider ngoài theo risk, budget, latency và user policy.
7. **Background learning:** consolidation, decay, counterexample mining và model evaluation.
8. **Production gate:** privacy red-team, resource benchmark, calibration và measurable outcome lift.

### 7.13 Quyết định đã chốt

- Core học `P(B | M, Context, State, Goal)`, không học “đã chọn B thì luôn chọn B”.
- Reject là observation cần phân loại, không phải negative label tự động.
- Trước quyết định có cá nhân hóa, Core bắt buộc đọc recent context và retrieval các episode lịch sử liên quan.
- History retrieval phải lấy correction, verified outcome và counterevidence; không chỉ lấy dữ kiện ủng hộ.
- Không quét hoặc gửi toàn bộ transcript theo mặc định; dùng local hybrid retrieval và projection tối thiểu.
- Mọi quyết định dựa trên lịch sử phải có internal citation, coverage và reconstruction confidence.

- Retrieval nhẹ chạy thường xuyên; psychology LLM chỉ chạy khi lựa chọn phụ thuộc người dùng.
- Model API ngoài được chủ động gọi Core qua tool contract nhưng chỉ nhận projection theo purpose.
- External model không đọc raw profile và không được tự ghi/xóa memory.
- Chống recursion bằng call depth, correlation ID, cache và tool suppression trong evaluator call.
- Qwen3.5-2B là default candidate; 0.8B là gate, 4B/API ngoài là escalation.
- Mọi tự động hóa theo confidence và impact; Core phải abstain hoặc hỏi khi chưa đủ chắc chắn.
- Psychology Core phục vụ hiệu quả và quyền tự chủ người dùng, không phục vụ thao túng.


## 8. Efficiency Orchestrator — Verified Outcome per Resource

> **Trạng thái:** normative target design. Efficiency Orchestrator là policy layer bên trong Outcome
> Engine, không phải một runtime điều phối thứ hai và không phải một LLM độc lập tự quyết mọi thứ.

### 8.1 Mục tiêu mong muốn

Efficiency Orchestrator biến một goal thành **verified useful outcome** với tổ hợp App Package, Agent
Capsule, agent, model và tool nhỏ nhất vẫn đáp ứng chất lượng, bảo mật và ý người dùng.

Thứ tự ưu tiên chuẩn:

1. hoàn thành đúng success criteria;
2. không vượt Security Core và permission;
3. phù hợp User Understanding projection và chỉ dẫn hiện tại;
4. giảm thời gian tới outcome;
5. giảm chi phí model/tool;
6. giảm RAM/CPU/GPU và coordination overhead;
7. phục hồi được khi agent, model, tool hoặc package thất bại.

Core không tối ưu “số agent chạy”, “số token” hoặc “cảm giác bận rộn”. Nó tối ưu:

```text
Verified useful outcome
────────────────────────────────────────
Time + Cost + Resource + Risk + User effort
```

Kết quả mong muốn khi trưởng thành là **Level 4/5 — Adaptive Outcome Orchestrator**: tự chọn và điều
chỉnh chiến lược dựa trên outcome lịch sử nhưng vẫn có budget, audit, undo và human checkpoint.

### 8.2 Input và output chuẩn

Input tối thiểu:

| Input | Nội dung |
| --- | --- |
| `GoalSpec` | mục tiêu, constraint, success criteria, deadline và mức cần duyệt |
| `SecurityEnvelope` | data scope, permission, egress decision và capability handle |
| `UserProjection` | style, autonomy, workflow preference và confidence theo task |
| `CapabilityCatalog` | package, Capsule, agent, model, tool, version và health |
| `ResourceSnapshot` | RAM/VRAM/CPU/GPU, lease, queue và active workloads |
| `OutcomeHistory` | success, failure, latency, cost và compatibility theo context |
| `Budget` | token, tiền, thời gian, retry, concurrency và risk ceiling |

Output là một `ExecutionPlan` có:

- task graph và dependency;
- assignee cho từng node;
- model/tool/package đã chọn và lý do;
- input projection tối thiểu cho từng node;
- resource lease và concurrency limit;
- success criteria/verifier;
- retry, fallback, rollback và human checkpoint;
- estimated time/cost/resource/risk;
- plan version và receipt ID.

### 8.3 Control loop

```text
Goal intake
→ normalize success criteria
→ estimate complexity và uncertainty
→ chọn direct execution hoặc task graph
→ resolve capability/model/tool
→ xin Security + Resource lease
→ execute và quan sát progress
→ verify từng milestone/outcome
→ continue, replan, fallback, rollback hoặc ask
→ tạo Outcome Receipt
→ cập nhật routing statistics
```

Core là closed-loop controller. Plan ban đầu không được coi là đúng bất biến; nó được sửa khi có
observation mới nhưng mọi thay đổi phải giữ budget, permission và success criteria.

#### Invocation hooks theo năng lực

Core 3 không phải một hàm lớn được gọi nguyên khối. Mỗi năng lực được kích hoạt ở lifecycle hook
khác nhau:

| Hook | Năng lực được gọi | Có block request không? |
| --- | --- | --- |
| app start/provider change | discovery, health, quota và capability refresh | không; chạy nền |
| task intake | inventory snapshot, complexity gate và direct-vs-plan | có, nhưng deterministic trước |
| pre-execution | route CLI/model/tool/package, Security và resource lease | có |
| task expansion | quyết định có tạo subagent, depth và parallel budget | chỉ khi plan cần |
| runtime observation | progress, loop, cost, quota và resource monitor | không, trừ khi phải can thiệp |
| failure/constraint change | retry, fallback hoặc replan | có cho node bị ảnh hưởng |
| pre-completion | verifier và success criteria | có |
| post-outcome | receipt, rating và routing update | không; chạy nền |

Như vậy discovery, routing, subagent planning, resource control, recovery, verification và learning có
thể dùng độc lập. Task đơn chỉ trả chi phí inventory cache + deterministic gate; không gọi toàn bộ
planner.


### 8.4 Khi nào dùng agent và subagent

Mặc định chọn phương án đơn giản nhất:

| Tình huống | Quyết định mặc định |
| --- | --- |
| Một bước, context nhỏ, verifier rõ | một agent trực tiếp |
| Nhiều bước phụ thuộc chặt | một agent hoặc task graph tuần tự |
| Các nhánh độc lập, đủ tài nguyên | subagent song song có giới hạn |
| Cần góc nhìn độc lập/review | một worker + một verifier độc lập |
| Context chia sẻ rất lớn | tránh fan-out; chia artifact/projection trước |
| Không có verifier hoặc success criteria | hỏi người dùng hoặc tạo checkpoint |

Chỉ spawn subagent khi:

```text
Expected time/quality gain
> spawn + context transfer + coordination + verification overhead
```

Điều kiện bắt buộc:

- node độc lập hoặc dependency được khai báo;
- input/output contract rõ;
- có budget và resource lease;
- có giới hạn thời gian, token, retry và depth;
- kết quả có thể merge/verify;
- không spawn tiếp ngoài depth/policy được cấp.

Cấm unbounded recursive agents. Mỗi plan có `max_agents`, `max_depth`, `max_parallel`, `max_calls`,
`max_cost` và `deadline`. Khi chạm ceiling, Core phải replan, giảm chất lượng có thông báo hoặc hỏi
người dùng; không âm thầm vượt ngân sách.

### 8.5 Routing và scoring

Hard gate được áp dụng trước scoring:

- package/model/tool phải tồn tại, tương thích và healthy;
- permission và egress policy phải pass;
- resource lease phải khả dụng;
- entitlement và budget phải hợp lệ;
- capability phải đáp ứng success criteria tối thiểu.

Các candidate còn lại được xếp hạng:

```text
Score = QualityPrediction
      + Reliability
      + UserFit
      + ContextFit
      + Verifiability
      - Cost
      - Latency
      - ResourcePressure
      - SecurityRisk
      - CoordinationOverhead
```

Trọng số thay đổi theo task và preset `saver | balanced | performance`, nhưng Quality và Security
không được giảm dưới hard floor. Outcome history phải binding theo model/package/tool version và có
time decay; không dùng reputation cũ cho version mới như bằng chứng chắc chắn.

Exploration chỉ dùng một phần budget nhỏ để thử candidate mới. Tác vụ high impact ưu tiên lựa chọn đã
được xác minh hoặc checkpoint, không exploration mù.

### 8.6 Chọn model, tool và package

| Tầng | Dùng cho |
| --- | --- |
| deterministic/rules | health check, schema, dependency, budget và routing rõ ràng |
| model nhỏ/local | classify, summarize, estimate complexity và chọn candidate đơn giản |
| model mặc định | lập kế hoạch và thực hiện phần cần reasoning thông thường |
| model mạnh/API ngoài | node khó, ambiguity cao, verifier thất bại hoặc replan quan trọng |
| specialist Capsule/tool | domain có contract và benchmark tốt hơn general model |

Không gửi cùng một context đầy đủ cho mọi agent. Orchestrator tạo task-scoped projection và artifact
reference. Kết quả đã verified được cache theo input hash, version, policy và freshness; cache không
được tái dùng nếu security label hoặc dependency thay đổi.

Model ngoài có thể yêu cầu `execution.replan` khi phát hiện plan thiếu capability, assumption sai hoặc
success criteria không đạt. Nó không được tự spawn agent vượt plan; Orchestrator cấp node, lease và
budget mới sau khi kiểm tra.

#### Auto mặc định và quyền chọn của người dùng

Selector trong Chat có ba tầng nhưng mặc định hiển thị `Auto`:

```text
Agent/CLI: Auto | Tomny CLI | Claude CLI | Codex CLI | ...
Model:     Auto | model cụ thể của CLI/provider đã chọn
Policy:    task | conversation | workspace pin
```

- `Auto + Auto`: Core 3 được chọn CLI/agent runtime và model theo task.
- CLI cụ thể + `Auto`: Core chỉ chọn model khả dụng bên trong CLI/provider đó.
- CLI + model cụ thể: manual override; Core không tự đổi vì cho rằng model khác tốt hơn.
- Nếu lựa chọn thủ công hết quota, unhealthy hoặc không đáp ứng modality, Core giải thích và xin phép
  fallback; không âm thầm phá pin.
- Người dùng có thể “Use Auto for this step” mà không bỏ pin của toàn conversation.

Manual override là hard preference. Core vẫn áp dụng Security, permission, quota và resource hard
gate; quyền chọn model không đồng nghĩa quyền bỏ qua bảo mật hoặc chạy một target không tồn tại.

#### Runtime inventory luôn đi trước routing

Core không dựa vào danh sách model được ghi nhớ trong weights. Bước đầu của mọi routing decision là
lấy `RuntimeInventory` đã refresh:

- CLI/provider hiện được cài hoặc kết nối, version và health;
- endpoint/model list detect được từ adapter hoặc provider API;
- credential chỉ dưới dạng capability handle, không đưa API key value vào planner;
- modality, context window, tool/function calling và structured-output support detect được;
- giá, latency, rate limit và quota còn lại nếu provider expose;
- package/Capsule/tool đã cài và compatibility;
- RAM/VRAM/CPU/GPU, queue và active lease;
- policy, entitlement và data-egress constraints.

Discovery chạy khi app start, thêm/xóa key, đổi URL, CLI update, provider reconnect và theo TTL. Trước
execution, Core health-check candidate đã chọn. Giá trị `unknown` phải được giữ là unknown; backend
không được bịa quota hoặc capability mà provider không cung cấp.

Nhờ vậy GPT phiên bản mới hoặc một local model vừa được cài có thể xuất hiện ngay trong `Auto` mà
không cần fine-tune lại Orchestrator. Model lập kế hoạch chỉ nhận catalog động đã chuẩn hóa.

#### Cold-start khi chưa biết model mạnh về gì

Khi model/CLI có zero outcome, không hệ thống nào biết chắc chất lượng thật. Core dùng confidence và
cold-start ladder thay vì giả vờ biết:

| Nguồn evidence | Độ tin cậy ban đầu | Cách dùng |
| --- | --- | --- |
| capability detect/official metadata | cao cho khả năng kỹ thuật, thấp cho chất lượng | hard compatibility và prior |
| family/version inheritance | thấp–trung bình | prior có time/version discount |
| Tomny micro-benchmark | trung bình | code, reasoning, tool, JSON, vision, tiếng Việt, latency |
| user rating có task context | trung bình–cao | personal routing, không dùng star tuyệt đối |
| local verified outcomes | cao nhất cho người dùng đó | cập nhật context-specific score |
| aggregate outcomes opt-in | cao khi đủ mẫu và chống gian lận | network prior theo task/version |

Cold-start policy:

1. đọc runtime metadata và chạy health/capability probe an toàn;
2. chạy micro-benchmark nhỏ bằng dữ liệu tổng hợp, không dùng secret/user file;
3. tạo capability card với confidence, không chỉ một điểm tổng;
4. high-impact task dùng candidate đã chứng minh hoặc verifier/checkpoint mạnh;
5. model mới chỉ nhận exploration budget nhỏ ở low-risk task phù hợp;
6. sau mỗi verified outcome, cập nhật score theo task, context và version;
7. nếu không đủ evidence, giữ trạng thái `UNKNOWN` và hỏi hoặc dùng fallback đã chứng minh.

Exploration có thể dùng contextual bandit/UCB: candidate chưa biết nhận exploration bonus nhỏ, nhưng
risk, cost và Security vẫn là hard gate. Không A/B model mới bằng cách gửi gấp đôi dữ liệu người dùng
ra ngoài nếu chưa có consent và budget.

Rating của người dùng phải có ngữ cảnh như “đúng ý”, “code tốt”, “nhanh”, “tool ổn”, “vision tốt” và
loại task; không dùng một star rating chung để kết luận model mạnh mọi mặt. Aggregate từ user khác chỉ
là prior. Outcome của chính người dùng và verifier tại context hiện tại có trọng số cao hơn.

#### Quyền quyết định subagent tập trung tại Core 3

Security Core chỉ trả data/permission envelope; User Understanding Core trả autonomy và collaboration
preference. Chỉ Efficiency Orchestrator quyết định direct execution, số subagent, decomposition,
model của từng node và parallel budget. Các core khác có thể giới hạn hoặc yêu cầu checkpoint nhưng
không tự spawn agent, tránh ba nơi đưa ra ba kế hoạch khác nhau.


### 8.7 Resource, queue và responsive

Mọi task nặng đi qua ResourceCoordinator. Orchestrator không tạo scheduler cạnh tranh với hệ thống
lease hiện có.

Nguyên tắc:

- UI/chat foreground ưu tiên cao hơn consolidation, benchmark và indexing nền;
- giới hạn concurrency theo RAM/VRAM thực, không theo số core CPU đơn thuần;
- GPU model, OCR, browser và IDE build không đồng thời chiếm hết VRAM trên baseline 4 GB;
- khi pressure cao: dừng spawn, giảm context, chuyển CPU/API ngoài theo policy hoặc queue;
- release lease ở success, error, cancel và timeout;
- queue có priority, fairness, deadline và cancellation;
- không giữ model/tool/package warm nếu idle cost vượt preset.

Baseline laptop 16 GB RAM/4 GB VRAM phải duy trì desktop và Home responsive ngay cả khi plan đang
chạy. “Nhanh hơn nhưng làm treo UI” được tính là failure.

### 8.8 Quan sát, xác minh và phục hồi

Mỗi node phát progress, cost, resource, artifact và failure class. Core phát hiện:

- không có progress;
- lặp tool/model call;
- output không thay đổi;
- context/token tăng bất thường;
- agent đi lệch success criteria;
- dependency lỗi hoặc artifact stale;
- provider chậm, rate-limit hoặc outage.

Recovery order:

1. retry cùng node khi lỗi transient và còn budget;
2. sửa input/projection hoặc giảm phạm vi;
3. đổi tool/model/package nếu failure class cho thấy chiến lược không phù hợp;
4. replan dependency graph;
5. rollback side effect nếu verifier không pass;
6. hỏi người dùng khi thiếu quyền, constraint hoặc quyết định high impact;
7. dừng an toàn khi không còn phương án hợp lệ.

Retry phải có strategy fingerprint. Không lặp lại cùng input + model + tool + plan mà mong kết quả
khác nếu không có thay đổi giải thích được.

Verification ưu tiên evidence khách quan: test, build, file/artifact, API confirmation, before/after,
schema và rubric độc lập. User accept là evidence hợp lệ nhưng delayed revert phải cập nhật receipt.

### 8.9 Học từ outcome

Outcome Receipt tối thiểu ghi:

- intent/context class đã giảm chi tiết;
- plan graph shape và mức song song;
- package/Capsule/model/tool version;
- estimate so với actual time/cost/resource;
- verifier result, retry, fallback và recovery;
- user accept/edit/reject/revert;
- Security/Core policy version;
- final verified outcome.

Core học theo context, không tạo bảng xếp hạng model tuyệt đối. Ví dụ model A có thể tốt cho coding
nhỏ nhưng kém ở planning dài; ba subagent có thể nhanh cho research nhưng lãng phí ở một bug đơn.

Online learning chỉ cập nhật routing weight trong bound an toàn. Thay đổi policy lớn phải qua offline
benchmark/canary; một outcome đơn lẻ không được đảo toàn bộ routing.

### 8.10 Vai trò của LLM

Core không cần một “siêu model điều phối” chạy ở mọi request. Kiến trúc chuẩn:

- deterministic engine giữ budget, dependency, permission, lease và state machine;
- model nhỏ ước lượng/routing khi rule không đủ;
- model mạnh lập/replan phần phức tạp;
- verifier độc lập kiểm tra outcome;
- Outcome Graph cung cấp evidence lịch sử;
- policy engine có quyền override model khi vi phạm hard gate.

LLM đề xuất plan; backend sở hữu state, quyền, ngân sách và quyết định thực thi cuối cùng.

### 8.11 SLO và mục tiêu định lượng

Các con số dưới đây là **release target cần benchmark**, không phải trạng thái hiện tại:

| Chỉ số | MVP target | Mature target |
| --- | ---: | ---: |
| supported goal → verified outcome | ≥ 65% | ≥ 80% |
| first-pass verified success | ≥ 55% | ≥ 70% |
| giảm time/outcome so với single-agent baseline | ≥ 15% | ≥ 30% |
| giảm model cost/outcome | ≥ 15% | ≥ 30% |
| giảm model/tool call không cần thiết | ≥ 25% | ≥ 40% |
| recovery thành công với lỗi recoverable | ≥ 60% | ≥ 80% |
| estimate time/cost nằm trong ±30% | ≥ 70% case | ≥ 85% case |
| deterministic routing p95 | < 100 ms | < 50 ms |
| complex planning overhead p95 | < 2 giây | < 1.5 giây |
| explicit user override | 100% | 100% |
| `Auto` chỉ route từ live healthy inventory | 100% | 100% |
| manual CLI/model pin bị đổi âm thầm | 0 | 0 |
| zero-evidence candidate được gắn `UNKNOWN` | 100% | 100% |
| unbounded agent loop | 0 | 0 |
| Security policy bypass | 0 | 0 |
| UI freeze do orchestration trên baseline | 0 | 0 |

Mục tiêu sản phẩm cảm nhận được:

- task đơn không bị phức tạp hóa bởi nhiều agent;
- task lớn chạy song song khi thật sự có lợi;
- người dùng thấy progress, budget và lý do replan;
- thất bại được phục hồi hoặc dừng rõ ràng, không quay vòng vô hạn;
- cùng loại task trở nên nhanh/rẻ/chính xác hơn theo thời gian;
- kết quả tốt hơn phải lớn hơn latency và chi phí do chính Orchestrator tạo ra.

### 8.12 Benchmark và release gate

Benchmark tối thiểu gồm:

1. task một bước mà spawn subagent là lãng phí;
2. task có ba nhánh độc lập hưởng lợi từ parallelism;
3. task dependency tuần tự không được chạy sai thứ tự;
4. context lớn cần projection thay vì fan-out raw context;
5. provider rate-limit/outage và model fallback;
6. tool trả output sai nhưng nghe hợp lý;
7. agent loop, stalled progress và duplicate call;
8. RAM/VRAM pressure khi IDE, browser, OCR và agent cùng hoạt động;
9. Security Core trả transform/ask/local-only/block;
10. User Understanding projection mâu thuẫn với chỉ dẫn hiện tại;
11. package chưa cài, version lỗi hoặc entitlement thiếu;
12. cancel, rollback và recovery giữa side effect.
13. CLI/provider/model mới xuất hiện sau khi app đã phát hành;
14. zero-outcome candidate, cold-start probe và exploration budget;
15. manual CLI/model pin hết quota hoặc mất health;
16. `Auto` chọn khác nhau theo task nhưng vẫn giải thích được evidence.

Release chỉ pass khi so với baseline cố định: một model mặc định, không adaptive routing và không
subagent. Phải báo quality, time, cost, resource, recovery và orchestration overhead; không chỉ chọn
metric có lợi.

### 8.13 Lộ trình triển khai

1. **Deterministic MVP:** GoalSpec, RuntimeInventory, budget, task state machine, health và hard gate.
2. **Execution graph:** dependency, bounded parallelism, lease và cancellation.
3. **Verification/recovery:** verifier contract, retry fingerprint, fallback và rollback.
4. **Outcome Receipt:** estimate/actual, version binding và benchmark baseline.
5. **Adaptive routing:** cold-start ladder, context-scoped statistics, scoring và exploration budget.
6. **Model-assisted planning:** planner/replanner cho case phức tạp, backend vẫn giữ quyền.
7. **Cross-core integration:** SecurityEnvelope và UserProjection trong plan contract.
8. **Production gate:** stress, outage, cost, resource, regression và user-visible audit.

### 8.14 Quyết định đã chốt

- Efficiency Orchestrator là policy layer của Outcome Engine, không tạo runtime trùng.
- Tối ưu verified outcome trên time/cost/resource/risk, không tối ưu số agent hoặc token đơn lẻ.
- Chọn direct execution trước; subagent chỉ dùng khi expected gain vượt coordination overhead.
- Chỉ Efficiency Orchestrator quyết định spawn/subagent plan; Security và User Understanding chỉ cung cấp constraint/projection.
- Mọi plan có hard budget, bounded depth/concurrency/retry và ResourceCoordinator lease.
- Security Core và explicit user instruction là hard constraint, không phải trọng số có thể đánh đổi.
- User Understanding Core cung cấp UserFit nhưng không được ghi đè success criteria hiện tại.
- LLM đề xuất plan; deterministic backend giữ state, permission, budget và execution authority.
- Verification và recovery là thành phần bắt buộc; output trôi chảy không đồng nghĩa thành công.
- Routing học theo context/version từ Outcome Receipt và phải benchmark chống baseline.
- Chat mặc định `Auto`; manual CLI/model pin được tôn trọng và chỉ fallback sau khi giải thích/xin phép.
- Mọi Auto decision bắt đầu từ RuntimeInventory live; planner không dựa vào tên model ghi nhớ trong weights.
- Model/CLI zero-outcome dùng capability probe, micro-benchmark, contextual exploration và trạng thái `UNKNOWN`; không cần fine-tune lại chỉ để nhận diện phiên bản mới.
- Mục tiêu mature là ≥80% verified outcome cho supported goals, giảm khoảng 30% time và cost/outcome.


## 9. Ranh giới dữ liệu

### 9.1 Luôn local hoặc E2EE

Không đưa lên Reputation Graph:

- prompt, chat và file content;
- source code và artifact;
- path, URL chi tiết và danh tính;
- secret, token, cookie và browser session;
- tool argument/output thô;
- private Work Graph;
- log có dữ liệu người dùng;
- quan hệ cá nhân/team/customer.

### 9.2 Chỉ tổng hợp khi opt-in

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

## 10. Outcome Reputation Graph

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

### 10.1 Chống gian lận

- không nhận self-report từ package;
- artifact/publisher/version có chữ ký;
- version mới không tự kế thừa toàn bộ uy tín;
- minimum sample và confidence interval;
- time decay khi model/runtime thay đổi;
- phát hiện Sybil và anomaly;
- audit ngẫu nhiên;
- review/star chỉ là tín hiệu phụ.

### 10.2 Công bằng cho package mới

- exploration budget;
- discovery lane cho package mới;
- hiển thị confidence;
- curated starter collection;
- quyền chọn thủ công;
- creator appeal khi ranking hoặc moderation sai.

## 11. Agentic Package Standard

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

## 12. Creator flywheel

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

## 13. Vì sao khó bị sao chép

Không có feature tuyệt đối không thể copy. Mục tiêu là khiến đối thủ copy UI nhưng không copy ngay được:

1. Lịch sử verified outcomes theo intent/package/version/model.
2. Mạng creator đang có doanh thu và reputation.
3. Standard đã được app bên ngoài sử dụng.
4. Private Work Graph làm routing ngày càng phù hợp với từng người/team.
5. Lịch sử trust, audit và xử lý sự cố đã được chứng minh.
6. Tính trung lập giữa model/provider/CLI, trong khi nền tảng lớn có động cơ lock-in.
7. Thói quen dùng Tomny để đi từ goal đến outcome thay vì mở từng tool.

Moat chỉ hình thành nếu vòng lặp được khởi động sớm và đo kết quả thật. Số lượng tính năng không tạo moat.

## 14. North-star metric

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

## 15. Các giả thuyết phải kiểm chứng sớm

1. Người dùng có muốn giao goal cho Engine thay vì tự mở app không?
2. Verification có phản ánh giá trị thật hay chỉ pass kỹ thuật?
3. Work Graph có cải thiện routing đủ lớn để người dùng cảm nhận không?
4. Creator có tối ưu theo outcome và kiếm được tiền không?
5. Người dùng có tin privacy boundary và receipt không?
6. Chi phí AI cho mỗi outcome có giữ được gross margin không?

Nếu người dùng luôn bỏ qua Engine và chỉ mở app thủ công, giả thuyết core chưa đạt; không được che giấu bằng tăng số app.

## 16. Failure modes và kiểm soát

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

## 17. Quyết định đã chốt

- Defensible Core là **Outcome Engine + Private Work Graph + Outcome Reputation Graph**.
- Agentic Package Standard và Creator Marketplace là động cơ phân phối.
- Trust Layer bảo vệ và tạo evidence, nhưng không được coi là moat duy nhất.
- Không thu raw user data để xây lợi thế.
- Không hứa hiệu quả AI 100%; đo xác suất, evidence, cost và risk.
- Thành công được đo bằng verified outcomes, không bằng số app hoặc lượt đăng ký.

## 18. Tài liệu liên quan

- [Hub Agent OS Migration Design](tomni-hub-agent-os-migration-design.md)
- [Package Platform Design](tomni-package-platform-design.md)
- [Execution Roadmap](tomni-hub-agent-os-execution-roadmap.md)
- [Core research](../../../core.md)
