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

**TARGET example, not shipped:** the product has no built-in Context7 stage; the earlier mock was removed. Consider **Context7** (`com.context7.docs-retriever`), a package that could be designed to provide up-to-date technical documentation and API references for coding agents.

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

## 3. Visual Pipeline Builder (Chat UI / Pop-up)

The Chat interface (`packages/desktop/src/renderer/pages/conversation/`) provides a first-class visual configuration surface for the pipeline.

### 3.0. The pop-up (CURRENT)

The **Pipeline** button in the conversation header opens a rectangular pop-up (`ChatPipelineModal`). It has two panes:

- **Stages, in order (left).** Each row shows the position, name, phase, and, for a security guard, whether it is authorized. Rows can be moved up or down, switched on or off, removed, or **copied** so the same stage runs again later in the chain. A selector adds any available stage, including one already in the chain. Hints appear under the list when retrieved context has no security stage after it, or when no authorized security stage is on; they are hints, not errors, because the send step still scans every payload bound for a cloud model.
- **Inspector (right).** For the selected stage: what it does, which decision model it uses and which tasks it asks, its settings (security: hide or stop on a secret; tool schema: apply or advisory), and the **exact input and answers of each model call**, from the last real message or from the dry run. A call served from the shared pass says which stage ran the model. Inputs are masked before they are shown.

The pop-up runs a dry run of the edited chain 250 ms after each change and shows its health and latency in the header. Edits are saved with **Save**; **Restore default** rebuilds the chain from the stages that are on by default.

Saved chains are **CURRENT** and survive a restart: `nativeConversation/pipelineDefinitionStore.ts` keeps one chain per conversation (up to 200, least recently saved dropped first, removed with the conversation) and an app-wide default in `chat-pipelines.json` next to the conversation database. A save is validated whole and rejected if any part is malformed. The chain a message runs is the conversation's own, else the saved default, else the registry default. **Settings → Pipeline Chat** lists the default chain and opens the same pop-up without a conversation to edit it.

Every string goes through i18n (`conversation.pipeline.*`, nine locales). Drag and drop, named presets, and a per-workspace default are **TARGET**; see 3.1.

### 3.1. Target UI Layout & Interaction (TARGET: drag-and-drop canvas, presets, workspace default)

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
  decision?: DecisionSession; // shared decision model for this run; absent when no model is connected
};

export type ChatStageOutput = {
  decision: 'continue' | 'rewrite' | 'block' | 'skip' | 'direct_action';
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
  readonly role?: 'guard' | 'standard'; // guards fail closed
  readonly decisionTasks?: readonly ('security' | 'understand' | 'toolSchema')[]; // asked of the shared model

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
- **Scope (CURRENT):** It inspects the query **and** the context that earlier stages added. A credential in retrieved text is redacted; a document that tries to take over the agent (`CONTEXT_PROMPT_INJECTION_BLOCKED`) stops the turn. Place it again after a `retrieve` stage to cover what that stage added.
- **Role (CURRENT):** It declares `role: 'guard'`, so an error or timeout blocks the turn (`SECURITY_STAGE_ERROR`) instead of skipping the stage. Fail-closed behavior follows the role, not the stage id, so a replacement guard keeps it.
- **Model use (CURRENT):** Its questions are answered in the shared Laya pass described in 5.1a; running it more than once on unchanged text costs no extra model call.

### 5.1a. `builtin:understand` and the shared Laya pass (CURRENT)

Security, understand, and tool schema are three stages with one model behind them. Each stage declares a **decision task**, a named form of typed questions (`choice`, `noul`, `score`). When the pipeline starts, the executor collects the tasks of every enabled stage and the first stage that needs the model asks **all of them in one forward pass** (`decisionSession.ts`, `decisionTasks.ts`). Later stages read their own answers from that pass; a stage that runs on the same text again, or on text that was only redacted, hits the cache.

- `builtin:understand` asks what the user wants (`intent`: chat, code, web, documents, orchestration, other; `needsFreshDocs`) and writes it to `grounding.intent` for later stages.
- Without a connected model, every stage falls back to its deterministic rules (pattern matching), so the pipeline never depends on Laya being ready.
- Every call and cache hit is recorded as a trace: the exact input the model received and its answers. The input is **masked and clipped in Main** before it is sent to the renderer (`redactForTrace`); raw text never leaves Main. The pop-up in 3.0 shows these traces.

### 5.2. `builtin:rtk-knowledge` (Realtime Knowledge - CURRENT)

- **Backbone:** Local SQLite fact store and vector index.
- **Function:** Injects verified facts with freshness scores, superseding conflicting data.

### 5.3. `builtin:tool-schema` (Tool group selection - CURRENT / TARGET)

Renamed from `builtin:tool-router`; saved pipelines that still name the old id keep working through a registry alias.

- **Backbone:** the shared Laya pass (5.1a). One `noul` question per tool group asks whether the message needs that group; a group is selected when the wording points at it (a repository, a web page, an Office file, agents, tests) or when the model is nearly certain (0.85 or above). Model scores are evidence, not orders: in the app a question about a repository scored the browser group 0.78 and the project group 0.34, and an intent kind chosen with under 40% confidence does not outweigh clear wording. Only a plain greeting skips the question. Groups are Surface capability ids (`surface.ide`, `surface.browser`, `surface.office`, `core.agent-orchestrator`, `core.testing`), so the stage never invents a tool vocabulary of its own.
- **Output (CURRENT):** `grounding.toolSchema = { capabilityIds, scores, method, applied }`. The understood intent backs the model up: when nothing is selected, the intent's group is used. A plain greeting selects nothing.
- **What the runtime does with it (CURRENT):** the selection **removes nothing**. Every tool the active Surface allows stays in the tool catalog and keeps its server attached, so a wrong or empty choice costs one step to load the right tool and never the tool itself. What the choice changes is the hint: the stage appends the exact names of the chosen groups to that turn's context ("load these with one ToolSearch, names separated by spaces"), and the file tools (`core.workspace-read`) come with the project group because a surface without project tools still reads files. When Laya says nothing the model relies on the tool guide in the system prompt, which lists every allowed tool by exact name. A side benefit: the CLI process is keyed by its tool list, and that list no longer changes with the choice, so the process is reused between turns.
- **Advisory switch (CURRENT):** with `config.apply = false` the choice is shown in the inspector but no hint is added.
- **Not a grant (CURRENT):** a selection cannot add a capability. Loading another Surface's tools in a chat conversation needs the explicit grants those capabilities already require; that cross-Surface flow is **TARGET**.
- **Removed:** the old `request_tools(domain)` self-healing directive. It was read from the user's own message, not from the model's reply, so it never worked as a fallback; `tools_search` is the fallback now.

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
2. **Fail-Closed Final Egress:** Even if a user disables all pre-query security stages, the shared ProviderExecutionBroker still conducts a final deterministic payload scan before any outbound network socket opens. Generated model input, pipeline context, and attached-file path projections are each in the inspected parts; the runtime does not append attachment paths after this check.
3. **Fault Isolation:** If a stage throws an unhandled exception or exceeds its deadline, the pipeline isolates the failure:
   - Non-critical retrieval stages (e.g., Context7) degrade gracefully to `'skip'`, allowing the chat turn to continue with base knowledge.
   - Stages with `role: 'guard'` fail closed to protect user privacy, whatever their id.

### 6.1. Customizable security (CURRENT / TARGET)

Security is a stage like any other: the user can place it anywhere, run it **several times** (for example once on the query and again after a retrieve stage), move it to the end only, or replace it.

- **Replacement needs authorization (CURRENT).** A stage counts as a stand-in for `builtin:laya-security` only when Main marks it `authorizedGuard`: built-in guards, or a package that Main has authorized (`authorizeGuardPackage`). A manifest cannot declare this about itself, so an unauthorized package that calls itself a guard still runs as an ordinary stage and is shown as not authorized. **TARGET:** derive the authorization from the Store's signature, review, and conformance results; today only built-ins are authorized.
- **The send step is the floor (CURRENT).** After the pipeline, `executeAfterOutboundInspection` scans the payload that leaves for the model: the visible message, the hidden model input, and the pipeline context as separate parts. It uses deterministic secret scanning (no Laya) and fails closed if the check itself errors. Turning off every security stage therefore does not send a secret to a model.
- **Hints, not blocks.** The pop-up warns about gaps in the user's own chain (see 3.0); it never stops the user from arranging it.

---

## 7. Execution Lifecycle in the Engine

When `NativeConversationService.send` is called:

1. **Load Pipeline Definition:** Resolve the active `ChatPipelineDefinition` for the conversation (or fallback to workspace default), and open a shared decision session for the run (5.1a). The last run's trace is kept per conversation for the inspector.
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
   - The pipeline's rewritten query is what is sent. Context gathered by retrieve stages is prepended to the model input inside a [Pipeline context] block and inspected as its own part; attachment file paths are included in the same inspected model-input part. The visible message is unchanged (turnPlan.ts).
   - The tool groups chosen by `builtin:tool-schema` are passed to the runtime as `toolSelection`. It is set in Main after the renderer's parameters are copied, so the renderer cannot choose tool groups.
   - Pass final query and composed context to `ProviderExecutionBroker`.
   - Final egress inspection runs on the serialized payload.
   - External LLM call executes; stream tokens to renderer via IPC.
4. **Post-Model Processing:**
   - Run any registered `post_model` stages (Faithfulness Guard, diagram extraction, schema check).
5. **Terminal Receipt:**
   - Record pipeline execution metrics, active stages, latency per stage, and terminal receipt in the conversation repository.

### 7.1. First-message latency

The person's message must be on screen before anything slow runs:

- **The bubble does not wait for Main.** The renderer draws it at once under a client-generated id and passes the same id as `loading_id`, which Main persists the user message under. The chat pipeline, a model that is still starting and any team warm-up happen after it. If the pipeline blocks the message, the bubble is removed and the text is restored to the input (`optimisticSend.ts`).
- **Stages never wait for a cold Laya.** The pipeline uses `createLayaPipelinePredictor`: while the sidecar is still loading (tens of seconds on the first start) it answers "still starting" immediately, so each stage's deterministic fallback decides in no time, and the load continues in the background. The process starts Laya first (`warmLaya.ts`) so later messages find it ready.
- **A model call belongs to the call, not to a stage.** Each call has its own deadline (3 s). A stage that gives up waiting (its own limit is 1-2.5 s) leaves the call running, and the next stage asks for the same text joins it instead of repeating it. Before it reports ready the sidecar answers one request shaped like the shared pass (`LAYA_WARMUP`), so the first real message does not pay for the model's warm-up.
- **Failures say what happened.** A call with no answer carries `errorCode`: `starting` (still loading), `timeout`, `cancelled`, `unavailable` or `failed`. The inspector shows it in the person's language instead of a raw message such as "Operation aborted"; the stage's deterministic fallback has answered in the meantime.
- **Measured, not guessed.** Main logs `[Tomny:send]` marks: pipeline duration and whether Laya was ready, inspection plus hand-off, and the time from acceptance to `started` and to the first output. These show where a slow first message spends its time.

---

### 7.1a. Time bounds, configuration snapshot, and output cancellation (CURRENT / PARTIAL; 2026-10-15)

- **CURRENT (implementation on revision `4cf2b2711` with uncommitted working-tree changes):** `pipelineExecutor.ts` snapshots the submitted definition, executes only stages for the requested input/output direction, and races stage work against an actual cancellation/timeout promise. A stage that ignores its `AbortSignal` no longer holds the executor's await indefinitely. Each stage is capped at 5 seconds, and input execution shares an overall deadline capped at 30 seconds; expiration blocks further input stages with `PIPELINE_BUDGET_EXHAUSTED`. This controls waiting, **not** background side effects of an uncooperative third-party stage; isolation is still required for package stages.
- **CURRENT tests:** `tests/unit/chatPipeline/pipelineExecutor.test.ts` covers snapshot changes during a turn, abort of uncooperative work, guard timeout fail-closed, and exhaustion of the run budget. `tests/unit/chatPipeline/nativeOutput.test.ts` covers persistence before replacement and cancellation arriving while persistence is pending. `runTrace.ts` masks guard reason strings and evidence keys before sending pipeline traces to the renderer; `tests/unit/chatPipeline/sharedLayaPipeline.test.ts` exercises this boundary.
- **PARTIAL:** the overall deadline here is an **input pipeline** deadline, not yet a unified preflight/provider-transport/output deadline; retry, durable terminal receipts, and cross-process cancellation remain under the canonical run-lifecycle acceptance plan. Ordinary non-guard `post_model` rewriting still follows streamed text, so it does not protect early text. An authorized output guard now requires the bounded buffering path below; a missing or unauthorized stage fails before dispatch.

### 7.1b. Native pipeline progress (PARTIAL; 2026-10-15)

Main preflight now connects the Stop action to a per-conversation abort controller and checks it before dispatch. Native service cancellation during status persistence and SessionStart yields the existing stopped lifecycle. Executor input stages are bounded to 30 seconds total, 5 seconds per stage, 128 KiB per query, and a configurable context limit. Renderer pipeline traces are redacted and bounded, including nested model answers.

An auto-enabled model-router may submit a model proposal, but Main only applies an exact ID found in the current runtime model catalog when the conversation has no explicit model. A proposal alone is not a completed switch. Tests cover the verified, unknown and explicit-model cases. Provider quota, account-specific billing and durable selection evidence still need acceptance. Pipeline execution and dry-run now both apply finite time/context budgets; only Main-registered builtin stages explicitly marked `retrySafe` can retry a `PIPELINE_TRANSIENT_*` error (at most two attempts under the existing deadline). Neither Store package stages nor guards can opt themselves into retries.

**PARTIAL output guard buffering (text-only, Main):** `builtin:output-security` is registered as a Main-owned, default-off `post_model` guard, using canonical outbound text inspection plus Vietnamese credential redaction and configurable block/redact mode. The bridge rejects missing/mismatched output stages and guards without Main authorization before runtime admission. For an enabled and authorized `post_model` guard, native service buffers answer deltas in Main (maximum 256 KiB), suppresses intermediate answer/step/tool/notice publication and persistence, runs output stages with a signal and a bounded pipeline deadline, and publishes/persists only the approved transformed text. Denial, stage timeout, cancellation and overflow do not publish or persist the unreviewed answer; failure also skips recording that answer in personal memory. Native tests verify allow/deny/overflow/no-late-publication. Without a guard, non-guard transformations remain post-stream and are not confidentiality controls.

**Still PARTIAL for release:** cancellation before admission lacks a durable Foundation terminal receipt; transport/provider-level cancellation and side effects are not fully covered by the 2-second Main cleanup bound. The bounded guard also fails closed for unreviewed interactive permission/orchestration payloads and oversized output processor rewrites. `tests/integration/chatPipelineGuardPersistence.test.ts` verifies against a real file-backed repository that only approved text survives reload, denial leaves no raw answer, and approved text remains persisted if Renderer replace fails. This is **not** process-crash injection, full IPC/provider integration, or complete security/availability acceptance. The 64 KiB trace projection bounds renderer-facing trace size but does not certify every renderer context. Do not declare a release-safe output guard on unit tests alone.

## 7.2. Workspace-reference projection (CURRENT / PARTIAL)

**CURRENT (2026-10-07):** The Guid composer accepts only bounded Explorer drag payloads (application/x-tomni-explorer-entries, with a path-only compatibility MIME). It carries normalized workspace-relative file/folder references through the native conversation contract; a renderer path, kind, size, or summary is never authority. The Main process resolves each path under the real workspace root, checks containment with realpath, verifies the actual lstat kind, and performs this projection before it persists the visible user message or starts a runtime (common/chat/workspaceReference.ts, renderer/hooks/file/useDragUpload.ts, process/services/database/nativeConversation/service.ts).

- A folder contributes only a reference and an already-published Understanding summary when one exists; it is never recursively read, zipped, or inlined.
- A fresh text file may be inlined only within the exact 5,000-token one-file cap, or 1,000 tokens per file and 5,000 total for multiple files. Overflow has no silent truncation: it uses a published summary or a path-only reference.
- Summary lookup runs only after workspace metadata migration and reads .tomni/understand/{summary,stale}.json; it never generates a summary in the send path. All inline or summary text is delimited as untrusted workspace content before model egress.
- **PARTIAL:** the renderer displays a pending reference chip until a deliberate typed projection-result response exists. Binary classification is conservative but currently only rejects decoded NUL-containing content; cross-process migration recovery still needs shared Node/Rust interruption proof.

## 8. Acceptance Gates & Verification Plan

A complete implementation of the Chat Pipeline must prove:

1. **Stage ABI & Registry Gate:** `ChatStageRegistry` registers built-in and dynamically installed Store stages; invalid phase or missing ID fails closed.
2. **Sequential Ordering Gate:** Stages execute in the exact order specified by `ChatPipelineDefinition`; mutations (`query` rewrite, `grounding` additions) propagate correctly down the chain.
3. **Failure Isolation Gate:** A crashing or timing-out stage does not crash the conversation service or leak secrets.
4. **Visual UI Gate:** The Renderer UI correctly displays the active pipeline track, allows reordering (buttons today, drag-and-drop is TARGET), allows stage toggle/removal/copy, and reflects changes in runtime execution.
5. **Store Extension Gate:** Installing a mock `Context7` package successfully populates the Stage Palette and can be activated into the pipeline.
6. **Zero-LLM Direct Action Gate:** Direct actions execute in < 50ms without making outbound network LLM requests.
7. **Autonomous Selection Gate:** In Auto Mode, the active model is automatically assigned without blocking or prompting the user.

## Auto select capabilities (2026-10-15)

**Status:** PARTIAL. The deterministic selector, the budget, the plugin fallback and the storage are CURRENT and covered by `tests/unit/toolselect/capabilityAutoSelect.test.ts`. The model path is not wired in production. Hooks are reported, not narrowed. Skills are hinted, not hard-filtered.

- **Inputs.** The pipeline's redacted query. The conversation's candidate pool, built in `process/toolselect/wiring.ts` (`loadCapabilityCandidates`): skills from the catalog minus the opt-outs in `exclude_auto_inject_skills`; MCP servers from the conversation snapshot (`session_mcp_servers`, `selected_session_mcp_servers`) and the enabled servers of the MCP registry (built-in servers only when an assistant default tool names them; `configureCapabilityRegistrySource`); user hooks from the hook registry. The selector sees only ids, names, short descriptions, event and state.
- **Selector.** `process/services/chatPipeline/stages/capabilitySelect.ts`. An entry is usable only when the user enabled and approved it. Score per request term: name 3, keyword 2, description 1. A prompt hook (`UserPromptSubmit`) with no matcher is always relevant to its event; a hook with a matcher scores on its matcher terms. The optional `rank` callback is a model path: it is bounded to 2 s, and any id outside the usable set is ignored. Production passes no `rank`, because Laya's toolSchema answers are per surface group, not per skill.
- **Budget.** At most 4 skills, 3 plugins, 3 hooks and 8 entries per turn. The capability map handed out by the plugin tool is at most 4 096 bytes; anything beyond that is counted in a tail line.
- **Attached (pre-bound).** An attached entry is chosen on turn 1 before keyword scoring, so its tools and its skill line are present without a search. Attached entries are: MCP servers in the conversation snapshot (the chat (+) menu or an applied assistant); skills an applied assistant enables (`enabled_skills`); every enabled registry server that is connected (usable), or that still needs approval (listed, not used); and servers named by an assistant's default tools. Caps per turn (`ATTACHED_LIMITS`): 4 attached MCP servers and 8 attached skills. Anything above a cap stays an ordinary candidate for keyword or connect, and nothing is hidden silently. An MCP server is restored with all of its tools, so the server cap bounds the tool schemas sent. Restoring uses the snapshot, or for a registry server `CapabilityTurn.mcpServers`, which the run identity merges by name. The hint names attached plugins as already loaded, says not to search for them, and lists each chosen skill with a one-line description; the body is read with `skills_read`. Hooks need no selection: the hook registry runs them on their events.

- **Package plugins attach in every mode (2026-10-16).** Independent of `capabilityMode`, each enabled package-owned MCP server (a connection `pkgconn:` entry, or a legacy `package:` mirror) joins the run, and a short context block describes it. `buildPackageAttachmentTurn` (`process/services/chatPipeline/stages/capabilitySelect.ts`) decides; `resolvePackageAttachmentTurn` (`process/toolselect/wiring.ts`) gathers the entries: the registry row, the package's skills minus the conversation's opt-outs, and its hooks that would run now. A plugin whose last connection test failed is never attached and is named as not connected, without its error text. An untested plugin is attached, because its connection is on. The limit is 4 package servers per turn, most recently updated first. A server that auto select already chose counts against it. The send path passes `packageAttachment` (Main-only) to `contextIdentityFor` (`nativeConversation/service.ts`), which merges the servers into the run identity by name after the snapshot, so the snapshot keeps priority. The block tells the model to call the plugin's own MCP tools directly (`mcp__<server>__<tool>`), not to search for them, and names the `plugin` tool with action `connect` only as a fallback. Manual sends otherwise keep their snapshot unchanged, and built-in Tomny servers are not attached in manual mode. **Status:** CURRENT for the selection, the block and the identity merge (`tests/unit/toolselect/packageAttachment.test.ts`, `tests/unit/nativeConversation/packageAttachmentContext.test.ts`). The first-turn tool discovery of a real MCP launch is not verified here (no Electron run).

- **Fallback ladder (in this order).** (1) `tools_search`. (2) The `plugin` tool with `action: "map"`: a budgeted list of every entry with its enabled and approved state. (3) The same tool with `action: "connect"` and an id from the map. Connect records an activation for the conversation, and the next turn's selection includes it. Connect does not load the entry in the same turn.
- **Security rules.** Unapproved and disabled entries are never selected and never connected; they are counted, not named. Connect of an unapproved entry answers "needs approval in Settings". Code-running entries (stdio servers, hook commands) are not started silently: their tool calls keep the normal per-call approvals. Map text has secret-looking values redacted and control characters removed. Hooks are never narrowed: a blocking hook must not be skipped because a selector did not pick it, so the selection only reports hook relevance.
- **Storage and wiring.** Conversation extra `capabilityMode` (`'auto' | 'manual'`); the default is the single constant `DEFAULT_CAPABILITY_MODE` in `common/config/storage.ts` (`manual`). A manual conversation returns no turn choice, so its send path does not change. The Home composer keeps the per-viewer preference in `localStorage` (`tomny.capabilityMode`) and sends the mode on create. The native send path runs the selection after the pipeline; it restricts the MCP servers for that turn (`conversationMcpServersFor`) and adds a short hint to the pipeline context.
- **Known limits.** Skills are narrowed by the hint only, because skill loading still goes through the ranked tool-selector catalog. Hook choice is informational. The model path has no production wiring and is exercised only with a fake `rank` in unit tests. An assistant default tool pins its MCP server, not the single tool: the core loads every tool of that server, so tool-level pre-load is not implemented (before this change `assistant_default_tools` reached the runtime identity and were not consumed). Attached skills are listed by name and description, and their bodies are not preloaded.
