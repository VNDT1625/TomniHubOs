/** Searchable short metadata for built-in MCP tools available on Core surfaces. */
import type { CatalogEntry } from './catalogTypes';

const tool = (name: string, server: string, description: string, keywords: string[]): CatalogEntry => ({
  id: `mcp:${server}:${name}`,
  source: 'mcpTool',
  name,
  description,
  keywords,
  server,
});

/**
 * The selector intentionally keeps only short metadata. Full schemas still come
 * from the live MCP ToolMap, while tools_search can now discover the capability
 * instead of incorrectly reporting that no surface tool exists.
 */
export const BUILTIN_MCP_TOOL_CATALOG: readonly CatalogEntry[] = [
  tool(
    'tomny_secret_list',
    'tomny-secret-context',
    'List the secret sets this run may use (handle, label, variable names, scope, where each can be typed). Never returns a value.',
    ['secret', 'key', 'password', 'token', 'credential', 'vault', 'khóa', 'bí mật', 'mật khẩu', 'api key']
  ),
  tool(
    'tomny_secret_use',
    'tomny-secret-context',
    'Type a saved secret into a web form, a terminal, a managed process variable or a deployment without seeing the value.',
    ['secret', 'password', 'login', 'terminal', 'sudo', 'form', 'fill', 'env', 'nhập', 'đăng nhập', 'mật khẩu']
  ),
  tool(
    'tomny_secret_request',
    'tomny-secret-context',
    'Ask the person for a secret that does not exist yet; they fill it in and you never receive the value.',
    ['secret', 'request', 'ask', 'need', 'api key', 'token', 'yêu cầu', 'cần khóa']
  ),
  tool(
    'tomny_secret_request_access',
    'tomny-secret-context',
    "Ask the person to let the active Package App use one of their general app secrets; they approve or deny and you never receive the value.",
    ['secret', 'package', 'access', 'permission', 'grant', 'quyền', 'cấp khóa']
  ),
  tool(
    'tomny_secret_capture',
    'tomny-secret-context',
    'Capture a value from an exact browser field into the encrypted vault and return only a handle.',
    ['secret', 'capture', 'browser', 'save', 'lấy khóa', 'lưu khóa']
  ),
  tool(
    'tomny_secret_generate',
    'tomny-secret-context',
    'Generate a random key in the main process, store it in the vault and return only a handle.',
    ['secret', 'generate', 'random', 'key', 'fernet', 'api key', 'tạo khóa']
  ),
    tool(
    'workflow_run',
    'tomny-workflow',
    'Prefer for two or more granted tool calls, such as parallel reads of attached paths; resource-queued DAG returns one aggregate result.',
    ['workflow', 'parallel', 'queue', 'multiple tools', 'dependency', 'DAG', 'batch', 'điều phối', 'song song']
  ),
        tool(
    'workflow_mailbox_poll',
    'tomny-workflow',
    'Read session-scoped queued workflow errors and completed steps without waking an extra model turn.',
    ['workflow', 'mailbox', 'checkpoint', 'resume', 'progress', 'queue']
  ),
  tool(
    'workflow_adapter_get',
    'tomny-workflow',
    'Describe input schema and available generic output decoders for a single already-authorized MCP tool; useful when writing conditions.',
    ['workflow', 'tool adapter', 'schema', 'condition', 'output mapping']
  ),
  tool(
    'workflow_result_get',
    'tomny-workflow',
    'Retrieve selected bounded pieces of a previous workflow result with its run-scoped resultRef; avoids replaying large intermediate outputs.',
    ['workflow', 'result', 'retrieve', 'chunk', 'intermediate', 'output']
  ),
  tool(
    'agent_spawn',
    'tomny-agent-orchestrator',
    'Spawn multiple bounded child-agent jobs in parallel with the parent workspace, surface and permission claims.',
    ['team', 'agents', 'parallel', 'spawn', 'delegate', 'subagent', 'đội', 'agent con', 'song song', 'giao việc']
  ),
  tool(
    'agent_execute',
    'tomny-agent-orchestrator',
    'Execute one bounded child-agent job and optionally wait briefly for its result.',
    ['agent', 'execute', 'worker', 'delegate', 'run', 'thực thi', 'giao việc']
  ),
  tool(
    'agent_track',
    'tomny-agent-orchestrator',
    'Track child-agent job status and read incremental progress events using a cursor.',
    ['agent', 'track', 'status', 'progress', 'wait', 'theo dõi', 'tiến độ']
  ),
  tool('agent_result', 'tomny-agent-orchestrator', 'Read the durable output and current status of a child-agent job.', [
    'agent',
    'result',
    'collect',
    'report',
    'output',
    'kết quả',
    'báo cáo',
  ]),
  tool(
    'agent_resume',
    'tomny-agent-orchestrator',
    'Continue the same logical child agent with another objective in its existing session.',
    ['agent', 'resume', 'continue', 'follow-up', 'tiếp tục']
  ),
  tool(
    'agent_message',
    'tomny-agent-orchestrator',
    'Send a task, question, progress, control or handoff message to a child agent.',
    ['agent', 'message', 'delegate', 'handoff', 'question', 'nhắn', 'giao việc']
  ),
  tool(
    'agent_cancel',
    'tomny-agent-orchestrator',
    'Cancel queued or running child-agent jobs without deleting their durable metadata.',
    ['agent', 'cancel', 'stop', 'interrupt', 'hủy', 'dừng']
  ),
  tool('agent_targets', 'tomny-agent-orchestrator', 'List direct Tomny Core targets that can run child agents.', [
    'agent',
    'targets',
    'models',
    'runtime',
    'backend',
  ]),
  tool('tomny_context', 'tomny-ide', 'Rank repository files relevant to a concrete coding or debugging intent.', [
    'repository',
    'context',
    'files',
    'architecture',
    'codebase',
    'repo',
    'mã nguồn',
    'ngữ cảnh',
  ]),
  tool(
    'ide_research',
    'tomny-ide',
    'Build one bounded evidence pack for bug diagnosis, flow tracing, logic questions, or explaining a file purpose.',
    [
      'repository',
      'research',
      'evidence',
      'debug',
      'bug',
      'error',
      'flow',
      'trace',
      'logic',
      'purpose',
      'file',
      'codebase',
      'điều tra',
      'lỗi',
      'luồng',
      'logic',
      'mục đích',
    ]
  ),
  tool(
    'ide_test_script',
    'tomny-ide',
    'Run a bounded Python assertion script as a deterministic pre-fix reproduction or post-fix verification gate.',
    ['test', 'python', 'reproduce', 'regression', 'verify', 'debug', 'kiểm thử', 'tái hiện', 'xác minh', 'sửa lỗi']
  ),
  tool('tomny_map', 'tomny-ide', 'Build a navigable map of repository modules, layers and key files.', [
    'repository',
    'map',
    'architecture',
    'modules',
    'codebase',
    'sơ đồ',
    'kiến trúc',
  ]),
  tool('tomny_glob', 'tomny-ide', 'Find files under an absolute directory using a required glob pattern.', [
    'files',
    'glob',
    'find',
    'list',
    'directory',
    'tìm tệp',
    'thư mục',
  ]),
  tool('tomny_read', 'tomny-ide', 'Read bounded or complete file content from an absolute file path.', [
    'file',
    'read',
    'source',
    'code',
    'đọc tệp',
    'mã nguồn',
  ]),
  tool(
    'tomny_search',
    'tomny-ide',
    'Search repository file contents for a required query with optional glob and regex controls.',
    ['search', 'grep', 'pattern', 'repository', 'code', 'tìm kiếm', 'mã nguồn']
  ),
  tool(
    'tomny_analyze',
    'tomny-ide',
    'Analyze a repository or target path for languages, diagnostics and editor-engine support.',
    ['analyze', 'diagnostics', 'errors', 'typecheck', 'lint', 'phân tích', 'lỗi']
  ),
  tool(
    'tomny_command',
    'tomny-ide',
    'Run a guarded shell command in the granted workspace with a required rootPath and command.',
    ['command', 'terminal', 'test', 'build', 'run', 'shell', 'lệnh', 'chạy test']
  ),
  tool('tomny_team_status', 'tomny-ide', 'Inspect collaborative file participants and active leases for a workspace.', [
    'team',
    'collaboration',
    'lease',
    'status',
    'file',
    'cộng tác',
  ]),
  tool('tomny_team_claim', 'tomny-ide', 'Claim a collaborative file lease before editing a workspace file.', [
    'team',
    'claim',
    'lease',
    'edit',
    'file',
    'ghim tệp',
    'cộng tác',
  ]),
  tool(
    'tomny_team_edit',
    'tomny-ide',
    'Apply a lease-guarded exact anchored edit without overwriting unrelated work.',
    ['team', 'edit', 'replace', 'patch', 'file', 'sửa tệp', 'cộng tác']
  ),
  tool('tomny_team_write', 'tomny-ide', 'Replace a complete file through the lease and MTUI write gateway.', [
    'team',
    'write',
    'file',
    'replace',
    'ghi tệp',
    'cộng tác',
  ]),
  tool(
    'tomny_team_edit_many',
    'tomny-ide',
    'Apply exact text edits across several files in one batch with leases; all or nothing, one undo.',
    ['edit', 'many', 'batch', 'multiple', 'files', 'replace', 'sửa nhiều', 'hàng loạt']
  ),
  tool(
    'tomny_team_apply_patch',
    'tomny-ide',
    'Apply a unified diff to the workspace with leases; a hunk that no longer matches is refused with the file\'s current lines.',
    ['patch', 'diff', 'apply', 'unified', 'vá', 'áp dụng']
  ),
  tool(
    'tomny_team_undo',
    'tomny-ide',
    'Undo one MTUI operation or a whole edit batch; refuses if the file changed afterwards.',
    ['undo', 'revert', 'restore', 'rollback', 'hoàn tác', 'khôi phục']
  ),
  tool(
    'tomny_wiki',
    'tomny-core-workspace',
    'Ask the shared project Wiki how the repository is organised or why something works as it does; matching sections.',
    ['wiki', 'repository', 'overview', 'architecture', 'understand', 'hiểu repo', 'tổng quan']
  ),
  tool(
    'tomny_library_search',
    'tomny-core-workspace',
    'Search the Library: documents that installed packages brought and the person turned on. Read-only.',
    ['library', 'search', 'knowledge', 'guide', 'thư viện', 'tìm kiếm']
  ),
  tool(
    'tomny_package_cli',
    'tomny-core-workspace',
    'Run a command-line program that an installed package offered, after the person approves each call.',
    ['package', 'cli', 'command', 'program', 'gói', 'lệnh']
  ),
  tool(
    'tomny_compass',
    'tomny-core-workspace',
    'Read a big source file compressed, keeping the parts that matter for a query.',
    ['compass', 'compress', 'large file', 'source', 'đọc gọn']
  ),
  tool(
    'tomny_diff',
    'tomny-core-workspace',
    'Show the diff of one MTUI file operation or the most recent one.',
    ['diff', 'changes', 'what changed', 'thay đổi']
  ),
  tool(
    'tomny_compact',
    'tomny-core-workspace',
    'Shrink a long log or tool output saved in a file, keeping the errors.',
    ['log', 'compact', 'build output', 'test output', 'nhật ký']
  ),
  tool('ide_list_dir', 'tomny-ide', 'List one project directory.', ['directory', 'folder', 'list', 'thư mục']),
  tool('ide_find_definition', 'tomny-ide', 'Find where a symbol is defined.', ['definition', 'symbol', 'định nghĩa']),
  tool('ide_find_references', 'tomny-ide', 'Find every use of a symbol.', [
    'references',
    'usages',
    'symbol',
    'tham chiếu',
  ]),
  tool('ide_compass', 'tomny-ide', 'Compressed, code-aware source slices.', ['compass', 'source', 'code', 'mã nguồn']),
  tool('ide_summary', 'tomny-ide', 'Concise repository summary.', ['summary', 'overview', 'tóm tắt']),
  tool('ide_scan_repo', 'tomny-ide', 'Scan a repository structure.', ['scan', 'repository', 'quét']),
  tool(
    'ide_quick_test',
    'tomny-ide',
    'Run the app briefly and map runtime errors to source. Records DOM, network, console and exceptions (web) or logs (android/windows).',
    ['quick test', 'runtime', 'trace', 'e2e', 'android', 'windows', 'kiểm thử', 'chạy thử', 'lỗi runtime']
  ),
  tool(
    'ide_quick_test_list',
    'tomny-ide',
    'List saved Quick Test scenarios of a workspace. Pass an id to ide_quick_test_describe.',
    ['quick test', 'scenario', 'list', 'saved', 'regression', 'kịch bản', 'kiểm thử']
  ),
  tool('ide_quick_test_describe', 'tomny-ide', 'Show a saved scenario and its replay steps. Does not run the app.', [
    'quick test',
    'scenario',
    'describe',
    'steps',
    'kịch bản',
  ]),
  tool(
    'ide_quick_test_run',
    'tomny-ide',
    'Replay a saved scenario without manual input. Returns a run id; poll ide_quick_test_status.',
    ['quick test', 'replay', 'run', 'scenario', 'regression', 'verify', 'chạy lại', 'kiểm thử']
  ),
  tool(
    'ide_quick_test_status',
    'tomny-ide',
    'Poll a scenario run until passed, failed or cancelled, with failure evidence.',
    ['quick test', 'status', 'poll', 'result', 'trạng thái', 'kết quả']
  ),
  tool('ide_quick_test_cancel', 'tomny-ide', 'Cancel a queued or running scenario replay.', [
    'quick test',
    'cancel',
    'stop',
    'hủy',
  ]),
  tool(
    'ide_quick_test_compare',
    'tomny-ide',
    'Compare a known-bad run with a post-fix run to verify a fix. Reports interaction, error, network, timing and visual differences.',
    ['quick test', 'compare', 'diff', 'verify', 'fix', 'regression', 'so sánh', 'xác minh']
  ),
  tool('git_status', 'tomny-ide', 'Show the git working tree state.', ['git', 'status', 'changes']),
  tool('git_diff', 'tomny-ide', 'Show a git diff.', ['git', 'diff', 'changes']),
  tool('git_log', 'tomny-ide', 'Show recent git history.', ['git', 'log', 'history', 'lịch sử']),
  tool('db_query', 'tomny-ide', 'Run a read query on a connected database.', [
    'database',
    'sql',
    'query',
    'cơ sở dữ liệu',
  ]),
  tool('db_list_tables', 'tomny-ide', 'List tables of a connected database.', ['database', 'tables', 'sql']),
  tool('exp_search', 'tomny-ide', 'Search saved debugging experience.', ['experience', 'debug', 'kinh nghiệm']),
  tool('browser_open', 'tomny-browser-control', 'Open a URL in a browser tab.', [
    'browser',
    'open',
    'url',
    'web',
    'mở trang',
  ]),
  tool('browser_read_text', 'tomny-browser-control', 'Read the visible text of a page.', [
    'browser',
    'read',
    'page',
    'đọc trang',
  ]),
  tool('browser_click', 'tomny-browser-control', 'Click an element on a page.', ['browser', 'click', 'nhấp']),
  tool('browser_type', 'tomny-browser-control', 'Type text into a page field.', ['browser', 'type', 'input', 'nhập']),
  tool('browser_scroll', 'tomny-browser-control', 'Scroll a page.', ['browser', 'scroll', 'cuộn']),
  tool('browser_wait_for', 'tomny-browser-control', 'Wait for text or an element to appear.', [
    'browser',
    'wait',
    'chờ',
  ]),
  tool('browser_screenshot', 'tomny-browser-control', 'Capture a screenshot of a page.', [
    'browser',
    'screenshot',
    'ảnh chụp',
  ]),
  tool('browser_list_tabs', 'tomny-browser-control', 'List open browser tabs.', ['browser', 'tabs', 'thẻ']),
  tool('browser_extension_list', 'tomny-browser-control', 'List installed browser extensions and their state.', [
    'browser',
    'extension',
    'extensions',
    'addon',
    'tiện ích',
  ]),
  tool(
    'browser_extension_action',
    'tomny-browser-control',
    'Open an extension popup; enable or disable needs approval.',
    ['browser', 'extension', 'popup', 'tiện ích']
  ),
  tool('browser_research', 'tomny-browser-control', 'Research a topic across web pages.', [
    'browser',
    'research',
    'search',
    'tìm hiểu',
  ]),
  tool('browser_summarize_video', 'tomny-browser-control', 'Summarize a web video.', [
    'video',
    'summarize',
    'youtube',
    'tóm tắt',
  ]),
  tool('extract_content', 'tomny-browser-control', 'Extract the main content of a page or file.', [
    'extract',
    'content',
    'trích xuất',
  ]),
  tool('editor_open', 'tomny-browser-control', 'Open a file in the editor.', ['editor', 'open', 'file']),
  tool('editor_read', 'tomny-browser-control', 'Read the open editor document.', ['editor', 'read']),
  tool('editor_write', 'tomny-browser-control', 'Write to the open editor document.', ['editor', 'write', 'edit']),
  tool(
    'quick_test_discover',
    'tomny-browser-control',
    'Inspect a repo before launch: targets, services, commands, ports. Call first; never guess a command or port.',
    ['quick test', 'discover', 'services', 'ports', 'launch', 'e2e', 'khám phá', 'kiểm thử']
  ),
  tool(
    'quick_test_start',
    'tomny-browser-control',
    'Launch a discovered target (frontend, full or services) hidden by default. Returns a session id.',
    ['quick test', 'start', 'launch', 'run app', 'e2e', 'khởi chạy', 'kiểm thử']
  ),
  tool(
    'quick_test_status',
    'tomny-browser-control',
    'Read the Quick Test phase and latest evidence. Poll instead of sleeping.',
    ['quick test', 'status', 'poll', 'trạng thái']
  ),
  tool(
    'quick_test_visibility',
    'tomny-browser-control',
    'Show or hide a running Quick Test preview without stopping it.',
    ['quick test', 'show', 'hide', 'visible', 'hiển thị']
  ),
  tool(
    'quick_test_observe',
    'tomny-browser-control',
    'Start recording actions, console/network failures and screenshots. Call before browser_* interaction.',
    ['quick test', 'observe', 'record', 'evidence', 'ghi lại', 'kiểm thử']
  ),
  tool(
    'quick_test_save',
    'tomny-browser-control',
    'Save observed actions as a deterministic workflow for later replay.',
    ['quick test', 'save', 'workflow', 'scenario', 'lưu', 'kịch bản']
  ),
  tool(
    'quick_test_replay',
    'tomny-browser-control',
    'Replay a saved workflow and collect fresh evidence. Prefer after a code fix.',
    ['quick test', 'replay', 'regression', 'verify', 'chạy lại', 'xác minh']
  ),
  tool(
    'quick_test_audit',
    'tomny-browser-control',
    'Audit the live page for contrast, typography, accessibility and layout rules.',
    ['quick test', 'audit', 'accessibility', 'contrast', 'ui', 'a11y', 'kiểm tra giao diện']
  ),
  tool(
    'quick_test_capture',
    'tomny-browser-control',
    'Capture a viewport or full-page screenshot of a Quick Test session.',
    ['quick test', 'capture', 'screenshot', 'evidence', 'ảnh chụp']
  ),
  tool('quick_test_stop', 'tomny-browser-control', 'Stop observation and app processes; the result is kept.', [
    'quick test',
    'stop',
    'dừng',
  ]),
  tool('quick_test_close', 'tomny-browser-control', 'Close session resources after results are saved or consumed.', [
    'quick test',
    'close',
    'cleanup',
    'đóng',
  ]),
  tool('office_get_capabilities', 'tomny-office-editor', 'List what the Office editor can do.', [
    'office',
    'capabilities',
  ]),
  tool('office_read_document', 'tomny-office-editor', 'Read a Word, Excel or PowerPoint file.', [
    'office',
    'word',
    'excel',
    'powerpoint',
    'đọc tài liệu',
  ]),
  tool('office_search_replace', 'tomny-office-editor', 'Search and replace text in a document.', [
    'office',
    'replace',
    'thay thế',
  ]),
  tool('office_replace_passage', 'tomny-office-editor', 'Replace one passage of a document.', [
    'office',
    'passage',
    'edit',
    'sửa',
  ]),
  tool('office_replace_all', 'tomny-office-editor', 'Replace every match in a document.', ['office', 'replace', 'all']),
  tool('office_format_text', 'tomny-office-editor', 'Format text in a document.', ['office', 'format', 'định dạng']),
  tool('office_insert_text', 'tomny-office-editor', 'Insert text into a document.', ['office', 'insert', 'chèn']),
  tool('office_insert_table', 'tomny-office-editor', 'Insert a table into a document.', ['office', 'table', 'bảng']),
  tool('office_append_text', 'tomny-office-editor', 'Append text to a document.', ['office', 'append', 'thêm']),
  tool('office_set_cells', 'tomny-office-editor', 'Set spreadsheet cell values.', ['office', 'excel', 'cells', 'ô']),
  tool('office_create_premium_deck', 'tomny-office-editor', 'Create a presentation deck.', [
    'office',
    'powerpoint',
    'slides',
    'bài thuyết trình',
  ]),
  tool('office_create_premium_doc', 'tomny-office-editor', 'Create a Word document.', [
    'office',
    'word',
    'document',
    'tài liệu',
  ]),
  tool('office_run_api', 'tomny-office-editor', 'Run an Office editor API call.', ['office', 'api']),
  tool('agent_research_plan', 'tomny-agent-orchestrator', 'Plan parallel research across child agents.', [
    'agent',
    'research',
    'plan',
  ]),
  tool('agent_research_spawn', 'tomny-agent-orchestrator', 'Start planned research child agents.', [
    'agent',
    'research',
    'spawn',
  ]),
  tool('agent_sessions', 'tomny-agent-orchestrator', 'List child-agent sessions.', ['agent', 'sessions']),
  tool('agent_close', 'tomny-agent-orchestrator', 'Close a finished child-agent session.', ['agent', 'close']),
];

/** Tool groups a person or the pipeline can ask about: Surface capability id, short alias and the server that serves it. */
const GUIDE_GROUPS = [
  {
    capabilityId: 'surface.ide',
    alias: 'ide',
    server: 'tomny-ide',
    label: 'Project files, code, git, terminal, database',
  },
  {
    capabilityId: 'surface.browser',
    alias: 'browser',
    server: 'tomny-browser-control',
    label: 'Web pages, browser, editor, quick tests',
  },
  {
    capabilityId: 'surface.office',
    alias: 'office',
    server: 'tomny-office-editor',
    label: 'Word, Excel and PowerPoint documents',
  },
  {
        capabilityId: 'core.tool-workflow',
    alias: 'workflow',
    server: 'tomny-workflow',
    label: 'Parallel tools and conditional workflows',
  },
  {
    capabilityId: 'core.agent-orchestrator',
    alias: 'agents',
    server: 'tomny-agent-orchestrator',
    label: 'Child agents and teams',
  },
  // Testing has no server of its own: the shared Quick Test service is reached through the IDE and Browser
  // surfaces. `core.testing` is the intent the pipeline reports for test requests, and it resolves to these tools.
  {
    capabilityId: 'core.testing',
    alias: 'testing',
    server: 'testing',
    label: 'Testing and fix verification',
    names: [
      'ide_test_script',
      'ide_quick_test',
      'ide_quick_test_list',
      'ide_quick_test_describe',
      'ide_quick_test_run',
      'ide_quick_test_status',
      'ide_quick_test_cancel',
      'ide_quick_test_compare',
      'quick_test_discover',
      'quick_test_start',
      'quick_test_status',
      'quick_test_visibility',
      'quick_test_observe',
      'quick_test_save',
      'quick_test_replay',
      'quick_test_audit',
      'quick_test_capture',
      'quick_test_stop',
      'quick_test_close',
    ],
  },
  {
    capabilityId: 'core.workspace-read',
    alias: 'workspace',
    server: 'tomny-core-workspace',
    label: 'Read, search and understand files',
    names: ['tomny_read', 'tomny_glob', 'tomny_search', 'tomny_wiki', 'tomny_compass', 'tomny_diff', 'tomny_compact'],
  },
] as const;

/**
 * A compact list of exact tool names by group. A model that does not know the name of a tool cannot search for
 * it, so this is what it falls back on. `groups` accepts capability ids or short aliases (`ide`, `browser`,
 * `office`, `agents`, `testing`); nothing or nothing recognised lists every group.
 */
export const renderToolNameGuide = (groups?: readonly string[], allowedPatterns?: readonly string[]): string => {
  const wanted = new Set((groups ?? []).map((group) => group.trim().toLowerCase()).filter(Boolean));
  const matched = GUIDE_GROUPS.filter((group) => wanted.has(group.capabilityId) || wanted.has(group.alias));
  const selected = matched.length > 0 ? matched : GUIDE_GROUPS;
  // A tool a selected group names itself is listed only there, so no name appears twice.
  const claimed = new Set<string>(selected.flatMap((group) => ('names' in group ? [...group.names] : [])));
  const lines = selected
    .map((group) => {
      const own = 'names' in group ? new Set<string>(group.names) : undefined;
      const names = BUILTIN_MCP_TOOL_CATALOG.filter((entry) =>
        own ? own.has(entry.name) : entry.server === group.server && !claimed.has(entry.name)
      )
        .map((entry) => entry.name)
        .filter((name) => !allowedPatterns || toolNameAllowed(name, allowedPatterns));
      return names.length > 0 ? `- ${group.label}: ${names.join(', ')}` : '';
    })
    .filter(Boolean);
  return ['Tool names (use the exact name with ToolSearch):', ...lines].join('\n');
};

const matchesToolPattern = (name: string, pattern: string): boolean =>
  pattern === '*' || (pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : name === pattern);

/** True when a conversation whose catalog allows `patterns` can load the tool. */
export const toolNameAllowed = (name: string, patterns: readonly string[]): boolean =>
  patterns.some((pattern) => matchesToolPattern(name, pattern.trim()));

const BUILTIN_ENTRY_IDS = new Set(BUILTIN_MCP_TOOL_CATALOG.map((entry) => entry.id));

/** Whether a catalog entry is a built-in tool the given patterns do not allow. Skills and other sources pass. */
export const isBuiltinToolOutsidePatterns = (
  entry: { id: string; name: string },
  patterns: readonly string[]
): boolean => BUILTIN_ENTRY_IDS.has(entry.id) && !toolNameAllowed(entry.name, patterns);

const PURPOSE_MAX_CHARS = 48;

const purposeOf = (description: string): string => {
  const first = (description.split(/[.;]/u)[0] ?? '').trim();
  if (first.length <= PURPOSE_MAX_CHARS) return first;
  const cut = first.slice(0, PURPOSE_MAX_CHARS);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 1)).trimEnd()}…`;
};

/**
 * The tools a surface allows, by exact name with one clause of purpose, grouped by what they work on. It is part of
 * the system prompt, so it must be stable for a given surface: the same patterns always give the same text.
 * A model that knows the name of a tool can load it in one step; one that does not has to guess a query.
 */
export const renderSurfaceToolGuide = (patterns: readonly string[]): string => {
  const wanted = patterns.map((pattern) => pattern.trim()).filter(Boolean);
  const entries = BUILTIN_MCP_TOOL_CATALOG.filter((entry) =>
    wanted.some((pattern) => matchesToolPattern(entry.name, pattern))
  );
  if (entries.length === 0) return '';
  const labels = new Map<string, string>(GUIDE_GROUPS.map((group) => [group.server, group.label]));
  const byServer = new Map<string, string[]>();
  for (const entry of entries) {
    // A tool a group names itself is listed there, whichever server the catalog files it under.
    const named = GUIDE_GROUPS.find(
      (group) => 'names' in group && (group.names as readonly string[]).includes(entry.name)
    );
    const server = named?.server ?? entry.server ?? 'other';
    const items = byServer.get(server) ?? [];
    items.push(`${entry.name} (${purposeOf(entry.description)})`);
    byServer.set(server, items);
  }
  return [...byServer.entries()]
    .map(([server, items]) => `- ${labels.get(server) ?? server}: ${items.join('; ')}`)
    .join('\n');
};

export const listBuiltinMcpToolCatalog = (): CatalogEntry[] =>
  BUILTIN_MCP_TOOL_CATALOG.map((entry) => ({ ...entry, keywords: [...(entry.keywords ?? [])] }));
