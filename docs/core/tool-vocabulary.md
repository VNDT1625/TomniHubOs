# Tool vocabulary

One list of the tool names agents use. Read each row as: **name, what it does, what stands behind it, permission, status**. Status labels follow [the documentation index](../README.md): **CURRENT** works and is tested, **PARTIAL** works in some paths, **TARGET** is planned.

## Rules

- `tomny_*` means a file or repository tool backed by MTUI. Every other group keeps its own prefix. The one deliberate exception is `tomny_secret_*`: Core-owned in-app tools for the app's secret vault, named so that `ToolSearch` finds them by exact name.
- Reading and understanding go through MTUI: bounded output, cheap in tokens.
- Writing goes through the team lease and MTUI. Several agents share one workspace, so a write is refused with the holder's name instead of overwriting, and `tomny_edit` changes only the region it names.
- **CURRENT (2026-10-07):** Nothing eligible is withheld from a surface. There is no `StartAction` gate: the model sees only `ToolSearch`, and the system prompt carries a compact Guide Map of every allowed tool (exact name plus one clause of purpose), stable for the resolved capability set. Tool schemas load on demand through **one** `ToolSearch` whose query holds exact names separated by spaces (the CLI ranks by name and loads the top 8). The router (Laya) may add a narrower per-turn hint, but does not add a capability. Loaded schemas stay for the rest of the turn. `tools_search` and `tools_guide` remain selector helpers; the live CLI ToolSearch is authoritative for schema loadability. Public Guide Map and selector metadata use `BUILTIN_MCP_TOOL_CATALOG`; compatibility aliases are not advertised to new conversations.
- **CURRENT (2026-10-07):** A normal chat receives Tomny Core capabilities plus its active surface. Super resolves the union of registered capabilities that pass the same model, permission-mode, scope, available-capability and explicit-grant checks as a normal surface; it does not use a wildcard catalog. A capability is advertised only when its Main-process host is registered. Super does not install or enable a package, and execution authorization remains at the shared adapter seam.

**Plain chat can read files.** The chat surface carries `core.workspace-read`: `tomny_read`, `tomny_glob` and `tomny_search` over the conversation's workspace, served by a read-only host (`readOnly` on the Core workspace server, so write, edit and command are never offered). Laya has its own question for these tools (`needsWorkspaceTools`), but the answer only changes the hint, never what exists. Only the chat surface has it, because the IDE surface already serves `tomny_*` names and two servers must not offer the same tool. A capability must also appear in `BUILTIN_AVAILABLE_CAPABILITIES`, or the surface drops it when it resolves.

**The CLI must be told about the servers.** The Tomny CLI reports `mcp: false` in its ready event, which means no MCP server is configured in it yet, not that it cannot take one; it accepts `add_mcp_server` and registers the tools within a few hundred milliseconds. The adapter therefore injects every selected server whatever that flag says. Treating it as "unsupported" once left every surface without its tools, `tools_search` included, so the model saw only `tomny_session_actions`.

- Permission is checked by the adapter before a tool runs. A tool cannot approve itself.
- **CURRENT (2026-10-15):** `workflow_run` là MCP tool thuộc capability `core.tool-workflow` và được khai báo `deferred: false` trên MCP host đã được Main cấp quyền (không cần ToolSearch để nạp schema); Main cấp cho workflow đúng danh sách host/toolPatterns đã được Surface cho phép. Một lần gọi có thể điều phối tối đa 64 bước con bất kể loại tool; bước độc lập chạy song song khi ResourceCoordinator cấp `workflowTool` lease, phần còn lại chờ queue. Bước có phụ thuộc và điều kiện chỉ chạy khi tiền nhiệm đạt yêu cầu, nhánh lỗi có thể chạy riêng, Agent nhận một báo cáo tổng hợp. Mỗi bước cần permission/PreToolUse, sử dụng host localhost có danh tính đã kiểm tra, có timeout, hủy và PostToolUse. Không dùng workflow để tải tool chưa có quyền, gọi tool selector, secret hoặc agent con, không tự chạy stdio hay remote MCP host.

## Workflow execution

| Tool | What it does | Behind it | Permission | Status |
| --- | --- | --- | --- | --- |
| `workflow_mailbox_poll` | Fetch session-scoped ordered workflow progress/error/completion events by workflowId and cursor without creating a model turn, acknowledging delivery | `workflow/mailbox.ts`, `workflow/server.ts` | Same authorized session/security scope | CURRENT (MCP + host handoff tests) |
| `workflow_adapter_get` | Fetch input schema and generic MCP output adapter hints for one already-authorized child tool; supports Agent-authored bounded `whenExpr` conditions | `workflow/dispatcher.ts`, `workflowCondition.ts` | Main-scoped tool pattern plus live MCP server tool list | CURRENT (MCP tests) |
| `workflow_result_get` | Fetch a bounded JSON chunk of a prior step via a run-scoped opaque `resultRef`; default smart delivery avoids re-sending large intermediate results | `workflow/resultDelivery.ts`, `workflow/server.ts` | Same governed Workflow MCP host; no extra tool capabilities | CURRENT (MCP tests) |
| `workflow_run` | Chạy nhiều loại tool đã cấp quyền trong một DAG; ví dụ `tomny_glob` → `tomny_read` chỉ khi `fileCount:1` + `inputFrom.select:'singleFile'`, có queue tài nguyên, điều kiện và kết quả tổng hợp | `workflow/server.ts`, `workflowEngine.ts`, `ResourceCoordinator` | Every child checked independently | CURRENT (MCP + tests; Electron model smoke pending) |

## File and repository tools

| Tool                                | What it does                                        | Behind it                      | Permission | Status                                 |
| ----------------------------------- | --------------------------------------------------- | ------------------------------ | ---------- | -------------------------------------- |
| `tomny_read`                        | Read a file or a line range                         | `mtui read`                    | read       | CURRENT                                |
| `tomny_search`                      | Search for literal text                             | `mtui search`                  | read       | CURRENT                                |
| `tomny_glob`                        | List files matching a pattern                       | `mtui glob`                    | read       | CURRENT                                |
| `tomny_context`, `tomny_map`        | Find the files that matter for a task; map the repo | `mtui context`, `mtui map`     | read       | CURRENT (IDE server)                   |
| `tomny_analyze`, `tomny_compact`    | Check a path for errors; shrink long logs           | `mtui analyze`, `mtui compact` | read       | CURRENT (IDE server)                   |
| `tomny_write`                       | Replace a whole file                                | team lease + `mtui new`        | write      | CURRENT                                |
| `tomny_edit`                        | Replace one exact piece of text                     | team lease + `mtui edit`       | write      | CURRENT                                |
| `tomny_team_claim/release/status`   | Reserve or release a file; see who holds what       | team lease                     | write      | CURRENT (IDE server)                   |
| `tomny_team_edit_many`              | Exact edits across several files, all or nothing    | team lease + `mtui edit-many`  | write      | CURRENT (IDE server)                   |
| `tomny_team_apply_patch`            | Apply a unified diff; a stale hunk is refused with the current lines | team lease + `mtui apply-patch`| write      | CURRENT (IDE server)                   |
| `tomny_team_undo`                   | Undo one operation or a whole edit batch            | team lease + `mtui undo`       | write      | CURRENT (IDE server)                   |
| `tomny_wiki`                        | Ask the project Wiki how the repo is organised      | `mtui wiki`                    | read       | CURRENT (needs the Wiki built in Studio) |
| `tomny_compass`                     | Read a big file compressed around a query           | `mtui compass read`            | read       | CURRENT (Core read-only)               |
| `tomny_diff`                        | Show what one operation changed                     | `mtui diff`                    | read       | CURRENT (Core read-only)               |
| `tomny_compact`                     | Shrink a long log kept in a file                    | `mtui compact`                 | read       | CURRENT (Core read-only; IDE has its own) |
| `exp_search/record/feedback/verify` | Debugging lessons learned                           | `mtui exp`                     | memory     | CURRENT (IDE server; rename is TARGET) |
| `tomny_command`                     | Run a command                                       | `mtui run`                     | execute    | TARGET (disabled in Core)              |

MTUI commands that have no tool yet (all TARGET): `delete`, `history`, `stats`, `conflict`, `policy`, `understand`, `verify`, `run`, `repair`. `verify` and `run` execute commands, so they wait for the governed command executor (like `tomny_command`). The IDE wiring already runs `mtui understand build` when the cache is missing.

**CURRENT (2026-10-08): MTUI gained batch commands.** `mtui edit-many` (several files, one group id), `mtui edit FILE replace-many` (several edits in one file), `mtui edit FILE regex`, `mtui undo --group`, `replace --old-file/--new-file`, and apply-patch failures that name the hunk and show the file's current lines. The tools above call them. Plain chat has the read-only ones (`core.workspace-read`); the mutating ones live where `tomny_team_edit` does and hold the team lease of every file they touch. The native `apply_patch` and `multiedit` calls are now remapped to `tomny_team_apply_patch` and `tomny_team_edit_many`. A slow MTUI start-up was traced to a daily clean-up marker that never refreshed, so the clean-up ran on every command (about 450 ms in this repo); it now runs once a day. Set `MTUI_TRACE_TIMING=1` to print start-up phase times.

**CURRENT (2026-10-07):** The public canonical workspace names are `tomny_read`, `tomny_glob`, `tomny_search`, `tomny_map`, `tomny_analyze`, and `tomny_command`. The duplicate public aliases `ide_read_file`, `ide_glob`, `ide_search`, `ide_grep`, `ide_map`, `ide_analyze`, `ide_command`, and `terminal_run` are no longer listed by Guide Map or selector metadata. Their runtime registrations remain compatibility endpoints for saved sessions, packages, ACP, and gateway callers. `terminal_run` is not a semantic alias: it executes an argv command through the Terminal service, while `tomny_command` is the governed IDE command path.

## Where a tool loads (availability)

**CURRENT (2026-10-07):** Every capability declares an `availability`, which decides whether its tool schemas cost tokens in a conversation. A tool that cannot run in a conversation is never listed in it.

| Availability   | Meaning                                                                 | Ordinary chat | Super | Inside its surface | Built-in capabilities                                                                                  |
| -------------- | ----------------------------------------------------------------------- | ------------- | ----- | ------------------ | ------------------------------------------------------------------------------------------------------ |
| `core`         | Part of Tomny chat                                                      | yes           | yes   | yes                | tool selector and skills, agent orchestrator, Secret Context (`tomny_secret_*`), `tomny_read`/`tomny_glob`/`tomny_search` |
| `portable`     | Specialised, works without its surface, not part of ordinary Tomny chat | no            | yes   | yes                | Browser (`browser_*`, `quick_test_*`, `editor_*`), Office (`office_*`)                                 |
| `surface-only` | Needs the surface's live harness                                        | no            | no    | yes                | IDE (`ide_*`, `tomny_*` project tools, `git_*`, `db_*`), Make Film, Music                              |

- A capability that does not declare an availability is `surface-only`, so a new tool never spends tokens where it cannot work.
- Super is the active surface's own capabilities plus the `core` and `portable` capabilities that pass the usual model, permission-mode, scope, grant and host checks. Turning Super on grants only portable scopes (`browser.control`, `office.read`, `office.write`); it never grants a surface-only capability.
- Inside a surface, Super adds the portable tools to that surface's own tools. In plain chat Super therefore carries `tomny_read` and not the IDE `tomny_*` handlers, which also removes the duplicate names the two servers shared.
- `tools_search` and `tools_guide` answer for the conversation's own tool set. The conversation's patterns travel to the shared selector host as a scope in its URL, so the selector never offers a tool the conversation cannot load. Skills are not affected. A caller without a scope sees the whole catalog.

## Testing

**CURRENT (2026-10-07):** Testing has no MCP server of its own. One shared Quick Test service in the Main process (`process/testing/`) runs web, Android and Windows sessions, and the IDE and Browser surfaces each reach it through their own bounded tools. `core.testing` is the intent the chat pipeline reports for a test request; the Guide Map resolves it to the tools below, not to a server. The former `tomny-testing` capability and its `test_list` / `test_report` names had no provider and were removed.

| Phase                | Tool                                                                                    | Surface | What it does                                                                       |
| -------------------- | --------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------- |
| Reproduce and verify | `ide_test_script`                                                                       | IDE     | Python assertion: `reproduce` must fail before an edit, `post-fix` must pass after |
| Runtime evidence     | `ide_quick_test`                                                                        | IDE     | Run the app briefly and map runtime errors to source files                         |
| Saved scenarios      | `ide_quick_test_list`, `_describe`, `_run`, `_status`, `_cancel`                        | IDE     | Replay a saved scenario without manual input                                       |
| Fix verification     | `ide_quick_test_compare`                                                                | IDE     | Compare a known-bad run with the post-fix run                                      |
| Launch               | `quick_test_discover`, `quick_test_start`, `quick_test_status`, `quick_test_visibility` | Browser | Find targets, start the app hidden, poll its phase                                 |
| Record               | `quick_test_observe`, `quick_test_save`                                                 | Browser | Record `browser_*` actions and save them as a workflow                             |
| Check                | `quick_test_replay`, `quick_test_audit`, `quick_test_capture`                           | Browser | Replay a workflow, audit UI rules, capture screenshots                             |
| Clean up             | `quick_test_stop`, `quick_test_close`                                                   | Browser | Stop processes, keep the result, release the session                               |

The IDE and Browser tools are separate entry points, not duplicates: Browser authors and records under `browser.control`, while IDE replays, maps evidence to code and verifies fixes under workspace permissions.

## Other groups

These do not run through MTUI. A group loads as a unit when the router selects it. Groups with network, secret, or background effects are never loaded only because the router guessed; the Surface must allow them.

| Group                       | Use for                       | Risk                     | Loaded when                              |
| --------------------------- | ----------------------------- | ------------------------ | ---------------------------------------- |
| `browser_*`, `quick_test_*` | Web pages and UI testing      | network, typing, secrets | the task has a URL or a web action       |
| `office_*` (29)             | Word, Excel, PowerPoint       | edits documents          | an office file is part of the task       |
| `agent_*` (12)              | Child agents                  | needs approval           | the task asks for orchestration          |
| `automation_*`, `cron_*`    | Workflows and schedules       | background actions       | the task asks for a workflow or schedule |
| `manager_*`, `company_*`    | Tasks, notes, teams           | writes                   | the task asks for them                   |
| `db_*`, `git_*`             | Database and git              | queries                  | a connection or git task                 |
| `tools_*`, `skills_*`       | Find tools and skills         | read                     | always                                   |
| `tomny_secret_*` (6)        | Type a saved secret           | secrets                  | the task needs a login or key            |
| `rtk_*`, `music_*`, image   | Live knowledge, music, images | network                  | a package or an explicit request         |
| `system_status`, `system_monitor` | Host status; realtime monitor (per-core CPU, RAM, disk/net/GPU, trend, alerts) | read | the `tomny-system` MCP is enabled |

## Cleanup (PARTIAL)

`extract_content` becomes `browser_extract`. The artifact tools become `artifact_*`. `tomny_image_generation` becomes `image_generate`, so the `tomny_` prefix keeps meaning "backed by MTUI" (the Core-owned `tomny_secret_*` group is the declared exception). `quick_test_*` and `ide_quick_test_*` already share one owner, the Quick Test service, and stay as two entry points (see Testing). The five `editor_*` tools in the browser server need an owner review, and any file access they perform must go through MTUI. Removing runtime compatibility aliases, normalizing the two distinct `tomny_*` workspace handlers (Core-contained versus IDE), and admitting installed package capabilities into the Guide Map remain PARTIAL.
