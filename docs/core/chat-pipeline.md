# Chat Pipeline and Modular Package Ecosystem

**Status:** PARTIAL foundation; TARGET for the governed visual and extensible chat-pipeline.

**Related documents:** [Chat execution flow](chat-execution-flow.md), [Package taxonomy](../platform/package-taxonomy.md), [Packages platform](../platform/packages.md), [5 Ý tưởng kiến trúc đột phá](../future/5-y-tuong-kien-truc-dot-pha.md).

## 1. Executive Architecture Overview

In TomniHubOS, a chat turn is not a hardcoded sequence of monolithic functions. It is a **Modular, Reorderable, and Extensible Dây Chuyền Xử Lý (Processing Chain)** that connects user queries to model execution.

The chat pipeline operates on a **Dual-Layer Architecture**:

1. **User-Configurable Dynamic Chain:**
   Users have full freedom to compose, reorder, configure, and toggle stages via an interactive **Visual Pipeline Builder** directly in the Chat interface. Third-party developers can build and distribute pipeline stages as downloadable packages via the TomniHubOS Store (for example, **Context7** for real-time SDK documentation retrieval, web search, custom RAG, prompt enhancers, or domain-specific classifiers).
2. **Immutable Hub-Owned Safety Envelope:**
   No package or user customization can bypass platform invariants: account admission, hard secret protection, stage timeouts, token/byte limits, and final egress inspection by the Main-owned TrustBroker.

```text
[ User Query in Chat UI ]
           │
           ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │ CHAT PIPELINE EXECUTOR (Dynamic Stage Chain Configured by User)        │
 │                                                                        │
 │  Step 1: [[Logo] Context7 Docs]         ─── (Retrieve Phase)           │
 │          • Fetches latest SDK/API documentation relevant to query      │
 │                                                                        │
 │  Step 2: [[Logo] Laya Security Guard]   ─── (Pre-query / Egress Phase) │
 │          • Normalizes teencode & Vietnamese seeds (mk ➔ mật khẩu)     │
 │          • Laya Decision Engine (~33ms): REWRITE sensitive PII/secrets │
 │                                                                        │
 │  Step 3: [[Logo] Auto-Skill Router]     ─── (Pre-model Phase)          │
 │          • Selects only the 2-3 MCP tools needed for the task          │
 │                                                                        │
 │  Step 4: [[Logo] LLM Execution]         ─── (Model Phase)              │
 │          • Dispatches safe context + query to Cloud LLM (Claude/GPT)   │
 └────────────────────────────────────────────────────────────────────────┘
           │
           ▼
[ Streaming Response + Audit Receipts to Chat UI ]
```

---

## 2. Store Package System & Chat Stage Contributions

Any package in the TomniHubOS Store can contribute one or more Chat Stages by declaring a `chatStage` contribution in its package manifest.

### 2.1. Example: The Context7 Documentation Package

Consider **Context7** (`com.context7.docs-retriever`), a package designed to provide up-to-date technical documentation and API references for coding agents.

Its `package.json` declares:

```json
{
  "id": "com.context7.docs-retriever",
  "name": "Context7 Docs",
  "version": "1.0.0",
  "icon": "assets/context7-icon.svg",
  "type": "chat-stage-package",
  "contributions": {
    "chatStage": {
      "id": "context7-retriever",
      "displayName": "Context7 Docs Retriever",
      "phase": "retrieve",
      "description": "Tự động trích xuất tài liệu SDK/API mới nhất phù hợp ngữ cảnh cho Agent",
      "defaultConfig": {
        "maxTokens": 4000,
        "autoUpdate": true,
        "docSources": ["npm", "pypi", "github-docs"]
      }
    }
  }
}
```

### 2.2. Package Lifecycle in the Pipeline

1. **Download & Verification:** The user discovers and installs `Context7` via the TomniHubOS Store. The package archive and signature are verified by `PackageDownloader` and registered in `PackageStore`.
2. **Dynamic Stage Registration:** The Main process `ChatStageRegistry` detects the `chatStage` contribution, validates its schema and permissions, and registers it into the active stage catalog.
3. **Appearance in UI Palette:** The Chat UI immediately reflects the new stage in the Stage Palette as `[[Logo] Context7 Docs]`, ready to be dragged into any conversation pipeline.
4. **Sandboxed Execution:** When invoked, the stage runs in an isolated runtime (Node.js worker or broker-governed loopback process) with bounded inputs, memory caps, and a hard 5-second timeout.

---

## 3. Visual Pipeline Builder (Chat UI / Pop-up Drawer)

The Chat interface (`packages/desktop/src/renderer/pages/conversation/`) provides a first-class visual configuration surface for the pipeline.

### 3.1. UI Layout & Interaction

- **Header Action Button:** Next to the Model Selector and Assistant Profile, a dedicated **"Pipeline Flow"** button (icon: `NodeFlat` / `Workflow`) indicates the active pipeline status and latency summary.
- **Interactive Pipeline Modal / Drawer:**
  1. **Active Pipeline Track (Sortable Drag & Drop Canvas):**
     - Renders active stages in left-to-right (or top-to-bottom) execution order:
       `[ 💬 Query ] ➔ [[Logo] Context7] ➔ [[Logo] Laya Security] ➔ [ 🤖 LLM ]`
     - **Drag & Drop:** Users can drag any stage card to change execution order (e.g., move Context7 before or after Security Guard).
     - **Toggle Switch:** Each card has an on/off switch to temporarily bypass that stage without removing it.
     - **Remove (`x`):** Detaches the stage from this conversation.
     - **Settings (`⚙️`):** Opens a card-level configuration modal (e.g., adjust Context7 max tokens; switch Laya mode between `rewrite` and `block`).
  2. **Available Stage Palette (Drawer):**
     - Lists all installed Built-in and Store-provided stages that are not yet active in the current conversation.
     - Dragging a card from the Palette and dropping it into the Pipeline Track adds it to the active chain.
     - Direct link: _"Khám phá thêm Chat Package trên Store..."_ navigating to the Store catalog.
  3. **Preset Management:**
     - Users can save pipeline configurations as named presets (e.g., _"Coding with Fresh Docs"_, _"Fast Chat (No Tools/RAG)"_, _"Strict Enterprise Security"_), or set a default preset per Workspace.

### 3.2. Realtime Telemetry & Evidence Badges

In the message list or pipeline inspector:

- Each assistant turn can display an optional expandable badge showing pipeline telemetry:
  - `[Context7: 112ms, 2 docs added]`
  - `[Laya Security: 33ms, 1 credential redacted]`
  - `[Cloud LLM: 1.2s, 850 tokens]`

---

## 4. Chat Stage ABI & Technical Contracts

### 4.1. Core Types

```ts
export type StagePhase = 'pre_query' | 'retrieve' | 'pre_model' | 'post_model';

export type ChatPipelineDefinition = {
  schemaVersion: 1;
  id: string;
  name: string;
  stages: ChatPipelineStageRef[];
  limits?: {
    maxStages?: number;
    maxTotalTimeoutMs?: number;
    maxContextBytes?: number;
  };
  enabled: boolean;
};

export type ChatPipelineStageRef = {
  id: string; // Unique stage reference within the pipeline
  stageRegistryId: string; // ID in ChatStageRegistry (e.g., 'builtin:laya-security', 'com.context7.docs-retriever')
  phase: StagePhase;
  enabled: boolean;
  config?: Record<string, unknown>;
};

export type ChatStageInput = {
  schemaVersion: 1;
  runId: string;
  stageId: string;
  query: string;
  context?: string;
  grounding?: Record<string, unknown>;
  artifacts?: readonly string[];
  config?: Record<string, unknown>;
  signal?: AbortSignal;
};

export type ChatStageOutput = {
  decision: 'continue' | 'rewrite' | 'block' | 'skip';
  query?: string; // Transformed or redacted query string
  context?: string; // Augmented context
  grounding?: Record<string, unknown>; // Added facts/citations
  artifacts?: readonly string[];
  evidence?: Record<string, unknown>; // Audit & telemetry evidence
  reasonCode?: string;
};

export interface IChatStage {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly phase: StagePhase;
  readonly icon?: string;
  readonly defaultEnabled: boolean;
  readonly defaultTimeoutMs?: number;

  execute(input: ChatStageInput): Promise<ChatStageOutput>;
}
```

### 4.2. Phase Responsibilities

1. **`pre_query`:** Normalization, teencode decoding, language detection, query rewrite, local user understanding signal extraction.
2. **`retrieve`:** Knowledge retrieval, document scraping (Context7), RTK lookup, external web search grounding.
3. **`pre_model`:** Auto-skill routing, MCP tool selection, bounded prompt projection, model parameter adjustment.
4. **`post_model`:** Output validation, structured artifact extraction, diagram rendering, safe link verification.

---

## 5. Built-in Core Stages & Extended Capabilities

TomniHubOS ships with default built-in stages that do not require external store downloads:

### 5.1. `builtin:laya-security` (Laya Decision Engine - CURRENT)

- **Backbone:** Laya Multilingual 322M ONNX INT8 non-autoregressive encoder (~26ms).
- **Pre-processor:** `vietnameseNormalizer.ts` (cleans teencode, expands core seeds: `mk` $\rightarrow$ `mật khẩu`, `tk` $\rightarrow$ `tài khoản`, `stk`, `cccd`).
- **Temporary Secret Vault:** Tự động mã hóa mật khẩu/token vào `ChatTemporarySecretStore` (mã hóa AES trong Main Process), đăng ký HMAC-SHA256 fingerprint vào `KeyedSecretIndex`.
- **Actions:**
  - `rewrite` (Default): Replaces detected passwords/PII with `[PASSWORD_TEMP_01]` tokens and lets the pipeline proceed seamlessly without disrupting user workflow.
  - `block`: Halts execution immediately if malicious prompt injection or destructive instructions are detected.
  - `allow`: Pass through when harmless colloquialisms are detected (e.g. _"mk cái app lag"_).

### 5.2. `builtin:rtk-knowledge` (Realtime Knowledge - CURRENT)

- **Backbone:** Local SQLite fact store and vector index.
- **Function:** Injects verified facts with freshness scores, superseding conflicting data.

### 5.3. `builtin:tool-router` (Speculative Tool Schema Loading with Autonomous Agent Fallback - CURRENT / TARGET)

- **Backbone:** Laya Decision Head for Tool Selection (`toolRouterStage.ts`) kết hợp Bidirectional Self-Healing Loop.
- **Function:** Giải quyết triệt để bài toán bùng nổ token khi có hàng chục MCP Tools/Skills mà không để Agent bị phụ thuộc một chiều vào Laya:
  1. **Universal Fallback Directive:** System Prompt mặc định luôn có sẵn chỉ dẫn và quyền tối giản `request_tools`. Khi người dùng chỉ chào xã giao ("hello", "xin chào"), không có schema nào được nạp $\rightarrow$ Tiết kiệm 100% token thừa.
  2. **Speculative Pre-load by Laya (~26ms):** Laya phân tích intent ở phase `pre_model` và nạp trước **Full JSON Schema chi tiết** của đúng 1 – 2 công cụ dự đoán:
     - Ý định duyệt web (`browser`) $\rightarrow$ Nạp full schema `browser_action` (kết nối `BrowserControlMCP`).
     - Ý định code/terminal (`code`) $\rightarrow$ Nạp full schema `code_executor`, `file_search`.
  3. **Self-Healing Fallback Loop (Khi Laya đoán sai):** Nếu Laya không nạp schema (hoặc nạp thiếu), Agent đọc câu hỏi của người dùng và nhận thấy cần thao tác công cụ $\rightarrow$ Agent dựa vào chỉ dẫn mặc định để phát tín hiệu ngược lại (`request_tools`). Hệ thống và Laya lập tức giải mã và cấp đầy đủ bộ tool schemas theo yêu cầu cho Agent ở lượt tiếp theo.
- **Hiệu quả:** Tiết kiệm 85% token metadata so với việc nạp toàn bộ 50+ tool schemas, phản hồi tức thì trong 90%+ các lượt gọi thông thường, và loại bỏ hoàn toàn rủi ro Agent bị "mù" hay bế tắc công cụ.

### 5.4. `builtin:model-router` (Task Complexity & Model Selection - CURRENT)

- **Backbone:** Laya Decision Head for Task Complexity (`modelRoutingStage.ts`).
- **Function:** Đánh giá độ phức tạp câu hỏi ở phase `pre_model` và đề xuất phân khúc tối ưu:
  - `simple_chat` $\rightarrow$ Đề xuất `fast-cheap` (Claude 3.5 Haiku, Gemini Flash).
  - `coding_task` $\rightarrow$ Đề xuất `strong` (Claude 3.7 Sonnet, OpenAI o3-mini).
  - `deep_reasoning` $\rightarrow$ Đề xuất `best-value` với high thinking budget.
- Xuất dữ liệu vào `grounding.recommendedModel` và `evidence.modelRouting`.

### 5.5. Zero-LLM Direct Action Execution (Short-Circuit Bypass - TARGET)

- **Backbone:** Laya Direct Intent Classification.
- **Function:** Nhận diện các câu lệnh hành động trực tiếp (ví dụ: _"mở link github tomnihubos"_, _"truy cập google.com"_, _"mở file src/index.ts"_).
- **Short-Circuit:** Pipeline bỏ qua hoàn toàn bước gọi LLM đám mây (Bypass Model Phase), thực thi trực tiếp qua `BrowserControlMCP` hoặc OS launcher, trả về kết quả trong `< 50ms` với `0 token cost`.

### 5.6. 100% Autonomous Model Selection (Auto Mode Switcher - TARGET)

- **Backbone:** Laya Complexity Assessor kết hợp Live Provider Registry.
- **Function:** Khi người dùng bật chế độ `Tự Động (Auto Mode)` trong Chat UI:
  - Không cần hỏi hay gợi ý cho người dùng, Laya tự động chọn và gán model tối ưu nhất cho phiên chat.
  - Tiêu chí lựa chọn: Độ phức tạp (`taskComplexity`) + Trạng thái khả dụng thực tế (model nào còn quota, có API key hợp lệ, provider đang online).

### 5.7. `builtin:faithfulness-guard` (Hallucination & Grounding Verifier - TARGET)

- **Backbone:** Laya Bidirectional Consistency Scorer.
- **Function:** Chạy ở phase `post_model`: so chiếu câu trả lời do LLM sinh ra với Context/Grounding gốc trong 26ms. Nếu phát hiện bịa đặt (hallucinated claims) hoặc trích dẫn sai entity $\rightarrow$ tự động kích hoạt retry hoặc gắn cảnh báo độ tin cậy.

---

## 6. The Immutable Hub-Owned Envelope

Users and packages have full control over stage composition, but **cannot weaken the platform safety invariants**. The Hub enforces the following boundaries regardless of user configuration:

```text
       ┌────────────────────────────────────────────────────────┐
       │             IMMUTABLE HUB-OWNED ENVELOPE               │
       │                                                        │
       │  • Session & Account Identity Admission                │
       │  • Input & Output Size Caps (e.g., max 1MB payload)    │
       │  • Stage Execution Timeout (max 5s per stage)          │
       │  • Secret Boundary (No raw keys exposed to stages)     │
       │  • TrustBroker Final Egress Inspection                 │
       │  • Durable Lifecycle Telemetry & Terminal Receipts     │
       │                                                        │
       │     ┌────────────────────────────────────────────┐     │
       │     │     User-Configurable Dynamic Stages       │     │
       │     │   [Context7] ➔ [Laya] ➔ [Tool Router]      │     │
       │     └────────────────────────────────────────────┘     │
       │                                                        │
       └────────────────────────────────────────────────────────┘
```

1. **Hard Secret Protection:** Provider API keys, credentials, and OAuth tokens are stored in the OS-backed encryption vault. Stages only receive redacted strings or opaque handles.
2. **Fail-Closed Final Egress:** Even if a user disables all pre-query security stages, the shared `ProviderExecutionBroker` still conducts a final deterministic payload scan before any outbound network socket opens.
3. **Fault Isolation:** If a stage throws an unhandled exception or exceeds its deadline, the pipeline isolates the failure:
   - Non-critical retrieval stages (e.g., Context7) degrade gracefully to `'skip'`, allowing the chat turn to continue with base knowledge.
   - Security stages fail closed to protect user privacy.

---

## 7. Execution Lifecycle in the Engine

When `NativeConversationService.send` is called:

1. **Load Pipeline Definition:** Resolve the active `ChatPipelineDefinition` for the conversation (or fallback to workspace default).
2. **Iterate Enabled Stages:**
   - For each stage in the defined order:
     - Check if stage is enabled.
     - Execute stage with `AbortSignal` and per-stage deadline (default 5,000ms).
     - Handle stage decision:
       - `'continue'`: Pass updated query/context to next stage.
       - `'rewrite'`: Adopt rewritten query and continue chain.
       - `'skip'`: Discard stage mutations and continue chain.
       - `'block'`: Terminate pipeline immediately, emit denial receipt to UI.
3. **Dispatch to Provider Execution Broker (or Short-Circuit):**
   - Nếu phát hiện `direct_action` (Zero-LLM Direct Action): Thực thi trực tiếp hành động cục bộ, bỏ qua bước gọi LLM đám mây.
   - Nếu ở chế độ `Auto Mode`: Tự động áp dụng model tối ưu do `builtin:model-router` xác định.
   - Pass final query and composed context to `ProviderExecutionBroker`.
   - Final egress inspection runs on the serialized payload.
   - External LLM call executes; stream tokens to renderer via IPC.
4. **Post-Model Processing:**
   - Run any registered `post_model` stages (Faithfulness Guard, diagram extraction, schema check).
5. **Terminal Receipt:**
   - Record pipeline execution metrics, active stages, latency per stage, and terminal receipt in the conversation repository.

---

## 8. Acceptance Gates & Verification Plan

A complete implementation of the Chat Pipeline must prove:

1. **Stage ABI & Registry Gate:** `ChatStageRegistry` registers built-in and dynamically installed Store stages; invalid phase or missing ID fails closed.
2. **Sequential Ordering Gate:** Stages execute in the exact order specified by `ChatPipelineDefinition`; mutations (`query` rewrite, `grounding` additions) propagate correctly down the chain.
3. **Failure Isolation Gate:** A crashing or timing-out stage does not crash the conversation service or leak secrets.
4. **Visual UI Gate:** The Renderer UI correctly displays the active pipeline track, allows drag-and-drop reordering, allows stage toggle/removal, and reflects changes in runtime execution.
5. **Store Extension Gate:** Installing a mock `Context7` package successfully populates the Stage Palette and can be activated into the pipeline.
6. **Zero-LLM Direct Action Gate:** Direct actions execute in < 50ms without making outbound network LLM requests.
7. **Autonomous Selection Gate:** In Auto Mode, the active model is automatically assigned without blocking or prompting the user.
