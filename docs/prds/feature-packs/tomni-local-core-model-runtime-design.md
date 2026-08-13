# Tomny Local Core Model Runtime — Decisions and Validation Plan

> **Trạng thái:** Working design note — tổng hợp quyết định thảo luận ngày 2026-07-24  
> **Đường dẫn dự kiến trong repo:** `docs/prds/feature-packs/tomni-local-core-model-runtime-design.md`  
> **Phạm vi:** khả năng giữ người dùng, first-use experience, cách phát triển/train Core, mô hình local 0.8B/2B, cài đặt model theo phần cứng, degraded mode, Local Inference Broker và headless MCP runtime.

---

## 1. Luận điểm sản phẩm

Ba vấn đề dưới đây là một vòng duy nhất, không phải ba hạng mục tách biệt:

```text
Lần đầu tạo được giá trị thật
→ sinh Outcome Receipt và feedback
→ Core học đúng người, đúng việc
→ lần sau tốt hơn, nhanh hơn, ít tốn hơn
→ người dùng quay lại
→ dữ liệu chất lượng tăng
→ Core tiếp tục mạnh lên
```

Tomny không nên giữ người dùng bằng số lượng tính năng, khóa dữ liệu hoặc giao diện gây nghiện. Khả năng giữ người dùng phải đến từ ba cảm giác tăng dần:

1. **Lần đầu:** Tomny làm được việc thật.
2. **Sau một thời gian:** Tomny hiểu cách người dùng làm việc.
3. **Khi đã dùng lâu:** công việc, app, agent, package, lịch sử và cách làm của người dùng cùng tồn tại trong Tomny.

---

## 2. Khả năng giữ người dùng của Core

### 2.1 Năm tầng giữ chân

| Tầng | Thành phần | Giá trị giữ chân |
| --- | --- | --- |
| Giá trị | Outcome Engine | Hoàn thành công việc thay vì chỉ trả lời |
| Cá nhân hóa | Private Work Graph + User Understanding | Ngày càng hiểu đúng cách người dùng làm việc |
| Hiệu suất | Efficiency Orchestrator | Chọn model, package, agent và tài nguyên phù hợp |
| Tin cậy | Privacy Compiler + receipts | Cho phép người dùng giao nhiều quyền hơn mà vẫn kiểm soát được |
| Hệ sinh thái | Apps, Agent Capsules, Store, Creator | Năng lực tăng dần theo hệ sinh thái |

### 2.2 Switching value, không phải lock-in

Người dùng ở lại vì Tomny tích lũy được:

- dự án và công việc đang làm;
- outcome nào thực sự được chấp nhận;
- cách làm nào từng thất bại;
- package/model nào phù hợp từng loại việc;
- lúc nào người dùng muốn tự động, lúc nào muốn duyệt;
- preference chỉ đúng trong một bối cảnh cụ thể;
- lịch sử correction, reject, revert và verified outcome.

Dữ liệu vẫn phải local-first, có thể xem, sửa, export, reset và xóa.

### 2.3 Điều chưa thể tuyên bố hoàn tất

Core chỉ được coi là giữ chân người dùng khi có dữ liệu thật chứng minh:

- goal → verified outcome đủ cao;
- người dùng quay lại giao goal lần hai;
- W4/W12 retention đạt gate;
- số lần phải nhắc lại preference giảm;
- first-pass acceptance tăng;
- người dùng dùng nhiều hơn một package vì giá trị thực, không phải vì onboarding ép dùng.

---

## 3. Cuốn hút người dùng từ lần đầu

### 3.1 Wow moment

Wow moment không phải giao diện đẹp hoặc nhiều agent chạy. Nó phải là:

> Người dùng chỉ nói mục tiêu; Tomny tự hiểu cần dùng gì, thực hiện thật, bảo vệ dữ liệu và chứng minh kết quả.

Ví dụ developer:

```text
Người dùng chọn repo
→ “Hãy tìm nguyên nhân build lỗi và sửa nó”
→ Tomny đọc repo
→ đề xuất success criteria: build pass, test không hỏng
→ chọn IDE/CLI/model/tool
→ giữ secret local
→ sửa code
→ chạy build/test
→ trình bày diff + evidence + undo
```

### 3.2 Luồng first-use đề xuất

1. Hỏi một câu duy nhất: **“Hôm nay bạn muốn Tomny hoàn thành việc gì?”**
2. Cho chọn workspace/folder và quyền tối thiểu.
3. Tomny đề xuất success criteria như một “hợp đồng kết quả”.
4. Tomny tự chọn model/package/tool nhưng cho xem lý do.
5. Hiển thị milestone có ý nghĩa, không đổ log hỗn loạn.
6. Kết thúc bằng artifact, evidence, Outcome Receipt và undo.
7. Thu feedback tối thiểu:

```text
[Đúng] [Cần chỉnh] [Hoàn tác]
```

### 3.3 Không đưa quá sớm

- Store với hàng trăm package;
- Company nhiều tầng;
- quá nhiều model selector;
- dashboard CPU/GPU chi tiết;
- cấu hình policy phức tạp;
- tour dài giải thích toàn bộ Agent OS.

---

## 4. Core không phải một model duy nhất

Core là một hệ thống:

```text
Deterministic backend
+ Work Graph
+ rules/policy
+ retrieval
+ model nhỏ chuyên biệt
+ model/provider ngoài
+ feedback và Outcome Receipts
```

Không giao toàn bộ bảo mật, hiểu người dùng, routing và resource control cho một LLM.

---

## 5. Quyết định model local đã chốt

### 5.1 Chỉ có hai cấp model local mục tiêu

| Model | Vai trò chính |
| --- | --- |
| **0.8B** | Security semantic verifier/gate nếu benchmark chứng minh cần thiết |
| **2B** | User Understanding, App Assistant và reasoning hỗ trợ Efficiency Orchestrator |

### 5.2 Không dùng 4B local

- 2B là local reasoning ceiling.
- Không thiết kế 4B như một model bắt buộc hoặc escalation local.
- Khi 2B không đủ chắc chắn:
  - dùng model API đang phục vụ task qua Privacy Compiler;
  - hoặc hỏi người dùng;
  - hoặc abstain;
  - không âm thầm đoán.

### 5.3 Efficiency Orchestrator không sở hữu model riêng

MVP dùng:

- deterministic rules;
- capability metadata;
- compatibility/health;
- budget;
- resource snapshot;
- outcome statistics;
- classifier nhỏ nếu cần.

Khi reasoning phức tạp mới dùng chung 2B. Không tạo model thứ ba chỉ dành cho orchestration.

---

## 6. Vai trò mở rộng của model 2B

2B không chỉ dùng cho User Understanding. Nó còn là **Tomny Core Reasoner/App Assistant** cho các hành động nội bộ đơn giản, không chuyên code hoặc văn phòng sâu.

### 6.1 Nhiệm vụ phù hợp

- trả lời câu hỏi về Tomny và chức năng trong app;
- tìm và giải thích cài đặt;
- đề xuất app/package phù hợp;
- hỗ trợ cài package;
- giải thích lỗi và trạng thái hệ thống;
- phân loại intent nội bộ;
- tạo kế hoạch thao tác ngắn trong app;
- hiểu preference và lịch sử liên quan;
- phân loại nguyên nhân accept/edit/reject/revert;
- hỗ trợ Efficiency Orchestrator khi rule không đủ.

### 6.2 Giới hạn quyền

2B không trực tiếp:

- cài/gỡ package;
- cấp quyền;
- sửa cài đặt nhạy cảm;
- chạy lệnh;
- xóa dữ liệu;
- mở network;
- nới policy;
- điều khiển tài nguyên.

Model chỉ trả output có schema. Backend kiểm tra compatibility, permission, entitlement và yêu cầu xác nhận trước khi thực thi.

Ví dụ:

```json
{
  "intent": "install_package",
  "packageId": "com.tomny.browser",
  "reason": "Người dùng cần tự động hóa trình duyệt",
  "requiresConfirmation": true
}
```

### 6.3 Một base model, nhiều contract

Giai đoạn đầu dùng một base 2B với các system contract/output schema khác nhau:

```text
Qwen 2B Base
├─ App Assistant contract
├─ User Understanding contract
└─ Orchestrator reasoning contract
```

Chỉ tách LoRA/adapter khi benchmark chứng minh multitask gây nhiễu hoặc adapter chuyên biệt tạo lift rõ ràng.

---

## 7. EXE không đóng gói model weights

### 7.1 Base EXE chỉ chứa runtime

```text
Tomny.exe
├─ Hardware Profiler
├─ Model Catalog Client
├─ Model Downloader
├─ Hash/Signature Verifier
├─ Local Inference Broker
├─ Deterministic Security Layer
├─ Rule-based Efficiency Orchestrator
└─ Retrieval/Explicit Memory primitives
```

Không bundle 0.8B hoặc 2B vào installer mặc định.

### 7.2 Lợi ích

- installer nhẹ;
- máy yếu không phải tải model không chạy được;
- model cập nhật độc lập;
- artifact phù hợp từng kiến trúc/phần cứng;
- có thể dùng AI local sẵn có của người dùng;
- rollback model độc lập với app;
- không cần nhiều bản EXE khác nhau.

---

## 8. Thiết lập ban đầu và chọn model theo máy

### 8.1 Hardware profiling local

Tomny đọc cục bộ:

- CPU và instruction support;
- tổng RAM và RAM còn trống;
- GPU, VRAM và driver;
- dung lượng ổ đĩa;
- inference backend khả dụng;
- tải nền hiện tại.

Không gửi thông số máy ra ngoài nếu chưa có permission.

### 8.2 Micro-benchmark

Thông số trên giấy chưa đủ. Tomny nên chạy micro-benchmark nhẹ để đo:

- load time;
- tokens/s hoặc classification latency;
- peak RAM/VRAM;
- UI degradation;
- khả năng chạy CPU fallback;
- stability trên driver/runtime hiện tại.

### 8.3 Gợi ý theo profile, không ép người dùng hiểu quantization

#### Cơ bản

```text
Không tải model local
→ dùng app ở chế độ thủ công/degraded
→ Auto Mode đầy đủ không khả dụng
```

#### Security Local

```text
Tải model 0.8B nếu model này vượt benchmark giá trị
→ semantic security review local
```

#### Auto Local

```text
Tải Core Reasoner 2B
→ User Understanding
→ App Assistant
→ reasoning hỗ trợ orchestration
```

#### Dùng AI local hiện có

```text
Kết nối Ollama / LM Studio / local OpenAI-compatible endpoint
→ conformance test
→ benchmark
→ gán vai trò phù hợp
```

### 8.4 Auto Mode

- Người dùng có thể bỏ qua model download trong onboarding.
- Khi bật Auto Mode mà chưa có model phù hợp, Tomny yêu cầu tải hoặc kết nối model.
- Nếu người dùng từ chối, Auto Mode không hoạt động; phần còn lại của app vẫn dùng được.
- Không được làm toàn bộ Tomny vô dụng chỉ vì chưa tải local model.

---

## 9. Degraded mode khi không có local model

| Thành phần | Hành vi không có model local |
| --- | --- |
| Security Core | Deterministic Layer 1 vẫn chạy; semantic review không có |
| User Understanding | Retrieval, explicit memory và rule; không reasoning sâu |
| Efficiency Orchestrator | Rule, compatibility, health, resource và statistics |
| App Assistant | Dùng API ngoài nếu policy cho phép hoặc bị giới hạn |
| Auto Mode | Tắt hoặc yêu cầu tải/kết nối model |

### 9.1 Bất biến

Không có model local không có nghĩa là bỏ toàn bộ bảo mật.

```text
Không có semantic model
→ deterministic scan
→ rõ an toàn: allow
→ rõ nguy hiểm: transform/block
→ chưa chắc: ASK hoặc LOCAL_ONLY
```

Không fail-open và không gửi dữ liệu thô ra API chỉ để hỏi API xem dữ liệu đó có an toàn hay không.

---

## 10. Agent, subagent và Team

### 10.1 Không gọi 2B cho từng subagent

```text
Task intake
→ Core 2B chạy ở root khi cần
→ tạo User Projection + Execution Policy
→ root orchestrator chia việc
→ agent/subagent nhận projection tối thiểu
```

Subagent/Team không tự gọi User Understanding 2B cho từng bước. Chỉ root hoặc lifecycle hook có thẩm quyền mới gọi lại khi có context shift/replan lớn.

### 10.2 Security vẫn áp dụng ở egress

Subagent có thể bỏ qua 2B, nhưng outbound request vẫn phải qua:

```text
Receipt/cache
→ deterministic security gate
→ semantic review chỉ khi policy yêu cầu và model khả dụng
```

---

## 11. Có thể dùng AI local hiện có của người dùng

### 11.1 Thay 2B mặc định

Model local của người dùng có thể đảm nhận Core Reasoner nếu đạt conformance:

- tốc độ phù hợp;
- context tối thiểu;
- JSON/schema stability;
- tiếng Việt đủ tốt;
- intent/tool classification;
- không có network ngoài ý muốn;
- benchmark User Understanding/App Assistant/Orchestrator đạt ngưỡng.

### 11.2 Security có tiêu chuẩn riêng

Không dùng tùy ý bất kỳ model nào làm Security Verifier. Model phải:

- chạy local/no-network;
- có hash/version rõ;
- đạt Security Conformance Test;
- đạt recall và false-positive gate;
- trả output schema bắt buộc;
- không được tự thực thi transformation hoặc cấp permission.

Nếu model người dùng không đạt, Tomny dùng backend-only conservative mode hoặc đề xuất model chính thức.

---

## 12. Phân phối model pack

Hugging Face có thể là nguồn artifact ban đầu, nhưng Tomny không phụ thuộc trực tiếp vào URL cố định.

### 12.1 Model manifest

```json
{
  "id": "tomny-core-reasoner-2b",
  "version": "1.0.0",
  "source": "huggingface",
  "artifact": "model-artifact-url",
  "size": 0,
  "sha256": "...",
  "signature": "...",
  "runtime": "gguf",
  "hardwareProfiles": ["cpu", "4gb-vram"],
  "license": "...",
  "policyVersion": "core-policy-v1"
}
```

### 12.2 Lifecycle

```text
Tomny Model Catalog
→ chọn artifact theo hardware profile
→ tải từ HF hoặc mirror
→ kiểm tra hash
→ kiểm tra chữ ký Tomny
→ stage
→ benchmark
→ activate
→ rollback/quarantine nếu lỗi
```

---

## 13. Local Inference Broker và Model Residency

Ba core không được tự load/unload model.

```text
ResourceCoordinator
└─ Local Inference Broker
   ├─ Model Registry
   ├─ Residency Manager
   ├─ Priority Queue
   ├─ CPU/GPU Placement
   ├─ Runtime/Adapter Pool
   └─ Load/Unload/Hysteresis Policy
```

### 13.1 Request contract ví dụ

```yaml
purpose: user_preference_reasoning
priority: P1
deadlineMs: 1500
modelClass: core_reasoner
allowedDevices: [gpu, cpu, external]
fallback: cached_projection_or_abstain
```

### 13.2 Priority

```text
Security foreground
> user-facing execution
> User Understanding/App Assistant
> optional orchestration reasoning
> background consolidation/index/benchmark
```

### 13.3 Chống model thrashing

- không swap model cho request nhỏ nếu fallback đủ tốt;
- batch request theo task;
- cache projection trong suốt task;
- giữ 2B trong execution window có hysteresis;
- giới hạn residency transition trên mỗi task;
- 0.8B nếu tồn tại nên có CPU path ổn định;
- không để swap cost lớn hơn lợi ích dự kiến.

### 13.4 Metrics

- `model_load_count/task`;
- `model_swap_count/task`;
- `residency_wait_p95`;
- `security_gate_wait_p95`;
- `peak_vram`;
- `cpu_fallback_rate`;
- `external_fallback_rate`;
- `queue_wait / compute_time`;
- `UI frame degradation`.

---

## 14. 0.8B có thật sự cần thiết không?

### 14.1 Quyết định hiện tại

**0.8B chưa phải thành phần bắt buộc. Đây là giả thuyết kỹ thuật cần benchmark.**

Backend-only phải an toàn và hoạt động được trước. 0.8B chỉ được giữ nếu chứng minh tạo thêm giá trị đáng kể.

### 14.2 Backend deterministic làm tốt

- API key, token, password, cookie, private key;
- email, số điện thoại, ID, tài khoản theo pattern;
- secret fingerprint/Vault mapping;
- permission và workspace boundary;
- domain/network allowlist;
- OCR text, QR, metadata;
- file type, archive, macro/executable;
- masking, pseudonymization và capability handle.

Ưu điểm: nhanh, audit được, ổn định, ít tài nguyên và không hallucinate.

### 14.3 Giá trị tiềm năng của 0.8B

0.8B chỉ có lý do tồn tại ở lớp semantic:

1. Dữ liệu nhạy cảm không có pattern rõ.
2. Nhiều thuộc tính riêng lẻ ghép lại có thể tái nhận dạng.
3. Phân biệt dữ liệu cần cho task và dữ liệu thừa.
4. Nhận ra prompt injection/social engineering trước khi secret xuất hiện.
5. Hiểu ngữ cảnh screenshot/document mà OCR đơn thuần không giải quyết được.
6. Tạo transformation plan để giữ task utility thay vì block tất cả.

### 14.4 Giới hạn

- có thể bỏ sót hoặc báo nhầm;
- tiếng Việt có thể yếu;
- tăng latency/RAM/VRAM;
- cần fine-tune, benchmark và bảo trì;
- khó audit hơn deterministic rule.

0.8B không có quyền quyết định cuối cùng. Nó chỉ tạo candidate/classification/transformation plan; backend áp dụng, scan lại và quyết định.

### 14.5 Kiến trúc gọi có điều kiện

```text
Payload chuẩn bị rời máy
→ Backend Layer 1
→ đã rõ safe hoặc đã transform xong?
   ├─ Có → receipt → egress
   └─ Không → semantic model nếu có
              → backend validate output
              → transform
              → re-scan
              → allow / ask / local-only / block
```

Không gọi model semantic cho mọi request.

### 14.6 Benchmark bắt buộc

So sánh ba phương án:

| Phương án | Vai trò |
| --- | --- |
| Backend-only | baseline |
| Backend + 0.8B | đo lift riêng của model nhỏ |
| Backend + shared 2B | kiểm tra có cần model 0.8B riêng hay không |

Test set:

- credential rõ ràng;
- PII không có pattern;
- linked identity;
- task-required data;
- prompt injection;
- source code;
- screenshot/document;
- tiếng Việt có dấu/không dấu/Việt–Anh;
- safe hard negatives.

Metrics:

- critical leak recall;
- linked-identity recall;
- false-positive rate;
- safe-task completion rate;
- ASK rate;
- latency P50/P95;
- RAM/VRAM;
- stability;
- Vietnamese-specific performance.

### 14.7 Quy tắc quyết định

```text
Nếu backend-only đủ tốt
→ bỏ 0.8B.

Nếu 0.8B giảm semantic leak và giảm ASK rõ rệt
mà không gây chậm/tốn tài nguyên quá mức
→ cung cấp như Security Model Pack khuyên dùng.

Nếu shared 2B đạt tương đương
→ không duy trì model 0.8B riêng,
nhưng phải có security adapter/conformance riêng.
```

---

## 15. Cách phát triển và train

### 15.1 Trình tự chung

```text
1. Instrument schema/event/receipt
2. Xây deterministic baseline
3. Dogfood Tomny xây Tomny
4. Curate accept/edit/reject/revert và nguyên nhân
5. Train offline bằng synthetic + de-identified data
6. Shadow mode
7. So với baseline
8. Canary có rollback
9. Bounded learning
10. Version model/dataset/policy/receipt
```

### 15.2 Security

- prompt/schema baseline trước;
- synthetic + adversarial data;
- hard negatives;
- tiếng Việt riêng;
- fine-tune chỉ sau benchmark;
- model không đọc Vault hoặc tự mở network;
- không train bằng raw secret/private profile.

### 15.3 User Understanding

Không fine-tune một LoRA riêng cho từng người bằng raw chat. Dùng:

```text
Model chung
+ Work Graph riêng
+ retrieval theo task
+ scoped projection
```

Training sample:

```text
ContextFrame
+ UserState
+ Goal
+ candidate actions
+ decision hypothesis
+ supporting/counter evidence
+ accept/edit/reject/revert
+ verified outcome
→ prediction + confidence + abstain/update
```

### 15.4 Efficiency Orchestrator

Bắt đầu bằng rule và statistics. Sau khi có đủ Outcome Receipt mới train:

- complexity classifier;
- candidate ranker;
- spawn/no-spawn classifier;
- failure/retry/fallback predictor;
- cost/latency/resource estimator.

Không nhất thiết dùng LLM; có thể dùng gradient boosting, small MLP hoặc learning-to-rank.

---

## 16. Các chỉnh sửa chiến lược cần ghi nhận

### 16.1 Outcome validation phải chạy sớm

Không đợi package platform hoàn thiện mới thử Outcome Engine. Cần một Stage -1 dùng runtime hiện tại:

```text
Goal
→ success criteria
→ rule-based routing
→ execution
→ verifier
→ receipt
→ accept/edit/revert
```

Mục tiêu là kiểm chứng người dùng có thật sự muốn giao goal cho Engine và có quay lại giao goal lần hai hay không.

### 16.2 Causal modeling là research direction

Không tuyên bố đã chứng minh nguyên nhân từ observational data. Nên dùng thuật ngữ:

- `Contextual explanatory hypothesis`;
- hoặc `Decision mechanism hypothesis`.

MVP chỉ cần dự đoán tốt hơn baseline, biết khi nào không chắc chắn và không áp sai bối cảnh.

### 16.3 Tiếng Việt là benchmark lane riêng

Test riêng:

- có dấu;
- không dấu;
- Việt–Anh;
- văn nói/teencode;
- tên người/địa phương Việt Nam;
- phủ định, mỉa mai, ngữ cảnh ngầm;
- PII/prompt injection/correction/reject bằng tiếng Việt.

### 16.4 Routing không dùng tổng tuyến tính thô

Dùng:

```text
Hard constraints
→ Quality floor
→ Pareto filtering
→ Contextual ranking
→ uncertainty/controlled exploration
```

Weights ban đầu theo task class và product policy; chỉ cá nhân hóa sau khi có outcome đủ chất lượng.

### 16.5 Rủi ro Big Tech

Rủi ro không phải chỉ là copy UI. Rủi ro thật:

> Platform incumbent đóng khoảng cách memory/outcome trước khi Tomny đạt đủ outcome history và creator liquidity.

Mitigation:

- chọn wedge cụ thể;
- ship sớm;
- local-first và user-owned;
- trung lập nhiều model/CLI;
- creator economics;
- portable context/standard;
- verified outcome theo context;
- không cạnh tranh trực diện ở general chat.

---

## 17. Headless MCP server

MCP server có thể chạy riêng mà không cần mở UI app.

### 17.1 stdio

```text
MCP client mở
→ spawn server process
→ giao tiếp stdin/stdout
→ client đóng thì server thường đóng
```

Phù hợp MCP nhẹ, chỉ dùng theo phiên.

### 17.2 Streamable HTTP background service

```text
Windows khởi động
→ MCP daemon/service chạy nền
→ bind 127.0.0.1:PORT/mcp
→ Tomny hoặc client khác kết nối khi cần
```

Có thể triển khai bằng:

- Windows Service;
- background daemon;
- startup process;
- tray process không cửa sổ;
- Docker/service manager.

### 17.3 Kiến trúc lai cho Tomny

```text
MCP Service Manager
├─ MCP cần luôn sẵn sàng → Streamable HTTP localhost
├─ MCP chỉ dùng theo phiên → stdio spawn-on-demand
└─ MCP idle lâu → tự tắt nếu policy cho phép
```

Local HTTP phải bind localhost, có auth/token hoặc client identity, kiểm tra origin và không public port mặc định.

---

## 18. Quyết định đã chốt

1. EXE không bundle model weights.
2. Chỉ định hướng hai model local: 0.8B và 2B; không dùng 4B local.
3. 2B kiêm User Understanding, App Assistant và reasoning hỗ trợ Orchestrator.
4. Efficiency Orchestrator không có model riêng.
5. Model được chọn sau hardware profile + micro-benchmark rồi mới tải.
6. Người dùng có thể bỏ qua model; Auto Mode đầy đủ yêu cầu model phù hợp.
7. Có thể dùng AI local hiện có sau conformance test.
8. Subagent/Team không gọi 2B riêng cho từng bước.
9. Security deterministic không bị bỏ qua dù không có local model.
10. 0.8B chưa bắt buộc; chỉ giữ nếu benchmark chứng minh lift đủ lớn.
11. Mọi model local do một Local Inference Broker quản lý.
12. MCP server có thể chạy headless bằng stdio hoặc Streamable HTTP background service.

---

## 19. Câu hỏi còn mở

1. Backend-only đạt mức recall và ASK rate nào trên test tiếng Việt?
2. 0.8B tạo lift bao nhiêu so với backend-only?
3. Shared 2B có thể thay 0.8B mà không làm tăng latency/risk không?
4. 0.8B nên CPU-resident hay GPU-on-demand trên baseline 4 GB VRAM?
5. Conformance threshold cho model local của người dùng là bao nhiêu?
6. Auto Mode tối thiểu cần 2B hay có thể có một Auto Lite deterministic?
7. Model catalog nên là package type riêng hay system artifact bên trong Base services?
8. MCP nào cần daemon luôn chạy, MCP nào chỉ spawn theo phiên?
9. Outcome wedge đầu tiên dùng để validate retention là use case nào?
10. Dataset tiếng Việt ban đầu lấy từ synthetic/adversarial pipeline nào?

---

## 20. Bước tiếp theo đề xuất

1. Thêm tài liệu này vào PRD index.
2. Sửa `tomni-defensible-core-design.md` để bỏ mọi 4B local escalation.
3. Ghi rõ 0.8B là optional security hypothesis, không phải dependency mặc định.
4. Bổ sung Local Inference Broker/Model Residency contract.
5. Viết benchmark plan: backend-only vs 0.8B vs shared 2B.
6. Viết hardware profiler + model catalog contract.
7. Chọn một Outcome Engine Stage -1 vertical slice.
8. Benchmark riêng tiếng Việt trước khi quyết định fine-tune.
---

## 21. Production Design - Model Pack and Model Adapter Lifecycle

> **Status:** implementation contract - 2026-07-25  
> **Delivery rule:** freeze the contract first; implement backend, data/evaluation, and trainer concurrently; no adapter receives active traffic before promotion gates pass.

### 21.1 Names and trust boundaries

| Concept | Content | Can execute code |
| --- | --- | --- |
| `CoreAdapter` | Codex/Claude/ACP/CLI protocol adapter in `experimentalCore` | yes, within capability policy |
| `AppPackage` / `CapsulePackage` / `UiPackage` | product package distributed through Store | only as declared and approved |
| `BaseModelPack` / `ModelAdapterPack` | weights, tokenizer, adapter config, provenance, evaluation | **never** |

LoRA artifacts must not enter the existing `CoreAdapter` registry. A Model Pack cannot contain scripts, native binaries, pickle files, or post-install hooks. Weight files are limited to `safetensors`; metadata is limited to allowlisted JSON, Jinja, and text files with size limits.

### 21.2 Product decisions

1. Build lifecycle and backend before a qualified adapter exists, but allow only `candidate` and `shadow` use.
2. Use one 2B base with purpose-specific LoRA hotswap. The 0.8B Security model remains an optional hypothesis.
3. Expose Model Packs through Model Manager/system details first; do not mix them with commercial App/Package listings.
4. Artifacts are immutable by `(id, version, sha256)`. Never overwrite a published version.
5. Deterministic/rule fallback always remains available. Missing, stale, failed, or quarantined adapters must fail closed.

### 21.3 Target architecture

```text
Signed Model Catalog
  -> bounded HTTPS downloader
  -> staging
  -> integrity, signature, and manifest verification
  -> compatibility check (base hash, runtime, schema, policy)
  -> conformance and micro-benchmark
  -> Model Registry (candidate/shadow/pilot/active/quarantined)
  -> Local Inference Broker
       -> one resident base model
       -> named adapter slots / LoRA hotswap
       -> priority queue, deadline, and resource lease
       -> output schema validator
       -> deterministic fallback or abstention
  -> receipts, health, rollback, and audit events
```

The model catalog has its own schema and lifecycle. Its backend reuses Package Platform security primitives: credential-free HTTPS, size limits, hashes, signatures, staging, atomic rename, quarantine, and cleanup.

### 21.4 Immutable Model Adapter Pack manifest

```json
{
  "schemaVersion": 1,
  "kind": "model-adapter",
  "id": "com.tomny.core.user-understanding",
  "version": "0.1.0-candidate.1",
  "purpose": "user-understanding",
  "format": "peft-lora-safetensors",
  "baseModel": {
    "id": "Qwen/Qwen3.5-2B",
    "revision": "immutable-revision",
    "sha256": "base-model-content-hash"
  },
  "runtime": {
    "engine": "transformers-peft",
    "peft": ">=0.18.1 <0.19.0",
    "transformers": ">=5.5.0 <5.6.0",
    "minTomnyVersion": "0.0.0"
  },
  "contracts": {
    "inputSchema": "tomny.user-understanding.input.v1",
    "outputSchema": "tomny.user-understanding.output.v1",
    "policyVersion": "core-policy-v1"
  },
  "files": [
    { "path": "adapter_model.safetensors", "size": 0, "sha256": "..." },
    { "path": "adapter_config.json", "size": 0, "sha256": "..." }
  ],
  "training": {
    "datasetManifestSha256": "...",
    "recipeSha256": "...",
    "seed": 20260725,
    "provenanceSha256": "..."
  },
  "evaluation": {
    "reportSha256": "...",
    "benchmarkVersion": "tomny-core-v2",
    "status": "candidate"
  },
  "license": "Apache-2.0",
  "createdAt": "RFC-3339 timestamp"
}
```

The catalog entry adds artifact URL and size, signature/key id, catalog revision, and expiry. The client never trusts publisher-declared promotion status; local verification and evaluation own that state.

### 21.5 State machine and promotion

```text
discovered -> downloading -> staged -> verified -> candidate
           -> shadow -> pilot -> active -> superseded

integrity/schema/runtime/quality failure -> quarantined
active health/regression failure -> previous active or deterministic fallback
```

- Only `active` handles official traffic.
- `shadow` cannot decide actions and logs only privacy-safe comparison receipts.
- `pilot` requires an allowlisted cohort and kill switch.
- Promotion uses compare-and-swap on registry revision.
- Keep active and previous-active artifacts until the observation window and rollback drill pass.

### 21.6 Runtime contracts

```ts
type CoreModelRequest = {
  requestId: string;
  purpose: 'security' | 'user-understanding' | 'orchestrator' | 'assistant';
  contractVersion: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  deadlineMs: number;
  payload: unknown;
  fallback: 'deterministic' | 'base-model' | 'abstain';
};
```

A response binds base/adapter/contract versions, latency, fallback use, validation result, and receipt id. Model output never directly causes a side effect; backend validation covers schema, enums, permission, compatibility, and confirmation.

### 21.7 Backend workstream

1. Strict `ModelPackManifest` parser with traversal, type, size, hash, and base-binding checks.
2. Atomic revisioned `ModelRegistryStore` with promotion, quarantine, and rollback.
3. `ModelArtifactInstaller` reusing Package Platform security primitives while banning executable content.
4. `LocalInferenceBroker` interface plus a fake provider so lifecycle tests do not depend on trained weights.
5. Health/status/audit receipts and purpose routing with deterministic fallback.
6. Tests for tampering, wrong base hash, downgrade, concurrent promotion, crash recovery, and rollback.

Do not expand `experimentalCore/CoreAdapter`. The Model Pack runtime belongs in an Electron Main service; renderer access must cross IPC/preload.

### 21.8 Data and evaluation workstream

- Split train/validation/test by semantic group. Trainer cannot read the immutable test split.
- Detect exact, fuzzy, template, and semantic leakage.
- Dataset card records source, license/consent, languages, label distribution, privacy scans, dedup, hashes, and reviewer status.
- Synthetic-only data can produce a candidate, not a pilot. Pilot requires an independent human-reviewed set or consented/redacted production traces.
- Use closed ontologies for exact-scored fields. Open text fields require an auditable rubric/semantic evaluator.
- Benchmark strict whole-output JSON, minimum independent groups, clustered confidence intervals, paired comparison, critical/catastrophic cases, Vietnamese/English parity, perturbations, latency, and resources.
- Missing sample evidence is `insufficient-evidence`, never an automatic pass. Correctness gates use confidence bounds when sample size permits.

### 21.9 Trainer workstream

- Consume only dataset manifest v2 and a versioned recipe.
- QLoRA NF4 with double quantization, assistant-only loss, and dynamic padding.
- Full validation, interval evaluation, checkpoint/resume, best-model selection, and early stopping.
- Record base revision/hash, seed, package versions, git revision, hyperparameters, token counts, curves, peak memory, and hashes.
- Write to versioned candidate directories; never overwrite `.model-adapters/<active>`.
- Fail on non-finite gradients/weights, zero target tokens, base mismatch, or validation regression.
- Select the 4 GB recipe through finite-gradient and memory smoke tests. Any narrow last-block profile must be labeled as a quality limitation.
- Verification runs after training; benchmark and promotion remain independent steps.

### 21.10 Deployment gates and current status

| Gate | Minimum evidence |
| --- | --- |
| Artifact | readable finite safetensors; valid manifest/hash/signature/base binding |
| Data | provenance, rights/consent, dedup/leakage report, independent test |
| Candidate | reproducible training, full validation, no catastrophic smoke failure |
| Shadow | stable schema/latency, no side effects, measurable baseline uplift |
| Pilot | task quality with uncertainty bounds, critical-risk floor, rollback drill |
| Production | pilot observation pass, no regression, signed immutable artifact, monitoring and kill switch |

All current adapters are `baseline/rejected`, not `active`: Security has no measured uplift; User Understanding and Assistant have zero composite score plus catastrophic cases; Orchestrator has uplift but fails pilot and production gates.

### 21.11 Store and package integration audit

After data/evaluation delivery, that workstream moves to end-to-end Store audit and maintains a status report:

- Remote catalog has a real URL, cache, revision/expiry, and explicit fallback.
- HTTPS artifact is actually downloaded; hash/signature match; installer does not already contain the package code.
- Install creates bytes under userData; uninstall removes or trashes artifact and registry state; restart preserves truth.
- Detail page shows publisher preview, version, changelog, compatibility with Tomny/app/runtime, download size, permissions, and state.
- Permission changes require confirmation; rollback and quarantine are observable.
- Installed packages contribute real capability/surface; uninstall removes it.
- Model Manager owns Model Pack details. Store may link to it but commercial packages cannot replace a Core model adapter.

The report classifies every path as `implemented`, `tested`, `mock-only`, `missing`, or `blocked-by-infrastructure`, with file/test/evidence and a named owner.

### 21.12 Parallel ownership

| Workstream | Owns | Must not change |
| --- | --- | --- |
| Backend | manifest, registry, installer/broker contract, tests | dataset/output schema |
| Data + Evaluation | dataset v2, benchmark v2, leakage report, then Store audit | trainer and promotion |
| Trainer | recipe, checkpoint/resume, provenance, verification, tests | backend and Store |
| Integrator | contract, production research, cross-review, gates, conflict resolution | gates to make results look successful |

The only shared boundary is the versioned manifest/schema in this document. Contract changes require integrator review before edits.

### 21.13 Primary references

- PEFT checkpoint and hotswap: `https://huggingface.co/docs/peft/main/developer_guides/checkpoint` and `https://huggingface.co/docs/transformers/peft`.
- QLoRA: `https://arxiv.org/abs/2305.14314`.
- NIST AI RMF TEVV and go/no-go: `https://airc.nist.gov/airmf-resources/airmf/5-sec-core/`.
- TUF rollback/freeze/mix-and-match defenses: `https://theupdateframework.github.io/specification/`.
- SLSA provenance: `https://slsa.dev/spec/v1.0/provenance`.
- Sigstore blob signing and verification: `https://docs.sigstore.dev/cosign/signing/signing_with_blobs/`.
- OWASP ML supply-chain and poisoning risks: `https://owasp.org/www-project-machine-learning-security-top-10/`.
