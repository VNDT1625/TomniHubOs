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
];

export const listBuiltinMcpToolCatalog = (): CatalogEntry[] =>
  BUILTIN_MCP_TOOL_CATALOG.map((entry) => ({ ...entry, keywords: [...(entry.keywords ?? [])] }));
