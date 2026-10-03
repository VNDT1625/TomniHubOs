# Feature Status — TomniHubOS

> Cập nhật: 2026-09-30 | Dựa trên code thực tế, không phải thiết kế mục tiêu.
> Nhãn: **WORKING** = đã chạy được; **PARTIAL** = chạy được một phần; **STUB** = code có nhưng không làm gì thật; **BLOCKED** = cần điều kiện ngoài.

---

## 1. Laya Decision Engine

**Mô tả:** Laya là "bộ não phán quyết" — một mô hình AI nhỏ chạy local (ONNX INT8, ~308MB), thay thế LLM generative để đưa ra quyết định nhanh, không tốn token. Thay vì hỏi GPT-4 "tin nhắn này có nguy hiểm không?", Laya tự làm trong ~33ms sau khi khởi động.

**Vai trò thực tế trong code:**

| Vai trò                                  | File                         | Trạng thái                                               |
| ---------------------------------------- | ---------------------------- | -------------------------------------------------------- |
| Phát hiện credential/PII trong tin nhắn  | `layaSecurityStage.ts`       | **WORKING** (với fallback regex nếu Laya chưa sẵn sàng)  |
| Phát hiện prompt injection tấn công      | `layaSecurityStage.ts`       | **WORKING** (regex hardcoded + Laya xác nhận)            |
| Phân loại intent: mở URL, file, GitHub   | `directActionStage.ts`       | **WORKING** (Laya xác nhận + regex fallback)             |
| Phân loại tool domain: code/browser/chat | `toolRouterStage.ts`         | **WORKING** (Laya xác nhận + regex fallback)             |
| Phân loại model nào phù hợp nhất         | `modelRoutingStage.ts`       | **STUB** (stage tắt mặc định, chưa dùng)                 |
| Kiểm tra bảo mật egress outbound         | `layaSemanticEgressModel.ts` | **PARTIAL** (logic đầy đủ, chưa gắn vào chat flow chính) |

**Vấn đề hiện tại — đã fix:**

- Sidecar Python mất ~26 giây để khởi động (load ONNX model + tokenizer)
- Trước đây: code gửi request xuống sidecar TRONG KHI nó vẫn đang load → timeout 1-5s → luôn fallback về regex
- **Fix đã áp dụng:** `predict()` nay `await` quá trình khởi động; bridge.ts khởi động sidecar sớm (warm-up) khi app mở

**Kết luận Laya:** Cơ sở hạ tầng **hoàn chỉnh**. Sau fix, Laya sẽ thực sự chạy neural thay vì chỉ chạy regex. Cần ~26s warm-up lần đầu sau khi mở app.

---

## 2. Chat Pipeline

**Mô tả:** Chat Pipeline là hệ thống "cổng tùy biến" — trước khi tin nhắn của user đến LLM, nó chạy qua một chuỗi các "stage" xử lý tuần tự. Mỗi stage có thể: chặn tin nhắn, viết lại nội dung, bổ sung context, hoặc xử lý ngay không cần LLM. User hoặc conversation có thể bật/tắt từng stage, tạo pipeline riêng.

**Luồng thực tế:**

```
User gõ tin nhắn
       ↓
[pre_query phase]
  LayaSecurityStage   → Kiểm tra credential/PII → rewrite hoặc block
       ↓
[pre_model phase]
  DirectActionStage   → Mở URL/file/repo? → direct_action (không gọi LLM)
  ToolRouterStage     → Chọn tool: code_executor / browser_action / none
  ModelRoutingStage   → (TẮT mặc định) Gợi ý model phù hợp
       ↓
[retrieve phase]
  RtkKnowledgeStage   → (TẮT mặc định) Inject real-time knowledge
  MockContext7Stage   → (TẮT mặc định) Inject docs SDK
       ↓
Gửi finalQuery → LLM API → stream response về UI
```

**Trạng thái từng stage:**

| Stage                         | Phase     | Bật mặc định | Trạng thái                                                         |
| ----------------------------- | --------- | ------------ | ------------------------------------------------------------------ |
| `builtin:laya-security`       | pre_query | ✅           | **WORKING** — phát hiện credential, rewrite query                  |
| `builtin:direct-action`       | pre_model | ✅           | **WORKING** — mở URL/GitHub/file + /repotopackage                  |
| `builtin:tool-router`         | pre_model | ✅           | **WORKING** — classify tool domain, inject directive vào prompt    |
| `builtin:model-router`        | pre_model | ❌           | **STUB** — tắt mặc định, chưa kết nối model switching              |
| `builtin:rtk-knowledge`       | retrieve  | ❌           | **STUB** — chỉ check keyword "hôm nay/latest", không lấy data thật |
| `com.context7.docs-retriever` | retrieve  | ❌           | **STUB** — trả về chuỗi mock cứng, không gọi Context7 API          |

**Cơ chế Pipeline Definition:**

- Mỗi conversation có thể có `ChatPipelineDefinition` riêng (lưu trong `pipelineDefinitions` Map)
- User/app có thể gọi IPC `updatePipelineDefinition` để bật/tắt stage, set timeout, config
- Default definition lấy từ `getChatStageRegistry().createDefaultDefinition()`
- **WORKING** — cơ chế registry, executor, timeout, abort signal đều hoạt động

**Kết luận Chat Pipeline:** Cơ sở hạ tầng **hoàn chỉnh và hoạt động**. Các stage mặc định (security, direct-action, tool-router) chạy thật. Các stage opt-in (rtk, context7, model-router) là stub cần triển khai thật.

---

## 3. RepoToPackage (`/repotopackage`)

**Mô tả:** Tính năng "cách mạng" — biến bất kỳ repo GitHub hoặc folder local thành một `.tomny` package có thể cài vào TomniHubOS Store, không cần LLM, không tốn token. Kích hoạt bằng lệnh `/repotopackage <url-hoặc-path>` trong chat.

**Luồng thực tế:**

```
User gõ: /repotopackage https://github.com/facebook/react
       ↓
DirectActionStage     → Regex detect lệnh /repotopackage → direct_action
       ↓
bridge.ts             → Không gọi LLM, chạy buildTomnyPackageFromRepo()
       ↓
repoPackager.ts       → Clone repo (nếu URL) → scan files → classifyRepository()
       ↓
repoClassifier.ts     → Phân tích file structure → assign archetype (7 loại)
       ↓
                         Compute SHA-256 integrity
                         Generate Ed25519 keypair
                         Sign manifest
                         Build .tomny ZIP archive
       ↓
Stream progress về UI (4 bước có visualize)
       ↓
Lưu file .tomny vào disk → turnCompleted emit
```

**7 archetype được phân loại:**

| Archetype            | Ý nghĩa                                           |
| -------------------- | ------------------------------------------------- |
| `web-surface-app`    | Web app chạy trong sandbox (React, Vue, HTML/CSS) |
| `ui-theme`           | Gói theme/skin cho TomniHubOS UI                  |
| `ide-viewer`         | Extension cho IDE viewer                          |
| `chat-stage`         | Stage tùy chỉnh cho Chat Pipeline                 |
| `mcp-tool-server`    | MCP tool server (browser control, git, etc.)      |
| `workflow-capsule`   | Workflow automation không có UI                   |
| `service-daemon`     | Background service daemon                         |
| `unsupported-native` | Bị từ chối — native binary không an toàn          |

**Trạng thái chi tiết:**

| Bước                         | Trạng thái                                                                  |
| ---------------------------- | --------------------------------------------------------------------------- |
| Detect `/repotopackage` lệnh | **WORKING** — regex trong DirectActionStage                                 |
| Clone remote Git URL         | **WORKING** — dùng `git clone` qua `execFile`                               |
| Scan & collect files         | **WORKING** — đệ quy, bỏ qua node_modules/dist/.git                         |
| Classify archetype           | **WORKING** — heuristic file pattern (không dùng LLM)                       |
| Tính SHA-256 integrity       | **WORKING**                                                                 |
| Ký Ed25519                   | **WORKING** — generate keypair tạm nếu không có private key                 |
| Build .tomny ZIP             | **WORKING** — dùng JSZip                                                    |
| Stream progress UI (4 bước)  | **WORKING** — emit qua IPC responseStream                                   |
| Laya Static Guardrail        | **PARTIAL** — UI hiện "Passed" nhưng Laya chưa thực sự scan file repo       |
| Install vào Store            | **BLOCKED** — file .tomny được tạo xong nhưng chưa có luồng install tự động |

**Giới hạn:**

- Max repo size: 200MB
- Max files: 10,000
- Private key mặc định: generate tạm (dev key), không lưu lại
- Output: `<source>/.store-output/<id>-<version>.tomny`

**Kết luận RepoToPackage:** Core logic **hoàn chỉnh và chạy thật**. Tạo ra file `.tomny` hợp lệ, có ký số. Phần còn thiếu: Laya scan thật trên file repo, và luồng install `.tomny` vào Store sau khi đóng gói.

---

## Tóm tắt 1 dòng mỗi tính năng

| Tính năng         | Chạy thật chưa?                    | Thiếu gì?                                                |
| ----------------- | ---------------------------------- | -------------------------------------------------------- |
| **Laya**          | ✅ Có — sau fix warm-up            | Warm-up 26s lần đầu; egress model chưa gắn vào chat      |
| **Chat Pipeline** | ✅ Có — 3 stage mặc định hoạt động | RTK, Context7, ModelRouter còn là stub                   |
| **RepoToPackage** | ✅ Có — tạo .tomny thật            | Laya guardrail chưa thật; chưa có auto-install vào Store |
