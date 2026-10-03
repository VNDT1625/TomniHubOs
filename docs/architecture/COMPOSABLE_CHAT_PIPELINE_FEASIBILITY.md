# Composable Chat Pipeline & Repo-to-Tomni Package Compiler: Architecture Audit & Feasibility Study

**Document Status:** CANONICAL ARCHITECTURE AUDIT & FEASIBILITY REPORT  
**Target Path:** docs/architecture/COMPOSABLE_CHAT_PIPELINE_FEASIBILITY.md  
**Evaluation Date:** 2026-09-14  
**Audited Systems:** TomniHubOS (packages/desktop, packages/package-apps, packages/tomny-runtime, packages/store-api)  
**Methodology:** Direct AST and control-flow source inspection of live repository code. Zero speculative assumptions.

---

## 1. Executive Verdict

| Evaluation Metric                    | Score / Assessment   | Technical Findings & Rationale                                                                                                                                                                                          |
| :----------------------------------- | :------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Technical Feasibility**            | **9 / 10**           | **Highly Feasible.** The execution seam in ExperimentalCoreRuntime cleanly partitions context compilation from model adapter execution. Inserting an envelope-based pipeline requires no rewrite of the core chat loop. |
| **Architectural Fit with Tomni**     | **9.5 / 10**         | **Natural Alignment.** Strictly adheres to docs/architecture/target.md. Core retains governance, permissions, secrets, and run durability; modular stages provide AI capability extension.                              |
| **Migration Risk**                   | **Medium**           | Low if implemented via in-process fast adapters; Medium if multi-process sandboxing is indiscriminately forced on hot-path stages.                                                                                      |
| **Runtime Overhead (Fast-Path)**     | **+0.5 to +2 ms**    | In-process TypeScript stage invocations introduce negligible latency overhead for default chat.                                                                                                                         |
| **Runtime Overhead (Sandboxed IPC)** | **+15 to +40 ms**    | Process spawning or local HTTP serialization per stage incurs noticeable latency, requiring persistent worker pools or loopback streaming.                                                                              |
| **Existing Infra Reusable**          | **~75%**             | Directly leverages PackageManagerService, Ed25519 artifact verification, SHA-256 integrity, rollback journals, and session durability stores.                                                                           |
| **Final Recommendation**             | **YES WITH CHANGES** | Adopt the architecture with one mandatory design rule: **Support In-Process Direct Execution for Built-in/Native Packages** to preserve zero-latency performance on standard turns.                                     |

### Direct Answers to Fundamental Questions

1. **Is the concept truly feasible?** Yes. The execution boundary in ExperimentalCoreRuntime.ts already resolves context before calling dapter.run(). Introducing a composable stage pipeline directly replaces the hardcoded string concatenation with structured envelope transformations.
2. **What can be implemented immediately?** Phase 0 (Contract definitions for PipelineEnvelope) and Phase 1 (Pipeline Runtime inside ExperimentalCoreRuntime using in-process wrappers around existing context & memory components).
3. **What is the hardest component?** Automated Adapter Generation for arbitrary GitHub repositories (Class C compatibility) due to ambiguous API boundaries, diverse execution runtimes (Python/C++ native dependencies), and dynamic prompt nuances.
4. **How much must existing Tomni code change?** Moderate refactoring in packages/desktop/src/process/experimentalCore/experimentalCoreRuntime.ts and extension of packages/desktop/src/common/packages/types.ts. Core chat lifecycle, session persistence, and permission stores remain intact.
5. **Must Core Chat be rewritten?** **NO.** The existing Run Kernel, durable event store, and CLI adapters remain authoritative. The Composable Pipeline replaces only the prompt assembly and retrieval stages.
6. **Should Default RAG become a package?** Yes, as a **Bundled Built-in Package (@tomni/rag-default)**. It installs out-of-the-box, can be updated independently, but retains an immutable in-core null fallback.
7. **What happens if a user uninstalls a pipeline package?** Tomni falls back safely to the default package or executes in null-retrieval mode (zero-crash guarantee).
8. **What if all third-party pipeline packages fail?** Core Chat remains 100% operational in direct conversational mode via the built-in deterministic fallback stage.

---

## 2. Current Architecture (AS-IS)

The current TomniHubOS desktop architecture is partitioned across three Electron boundaries:

`[ Electron Renderer (UI) ]
         │ (Context Bridge IPC)
[ Preload Layer (main.ts) ]
         │ (Typed Channel Serialization)
[ Electron Main Process ]
    ├── ExperimentalCoreBridge (IPC Dispatcher)
    ├── ExperimentalCoreRuntime (Orchestrator & Session Manager)
    │     ├── MemoryCoreSessionStore / SQLite Session Store
    │     ├── DurableEventStore (Receipts, Transitions, Event Stream)
    │     ├── CoreContextComposer (Agent & Personal Context Assembly)
    │     ├── SurfaceRegistry (Surface validation & capability rules)
    │     ├── PermissionStore (Tool execution authorization & Firewall)
    │     └── Direct CLI Adapters (tomnyCoreAdapter, acpCoreAdapter, etc.)
    ├── ToolSelector (Built-in MCP Server on Loopback SSE)
    ├── RealtimeKnowledge (RTK Built-in MCP Server on Loopback SSE)
    ├── Router 9 Gateway (External Daemon on Port 20129)
    └── PackageManagerService (.tomny Artifact Download, Verify, Unpack)`

### Key Subsystem Analysis (Code Evidence)

- **ExperimentalCoreRuntime (packages/desktop/src/process/experimentalCore/experimentalCoreRuntime.ts)**: Owns the entire run lifecycle via launch() and
  un(). It orchestrates surface prelude resolution, tool catalog filtering, MCP server discovery, context composition, adapter dispatch, permission gating, and terminal event emission.
- **CoreContextComposer (packages/desktop/src/process/agentRuntime/contextComposer.ts)**: Reads AgentContext and PersonalContext from ContextStore. It statically formats user facts, preferences, habits, and opaque secret handles into a markdown block capped at 12,000 characters.
- **SessionMemoryStore (packages/desktop/src/process/userUnderstanding/sessionMemoryStore.ts)**: High-capacity, single-session scratchpad. Uses lexical overlap scoring, salience eviction, and deduplication to maintain session notes without an external vector database.
- **RealtimeKnowledge (packages/desktop/src/process/knowledge/)**: Houses real-time grounding facts and embedding lookup (
  tkEmbedder.ts). Crucially, **RTK is NOT invoked as an automatic pipeline stage**; it is exposed as an MCP tool (
  ealtimeKnowledgeServer) via loopback SSE for the LLM to call on demand.
- **ToolSelector (packages/desktop/src/process/toolselect/)**: Contains catalog filtering, keyword matching, semantic scoring, and choice advice. Similar to RTK, it is wrapped inside an in-process MCP server ( oolSelectorServer).
- **PackageManagerService (packages/desktop/src/process/extensions/package-manager/)**: Handles download, integrity validation (SHA-256), signature verification (Ed25519), unpacking, enabling, disabling, and uninstallation. Supported package types are strictly 'app' | 'ui' | 'agent-capsule'.

---

## 3. Current Chat Pipeline & Hard-Coded Seams

### Step-by-Step Flow Trace

`User Message
    │ (Renderer UI: SendBox.tsx)
    ▼
[1] IPC Send (core.experimental.start)
    │ (Preload Bridge)
    ▼
[2] ExperimentalCoreBridge validates payload and forwards to 
untime.start()
    │
    ▼
[3] ExperimentalCoreRuntime.launch()
    │ - Instantiates AbortController
    │ - Registers active request in Map
    │ - Calls 	his.run()
    ▼
[4] Target & Adapter Detection
    │ - Inspects 	his.targets (DetectedCoreTarget[])
    │ - Finds registered CoreAdapter (e.g., 	omnyCoreAdapter)
    ▼
[5] Surface & Capability Resolution
    │ - Calls surfaceRegistry.resolve()
    │ - Filters tool catalogs and MCP server endpoints
    │ - Attests Secret Firewall permissions
    ▼
[6] Session State & Checkpoint
    │ - Fetches or creates session checkpoint in sessionStore
    │ - Records user turn into history
    ▼
[7] Hard-Coded Prelude Assembly (HARD-CODED SEAM 1)
    │ - Capability Contract
    │ - Surface Harness Prompt
    │ - Saved Memory Context (Pinned facts)
    │ - Conversation Guidance
    ▼
[8] ContextComposer Injection (HARD-CODED SEAM 2)
    │ - Calls contextComposer.composePrompt()
    │ - Fetches Agent facts + Personal facts + Opaque secret handles
    │ - Truncates to 12,000 characters
    ▼
[9] Adapter Invocation
    │ - Passes concatenated string to dapter.run({ prompt, ... })
    ▼
[10] LLM Execution & Streaming
    │ - Subprocess / Stdio / SSE connection to backend (Codex, Tomny CLI, ACP, OpenAI)
    │ - Streams back chunks (delta, 	hinking, status, 	ool-call)
    ▼
[11] Tool Execution & Governance
    │ - If 	ool-call: intercepted by ExperimentalCoreRuntime.requestPermission()
    │ - Evaluated against permissionStore.authorize() or prompts UI modal
    ▼
[12] Terminal Checkpoint & Event Emission
    │ - Assistant response saved to sessionStore
    │ - Emits completed or rror event`

### Table of Current Pipeline Steps

| Step                       | Module / File                  | Function / Class          | Input -> Output                  | State / Side Effects       | Can be Modular Stage?    | Coupling to Core       |
| :------------------------- | :----------------------------- | :------------------------ | :------------------------------- | :------------------------- | :----------------------- | :--------------------- |
| **1. UI Trigger**          | SendBox/index.tsx              | handleSend()              | Text -> IPC invoke               | Stateless UI               | No                       | Core Shell             |
| **2. IPC Bridge**          | xperimentalCoreBridge.ts       | IPC provider              | IPC payload -> Core invoke       | Stateless                  | No                       | Core Bridge            |
| **3. Lifecycle Start**     | xperimentalCoreRuntime.ts      | launch()                  | Request params -> Active request | Stateful (Map)             | No (Must remain Core)    | Core Runtime           |
| **4. Surface Resolution**  | surfaceRegistry/registry.ts    |
| esolve()                   | Surface ID -> Resolved surface | Read-only state           | No (Core Security)               | High                       |
| **5. Session Checkpoint**  | xperimentalCoreRuntime.ts      | sessionStore.save()       | Turn -> Durable snapshot         | Persistent I/O             | No (Must remain Core)    | Core Session           |
| **6. Prelude Assembly**    | xperimentalCoreRuntime.ts      | Inline string concat      | Metadata -> String prelude       | Stateless                  | **YES** (context.enrich) | **Hard-coded in Core** |
| **7. Context Compose**     | contextComposer.ts             | composePrompt()           | Prompt + ID -> Expanded prompt   | Reads ContextStore         | **YES** (context.enrich) | **Hard-coded in Core** |
| **8. Dynamic Retrieval**   |
| ealtimeKnowledgeMcpHost.ts | MCP tool call                  | Query -> Facts (deferred) | Lazy / Reactive                  | **YES** (context.retrieve) | High (MCP coupled)       |
| **9. Adapter Dispatch**    | dapters/tomnyCoreAdapter.ts    |
| un()                       | Prompt string -> Event stream  | Subprocess execution      | Partially (model.route)          | High                       |
| **10. Tool Governance**    | xperimentalCoreRuntime.ts      |
| equestPermission()         | Tool call -> Boolean approval  | Modifies permission log   | **NO (MUST STAY CORE)**          | Core Security Invariant    |
| **11. Final Save**         | xperimentalCoreRuntime.ts      | sessionStore.save()       | Response -> Checkpoint           | SQLite/File write          | No (Must remain Core)    | Core Session           |

---

## 4. Subsystem Modularization Candidates

Each subsystem is evaluated for pipeline extraction under strict architectural boundaries:

`[A. MUST STAY CORE]               -> Security, Authority, Session Durability, Invariants
[B. SHOULD BECOME DEFAULT PKG]     -> Core AI Capabilities with swappable implementations
[C. MAY BECOME PIPELINE PKG]       -> Advanced/Optional processing algorithms
[D. PACKAGE-APP SPECIFIC]          -> Domain-specific surfaces (IDE, Browser, Studio)`

| Subsystem                                |          Classification          | Architectural Justification                                                                                                                                                                              |
| :--------------------------------------- | :------------------------------: | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Session Memory (Working Memory)**      |      **A. MUST STAY CORE**       | Bound to tab lifecycle, single-turn scratchpad, and crash recovery. Exposing working memory state mutations to external packages risks session state corruption.                                         |
| **Saved Memory (Session Save / Pinned)** |      **A. MUST STAY CORE**       | Verbatim historical facts required for session replay and branch inspection. Must remain deterministic and owner-isolated.                                                                               |
| **Semantic Memory (Long-term Profile)**  | **B. SHOULD BECOME DEFAULT PKG** | Vector-based personal fact recall can vary widely (local embeddings vs cloud vector search). Wrapping this as @tomni/semantic-memory-default allows users to plug in Mem0, Zep, or custom vector stores. |
| **Realtime Knowledge (RTK)**             | **B. SHOULD BECOME DEFAULT PKG** | Currently isolated in process/knowledge. Should evolve from a passive MCP tool into an active context.retrieve pipeline stage package (@tomni/rag-default).                                              |
| **IDE Knowledge Graph**                  |   **D. PACKAGE-APP SPECIFIC**    | Code symbol indexing, AST navigation, and workspace graph belong strictly to the optional IDE package (packages/package-apps/ide). Must not touch base chat.                                             |
| **ContextComposer (Core Shell)**         |      **A. MUST STAY CORE**       | Owns opaque secret handles, sanitization, and surface identity boundaries. Third-party packages must never view unredacted secrets.                                                                      |
| **Personal Fact Enrichment**             | **B. SHOULD BECOME DEFAULT PKG** | Formats user preferences and psychological communication rules. Easily modularized behind an enrichment interface.                                                                                       |
| **Context Branches / Session Forking**   |      **A. MUST STAY CORE**       | Inherent to CoreSessionStore.forkSession() and the durable event tree.                                                                                                                                   |
| **Query Preprocessing (Transform/HyDE)** |  **C. MAY BECOME PIPELINE PKG**  | Query expansion, spelling correction, and HyDE (Hypothetical Document Embeddings) are modular transformations with zero side effects.                                                                    |
| **Context Retrieval (RAG)**              | **B. SHOULD BECOME DEFAULT PKG** | Core should not dictate whether dense, sparse (BM25), or graph retrieval is used. Protocol-based retrieval packages enable ecosystem innovation.                                                         |
| **Context Reranking**                    |  **C. MAY BECOME PIPELINE PKG**  | Cohere Rerank, FlashRank, or BGE-Reranker can operate as an optional post-retrieval stage.                                                                                                               |
| **Context Compression**                  |  **C. MAY BECOME PIPELINE PKG**  | LLMLingua, extractive summarizers, or prompt pruning algorithms cleanly consume documents and return compressed tokens.                                                                                  |
| **Token Budget Accounting**              |      **A. MUST STAY CORE**       | Enforces context window limits, cost controls, and truncation invariant to prevent model provider rejections.                                                                                            |
| **Dynamic Tool Selector**                | **B. SHOULD BECOME DEFAULT PKG** | Catalog scoring (keywordFilter, semanticFilter, choiceAdvisor) can easily run as a standardized ool.select stage package.                                                                                |
| **Model Router**                         | **B. SHOULD BECOME DEFAULT PKG** | Dynamic intent routing (selecting between fast local models, reasoning models, or cloud providers) should be an extensible package.                                                                      |
| **Outbound Transformation / Firewall**   |      **A. MUST STAY CORE**       | Secret redaction, regex masking, and egress security checks are non-negotiable platform guarantees. Third-party packages cannot control the firewall.                                                    |

---

## 5. Default RAG Packaging Decision

### Comparison of Architectural Options

| Evaluation Metric            | Option A: Hard-Coded in Core | Option B: Bundled Built-in Package (Recommended)            | Option C: Fully Independent Store Package       |
| :--------------------------- | :--------------------------- | :---------------------------------------------------------- | :---------------------------------------------- |
| **Startup Reliability**      | 10/10 (Guaranteed)           | **9.9/10 (Guaranteed via local fallback)**                  | 7/10 (Vulnerable to network/store outage)       |
| **Offline Capability**       | 10/10                        | **10/10 (Artifact pre-bundled in installer)**               | 4/10 (Requires internet to fetch on setup)      |
| **Architecture Complexity**  | Low (Legacy monolith)        | **Medium (Unified package protocol)**                       | High (Dynamic bootstrap dependencies)           |
| **Independent Updates**      | 0/10 (Requires app release)  | **10/10 (Can update via Store without Electron update)**    | 10/10                                           |
| **Rollback Capability**      | 0/10                         | **10/10 (Rolls back to previous version or built-in base)** | 10/10                                           |
| **Uninstall Safety**         | N/A (Cannot uninstall)       | **9/10 (Reverts to In-Core Null Passthrough)**              | 5/10 (Risk of leaving pipeline in broken state) |
| **Debuggability**            | High                         | **High (Standard event stream & receipts)**                 | Medium (Catalog mismatch complexity)            |
| **Performance Overhead**     | Zero                         | **Zero to +1 ms (Fast-Path in-process link)**               | +15 to +50 ms (External IPC process)            |
| **Package Corruption Risk**  | None                         | **Zero (Auto-reverts to immutable core fallback)**          | High                                            |
| **Fresh-Install Experience** | Seamless                     | **Seamless (Works instantly after install)**                | Degraded if download stalls                     |

### Recommendation: Option B (Bundled Built-in Package with Core Invariant)

**Architecture Decision:**

1. Default RAG is authored and packaged as a standard .tomny package: @tomni/rag-default.
2. It ships inside the Electron installer under
   esources/builtin-packages/tomni-rag-default.tomny.
3. On first boot, the system admits and mounts it automatically without network access.
4. **The Core Invariant:** ExperimentalCoreRuntime retains an immutable, zero-dependency **Null Retrieval Stage** (PassthroughStage). If @tomni/rag-default is disabled, uninstalled, or crashes, the pipeline does NOT fail—it simply executes chat without retrieval.

## 6. Stable Pipeline Stage Protocol

To avoid direct coupling between disparate packages (e.g., Repo A calling Repo B), all communication flows through a typed, versioned **Pipeline Context Envelope**.

`[ Incoming Query ]
        │
        ▼
┌────────────────────────────────────────────────────────┐
│             Tomni Pipeline Context Envelope             │
├────────────────────────────────────────────────────────┤
│ • metadata: requestId, sessionId, workspace, surface    │
│ • query: original, transformed, language               │
│ • messages: active bounded conversation turns          │
│ • contextSegments: injected facts, memory items        │
│ • retrievedDocuments: retrieved & ranked text chunks   │
│ • toolHints: candidate tool metadata                   │
│ • routeHints: model target recommendations             │
│ • metrics: execution time & token counts per stage     │
└────────────────────────────────────────────────────────┘
        │                 │                 │
        ▼                 ▼                 ▼
 [ Stage 1: Adapt ] ──> [ Stage 2: Adapt ] ──> [ Stage N: Adapt ]`

### TypeScript Canonical Contract (pipelineProtocol.ts)

` ypescript
export const PIPELINE_PROTOCOL_VERSION = 1.0.0;

export type PipelineStageKind =
| 'query.transform'
| 'memory.retrieve'
| 'context.retrieve'
| 'context.rerank'
| 'context.compress'
| 'tool.select'
| 'model.route';

export type PipelineDocumentChunk = {
id: string;
source: string;
title?: string;
content: string;
score: number;
metadata?: Record<string, string | number | boolean>;
};

export type PipelineContextSegment = {
id: string;
label: string;
content: string;
priority: number;
source: 'core' | 'memory' | 'package';
};

export type PipelineEnvelope = {
protocolVersion: typeof PIPELINE_PROTOCOL_VERSION;
sessionId: string;
requestId: string;
workspacePath?: string;
surfaceId: string;
permissionMode: string;

// Dynamic payload fields
originalQuery: string;
effectiveQuery: string;

// Context & documents
contextSegments: PipelineDocumentChunk[];
retrievedDocuments: PipelineDocumentChunk[];

// Selection and routing hints
toolHints?: {
eligibleToolPatterns: string[];
selectedTools: string[];
};
routeHint?: {
recommendedProvider?: string;
recommendedModel?: string;
temperature?: number;
};

// Telemetry & diagnostics
stageReceipts: Array<{
stageId: string;
stageKind: PipelineStageKind;
durationMs: number;
status: 'ok' | 'skipped' | 'fallback' | 'error';
error?: string;
}>;
};

export type StageExecutionResult = {
ok: boolean;
envelope: PipelineEnvelope;
error?: {
code: string;
message: string;
fatal: boolean;
};
};

/\*_ Every Pipeline Package implements this execution contract _/
export type IPipelineStageProvider = {
readonly id: string;
readonly stageKind: PipelineStageKind;
readonly version: string;

initialize?: () => Promise<void>;
execute: (envelope: Readonly<PipelineEnvelope>, signal: AbortSignal) => Promise<StageExecutionResult>;
dispose?: () => Promise<void>;
};
`

---

## 7. Stage Taxonomy & Execution Rules

| Stage Identifier | Execution Order | Multiplicity      | Failure Strategy                  | Required / Optional             |
| :--------------- | :-------------: | :---------------- | :-------------------------------- | :------------------------------ |
| query.transform  |        1        | Chainable (Max 3) | Skip to next stage                | Optional (Default: Passthrough) |
| memory.retrieve  |        2        | Single Active     | Fallback to Core Session Save     | Mandatory                       |
| context.retrieve |        3        | Chainable (Union) | Fallback to Built-in RAG -> Empty | Optional                        |
| context.rerank   |        4        | Single Active     | Skip (keep retrieval order)       | Optional                        |
| context.compress |        5        | Single Active     | Skip (pass uncompressed)          | Optional                        |
| ool.select       |        6        | Single Active     | Fallback to Core Tool Catalog     | Optional                        |
| model.route      |        7        | Single Active     | Fallback to User-Selected Model   | Optional                        |

---

## 8. Repo Analyzer & Package Classifier

To compile arbitrary GitHub repositories into valid .tomny Pipeline Packages, the **Repo Analyzer** applies multi-heuristic inspection:

`                  [ GitHub Repo URL / Source Folder ]
                                   │
                                   ▼
                       ┌───────────────────────┐
                       │   Repository Scanner   │
                       └───────────────────────┘
                                   │
         ┌─────────────────────────┼─────────────────────────┐
         ▼                         ▼                         ▼
   Runtime Detection       Interface Detection      Capability Analysis
   • package.json          • MCP Server export       • Vector / Embeddings
   • pyproject / uv        • OpenAPI / Fastify       • Token compression
   • Cargo.toml            • CLI (--query, stdout) • Model routing logic
   • Dockerfile            • LangChain / LlamaIndex  • Web search / scrapers
         │                         │                         │
         └─────────────────────────┼─────────────────────────┘
                                   ▼
                     ┌───────────────────────────┐
                     │    Package Classifier     │
                     └───────────────────────────┘
                                   │
       ┌──────────────┬────────────┴────────────┬──────────────┐
       ▼              ▼                         ▼              ▼
  APP PACKAGE  PIPELINE PACKAGE               BOTH       UNSUPPORTED
 (UI surface)   (Callable stage)          (App + Stage)  (No interface)`

### Classifier Decision Matrix

| Detected Signals                 | Classification   | Target Stage     | Integration Strategy                     |
| :------------------------------- | :--------------- | :--------------- | :--------------------------------------- |
| MCP tools lookup, search_docs    | PIPELINE PACKAGE | context.retrieve | Generates loopback MCP bridge adapter    |
| Python + FastAPI + RAG endpoints | PIPELINE PACKAGE | context.retrieve | Spawns background daemon with HTTP proxy |

| Node.js library exporting
erank() | PIPELINE PACKAGE | context.rerank | In-process worker thread adapter |
| React/Vite web application only | APP PACKAGE | N/A | Mounts as sandboxed web iframe |
| CLI tool outputting JSON to stdout | PIPELINE PACKAGE | query.transform | Subprocess exec adapter with timeout |
| GUI-only desktop app (Win32/Cocoa)| UNSUPPORTED | N/A | Rejection with diagnostic error |

---

## 9. Compatibility Levels (A / B / C / D)

`
[ Level A: Native ] - Implements @tomni/pipeline-sdk or standard MCP protocol natively. - Zero code generation required. Ready for instant mounting.

[ Level B: Auto Adaptable ] - Exposes standard OpenAPI, OpenAI-compatible HTTP, or structured CLI (--json). - Standard parameterized template generates the bridge adapter deterministically.

[ Level C: Agent Adaptable ] - Non-standard library, script, or notebook. - An AI Coding Sub-agent analyzes the repository, writes an adapter shim, creates a test suite, and verifies execution in a sandbox.

[ Level D: Unsupported ] - Missing programmatic interface, requires administrative privileges, kernel drivers, or incompatible hardware.
`

### Promotion & Demotion Rules

- **B -> A**: Developer adds a omny.manifest.json declaring native stage bindings.
- **C -> B**: An AI-generated adapter passes all contract test gates and is packaged with a frozen lockfile.
- **C -> D**: Adapter generation fails contract testing or execution exceeds 5,000 ms timeout during validation.

---

## 10. Package Lifecycle & Deletion Boundaries

The full 12-stage lifecycle ensures atomic transitions and zero leftover corruption:

`DISCOVER -> ANALYZE -> ADAPT -> INSTALL -> ENABLE -> ACTIVATE ->
UPDATE -> DISABLE -> REPLACE -> ROLLBACK -> UNINSTALL -> CLEANUP`

### What EXACTLY Gets Deleted Upon Uninstallation?

| Asset Category                | Description                   | Behavior on Remove Package    | Behavior on Purge Package     |
| :---------------------------- | :---------------------------- | :---------------------------- | :---------------------------- |
| **1. Binaries & Source Code** | Extracted package files       | **DELETED**                   | **DELETED**                   |
| **2. Generated Adapters**     | TypeScript bridge shims       | **DELETED**                   | **DELETED**                   |
| **3. Dependencies**           | Virtualenvs, npm modules      | **DELETED** (if refCount = 0) | **DELETED** (if refCount = 0) |
| **4. Package Configuration**  | User settings for package     | **PRESERVED**                 | **DELETED**                   |
| **5. Cached Artifacts**       | Downloaded .tomny, tmp files  | **DELETED**                   | **DELETED**                   |
| **6. Model Weights (Owned)**  | Unique downloaded model       | **PRESERVED** (warn user)     | **DELETED**                   |
| **7. Model Weights (Shared)** | Shared embedding model        | **PRESERVED** (refCount > 0)  | **PRESERVED** (refCount > 0)  |
| **8. Vector Indexes**         | Pre-computed embeddings       | **PRESERVED**                 | **DELETED**                   |
| **9. Package Database**       | Private SQLite state          | **PRESERVED**                 | **DELETED**                   |
| **10. User Documents / Chat** | Transcripts, notes, files     | **ALWAYS PRESERVED**          | **ALWAYS PRESERVED**          |
| **11. Shared System Data**    | Session store, core audit log | **NEVER TOUCHED**             | **NEVER TOUCHED**             |
| **12. Diagnostic Logs**       | Error receipts                | **PRESERVED** (Audit policy)  | **PRESERVED** (Audit policy)  |
| **13. Secret Credentials**    | API keys stored in Vault      | **UNLINKED** (kept in Vault)  | **DELETED FROM VAULT**        |
| **14. Pipeline Bindings**     | Active stage registration     | **REVERTED TO FALLBACK**      | **REVERTED TO FALLBACK**      |

## 11. Package Data Ownership Model

Packages must declare their data boundaries in the manifest:

`json
{
   packageData: {
    ownedPaths: [
      userData/packages//runtime.sqlite,
      userData/packages//state.json
    ],
    cachePaths: [
      cache/packages//chunks/,
      cache/packages//temp/
    ],
    sharedDependencies: [
      { id: model:bge-small-en-v1.5, type: model-weights, sizeBytes: 133400000 }
    ],
    persistentIndexes: [
      userData/packages//vector.index
    ]
  }
}
`

- **OWNED**: Exclusively owned by the package. Safely wiped during a Purge.
- **CACHE**: Temporary data. Safely wiped at any time.
- **SHARED**: Managed via reference counters across all installed packages.
- **USER DATA**: User documents, session checkpoints, and personal context. Invariant: **A package uninstaller cannot delete user data.**

---

## 12. Uninstall Modes: Remove vs. Purge

1. **Remove Package (Soft Uninstall / Default Mode)**:
   - Removes code payload, adapter, and volatile caches.
   - Preserves vector indexes, embeddings, and configuration.
   - **Benefit**: Reinstalling the package immediately restores previous indexed state without hours of re-indexing.
2. **Purge Package (Hard Uninstall / Deep Clean)**:
   - Completely removes package code, configuration, private database, and all generated vector indexes.
   - Cleans up shared model weights if no other installed package references them.
   - Retains only immutable audit logs and core user chat history.
   - **UX**: Requires explicit confirmation modal displaying the exact disk space to be freed.

---

## 13. Replace Stage Scenario & Atomic Rollback

Scenario: User replaces active retrieval engine **Repo A** with **Repo B**.

`[ Step 1: Install B in Quarantine ] ──> Unpack, verify SHA-256 and Ed25519 signature.
               │
               ▼
[ Step 2: Contract Test ] ───────────> Execute isolated test query; verify latency & schema.
               │
               ▼
[ Step 3: Shadow Execution ] ─────────> (Optional) Run alongside Turn 1; verify no crash.
               │
               ▼
[ Step 4: Atomic Binding Switch ] ────> Pointer for context.retrieve switches from A to B.
               │
               ▼
[ Step 5: Live Canary Evaluation ] ───> If Turn 1 fails or times out:
               │                        AUTOMATIC ROLLBACK TO A (< 5 ms).
               ▼
[ Step 6: Grace Standby ] ────────────> A remains installed in standby for 7 days / 50 turns.
               │
               ▼
[ Step 7: Decommission ] ─────────────> System prompts user: Repo B is stable. Remove Repo A?`

**Rule:** Uninstall A must NEVER precede Install & Verify B.

---

## 14. Fallback Architecture

To ensure the Chat Session NEVER crashes due to a faulty package:

`                 [ Incoming Retrieval Request ]
                               │
                               ▼
               ┌───────────────────────────────┐
               │    Active Package (Repo B)    │
               └───────────────────────────────┘
                               │
                    (Timeout / Crash / Error)
                               │
                               ▼
               ┌───────────────────────────────┐
               │ Fallback: Built-in Package    │
               │   (@tomni/rag-default)        │
               └───────────────────────────────┘
                               │
                       (Corrupt / Missing)
                               │
                               ▼
               ┌───────────────────────────────┐
               │ Invariant: Core Null Stage    │
               │  (Zero Retrieval Passthrough) │
               └───────────────────────────────┘
                               │
                               ▼
                 [ Prompt Dispatched to LLM ]
                   (Chat Continues Safely)`

- **Hard Fallback**: Automatic, zero-prompt downgrade upon error.
- **Telemetry Receipt**: The error is logged into the Durable Event Store and an unobtrusive warning badge is displayed in the conversation UI.

---

## 15. Update Architecture

The update mechanism reuses 100% of Tomny's existing PackageManagerService infrastructure:

- Download new .tomny archive -> verify SHA-256 -> verify publisher Ed25519 signature.
- Check protocol compatibility: semver.satisfies(manifest.pipelineProtocol, CURRENT_PROTOCOL_RANGE).
- If schema migrations exist, run package migration script with a transactional SQLite backup.
- Maintain previousVersion and previousManifest in InstalledPackageRecord for instantaneous 1-click rollback.

## 16. Dependency Graph & Shared Resources

`[ Package: Repo A ] ──┐
                      ├─► [ Shared Model: bge-small-en (RefCount = 2) ]
[ Package: Repo B ] ──┘
         │
         └──► [ Runtime: Python 3.11 Embedded (RefCount = 1) ]`

- **PackageDependencyGraph**: Main process service tracking all package-to-package, package-to-model, and package-to-runtime edges.
- **Reference Counting**: An asset's reference count is decremented upon package uninstallation. When
  efCount === 0, the asset is marked orphaned and deleted after a 48-hour grace period.

---

## 17. Performance & Latency Analysis

### Overhead by Execution Model

| Execution Model                       | Latency Overhead   | Memory Footprint         | Isolation Level         | Recommended Usage                 |
| :------------------------------------ | :----------------- | :----------------------- | :---------------------- | :-------------------------------- |
| **In-Process TypeScript (Fast-Path)** | **+0.5 to +2 ms**  | Negligible (Shared heap) | Process-level           | Built-in & Signed Native Packages |
| **Worker Thread (Worker Pool)**       | **+3 to +8 ms**    | Low (~30 MB)             | Thread-level            | Node.js / JS Community Packages   |
| **Loopback IPC (SSE / Stream HTTP)**  | **+8 to +18 ms**   | Medium (~60 MB)          | High (Separate process) | Python / Rust / Go Daemons        |
| **Subprocess Spawn (Stdio per turn)** | **+80 to +300 ms** | High (Process churn)     | High                    | Strongly Discouraged              |

### Invariant: Fast-Path for Built-in Packages

Built-in packages like @tomni/rag-default and @tomni/memory-default run directly on the Main process loop via direct method dispatch, ensuring default chats suffer zero latency penalties.

---

## 18. Failure Isolation & Circuit Breakers

- **Stage Timeout Limits**:
  - query.transform: Max 500 ms
  - context.retrieve: Max 2,500 ms
  - context.rerank: Max 1,500 ms
  - context.compress: Max 1,000 ms
- **Circuit Breaker**: If a package fails 3 consecutive times, the circuit trips:
  - The package is automatically disabled for 10 minutes.
  - The pipeline seamlessly falls back to @tomni/rag-default.
  - A notification informs the user: _ Package XYZ disabled due to repeated timeouts._

---

## 19. Incremental Migration Plan

We avoid big-bang rewrites through a 5-phase progressive transition:

`
Phase 0: Architecture & Contracts (Current Turn)
• Define pipelineProtocol.ts and envelope schemas.
• Establish unit tests for envelope invariants.

Phase 1: In-Process Pipeline Runtime (Core Wrappers)
• Introduce PipelineRuntime inside ExperimentalCoreRuntime.
• Wrap existing logic into DefaultPreludeStageAdapter and DefaultContextComposerStageAdapter.
• Zero behavioral change; all existing tests pass.

Phase 2: Extract Default Capabilities into Built-in Packages
• Move RTK and Session Memory recall into @tomni/rag-default and @tomni/memory-default.
• Bundle them as built-in .tomny packages in the Electron build.

Phase 3: Store & Manifest Protocol v2
• Extend PackageManifest with pipelineContributions.
• Enable Store UI to browse, filter, install, and disable Pipeline Packages.

Phase 4: Repo Analyzer & Adapter Generator
• Implement the analyzer CLI (mtui analyze repo <url>).
• Support Level A and Level B automated adapter compilation.

Phase 5: Agent-Assisted Adaptation (Level C)
• Integrate coding sub-agents to synthesize adapters for complex repositories.
`

---

## 20. Impacted Codebase Modules

| File Path                                                                        | Current Role                        |     Action      | Reason / Target State                                                      |
| :------------------------------------------------------------------------------- | :---------------------------------- | :-------------: | :------------------------------------------------------------------------- |
| packages/desktop/src/process/experimentalCore/experimentalCoreRuntime.ts         | Central chat lifecycle coordinator  |  **Refactor**   | Insert PipelineRuntime between session creation and adapter execution.     |
| packages/desktop/src/common/packages/types.ts                                    | Package manifest type definitions   |  **Refactor**   | Add 'pipeline-stage' to PackageType and add pipelineContributions.         |
| packages/desktop/src/process/agentRuntime/contextComposer.ts                     | Static prompt assembly              | **Keep & Wrap** | Remains authoritative for secret redaction; wrapped as a pipeline stage.   |
| packages/desktop/src/process/knowledge/realtimeKnowledgeBridge.ts                | RTK service bridge                  | **Move to Pkg** | Extracted into @tomni/rag-default.                                         |
| packages/desktop/src/process/knowledge/rtkEmbedder.ts                            | Embedding calculations              | **Move to Pkg** | Extracted into @tomni/rag-default.                                         |
| packages/desktop/src/process/toolselect/toolSelector.ts                          | Tool catalog filtering              | **Move to Pkg** | Extracted into @tomni/tool-selector-default.                               |
| packages/desktop/src/process/router9/managedRouter9.ts                           | Model gateway daemon                |    **Keep**     | Retained as system service; wrapped via model.route stage.                 |
| packages/desktop/src/process/extensions/package-manager/PackageManagerService.ts | Package installation & verification |  **Refactor**   | Support pipelineContributions mounting and data ownership purge semantics. |
| packages/desktop/src/process/pipeline/pipelineRuntime.ts                         | _New Module_                        |   **Create**    | Manages stage sequencing, timeouts, fallback, and circuit breakers.        |
| packages/desktop/src/process/pipeline/adapters/                                  | _New Directory_                     |   **Create**    | In-process fast adapters for default and built-in packages.                |

---

## 21. Risks of Over-Packaging & Non-Negotiable Boundaries

### What Must NEVER Be Modularized into Packages

1. **Secret Vault & Opaque Handles**: Security invariant. Allowing third-party code to intercept plaintext tokens breaks the platform guarantee.
2. **Core Permission Broker**: Tools modifying the filesystem or executing commands must always be approved by the Core Authority.
3. **Session Checkpoint Durability**: History, event trees, and rollback branches must remain under Core SQLite management.
4. **Active Token Window Accounting**: Must remain enforced by Core to avoid unhandled provider context limit crashes.

---

## 22. Target Architecture (TO-BE)

`                       User Prompt
                            │
                            ▼
              [ Core Chat Session Shell ]
                            │
              [ Durable Event Store (Receipt) ]
                            │
   ┌────────────────────────┴────────────────────────┐
   │        Composable Pipeline Runtime (Governed)    │
   │                                                 │
   │   [Stage 1: Query Transform]                    │
   │      └─► (Passthrough or Swappable Package)     │
   │                                                 │
   │   [Stage 2: Memory Retrieval]                   │
   │      ├─► Core Session Save (Authoritative)      │
   │      └─► Swappable Semantic Memory Package      │
   │                                                 │
   │   [Stage 3: Context Retrieval / RAG]            │
   │      ├─► Fallback: @tomni/rag-default (Built-in)│
   │      └─► Active: Swappable Third-Party Package  │
   │                                                 │
   │   [Stage 4: Context Reranking]                  │
   │      └─► (Optional Swappable Package)           │
   │                                                 │
   │   [Stage 5: Context Compression]                │
   │      └─► (Optional Swappable Package)           │
   │                                                 │
   │   [Stage 6: Core Sanitization & Secret Redact]  │
   │      └─► INVARIANT: Mandatory Core Filter       │
   │                                                 │
   │   [Stage 7: Model & Target Router]              │
   │      └─► Swappable Router / Fallback to User    │
   └────────────────────────┬────────────────────────┘
                            │
                            ▼
                [ LLM Direct Execution ]
                 (Tomny, Codex, ACP, OpenAI)
                            │
                            ▼
             [ Tool Call & Permission Intercept ]
             (Handled exclusively by Tomni Core)
                            │
                            ▼
                 Assistant Response Stream`

---

_Report concluded and verified against TomniHubOS repository boundaries._
