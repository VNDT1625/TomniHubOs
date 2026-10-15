/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Turns packaging progress and outcomes into the chat messages the user reads.
 *
 * Every line states something that happened. A stage is shown as done only after its `done` event,
 * and the screening summary says what was excluded and what was not checked; it never claims the
 * repository is free of malware.
 */

import { connectionNotInstallableReason } from '../../../../common/packages';
import {
  RepoPackagingError,
  type ExcludeReason,
  type PackagingStage,
  type RepoPackagingProgress,
  type RepoToPackageResult,
} from './types';

export const STAGE_ORDER: readonly PackagingStage[] = [
  'resolve',
  'fetch',
  'scan',
  'classify',
  'screen',
  'build',
  'sign',
  'write',
  'verify',
];

const STAGE_LABELS: Readonly<Record<PackagingStage, string>> = {
  resolve: 'Chuẩn bị khoá ký',
  fetch: 'Lấy mã nguồn',
  scan: 'Quét danh sách tệp',
  classify: 'Phân loại gói',
  screen: 'Kiểm tra bí mật và nội dung',
  build: 'Dựng manifest',
  sign: 'Ký số Ed25519',
  write: 'Ghi tệp gói',
  verify: 'Đọc lại và xác minh gói',
};

const REASON_LABELS: Readonly<Record<ExcludeReason, string>> = {
  'secret-name': 'tệp bí mật theo tên',
  'secret-content': 'tệp chứa khoá/token',
  'build-output': 'thư mục build',
  'vcs-or-tooling': 'tệp công cụ/VCS',
  lockfile: 'lockfile',
  'too-large': 'tệp quá lớn',
  'unsafe-path': 'đường dẫn không an toàn',
  symlink: 'liên kết tượng trưng',
  'output-directory': 'thư mục đầu ra',
  'outside-payload': 'ngoài phần được đóng gói',
};

/** Percent complete derived from finished stages only. */
export const progressPercent = (events: readonly RepoPackagingProgress[]): number => {
  const done = new Set(events.filter((event) => event.status === 'done').map((event) => event.stage));
  return Math.round((done.size / STAGE_ORDER.length) * 100);
};

export const renderProgress = (target: string, events: readonly RepoPackagingProgress[]): string => {
  const lines = STAGE_ORDER.map((stage) => {
    const finished = events.find((event) => event.stage === stage && event.status === 'done');
    const started = events.some((event) => event.stage === stage && event.status === 'started');
    const mark = finished ? '[x]' : '[ ]';
    const suffix = finished?.detail ? ` — ${finished.detail}` : started && !finished ? ' — đang chạy…' : '';
    return `- ${mark} ${STAGE_LABELS[stage]}${suffix}`;
  });
  return `📦 **[RepoToPackage] Đang đóng gói**\n\n🎯 Nguồn: \`${target}\`\n\n${lines.join('\n')}`;
};

const countsLine = (counts: Readonly<Partial<Record<ExcludeReason, number>>>): string => {
  const parts = (Object.entries(counts) as Array<[ExcludeReason, number]>)
    .filter(([, count]) => count > 0)
    .map(([reason, count]) => `${count} ${REASON_LABELS[reason]}`);
  return parts.length > 0 ? parts.join(', ') : 'không có';
};

const kilobytes = (bytes: number): string => `${Math.max(1, Math.round(bytes / 1024))} KB`;

export const renderSuccess = (result: RepoToPackageResult): string => {
  const { manifest, classification, source } = result;
  const sensitive = result.excluded.filter(
    (entry) => entry.reason === 'secret-name' || entry.reason === 'secret-content'
  );
  const origin = [
    source.display,
    source.ref ? `nhánh/tag ${source.ref}` : undefined,
    source.commit ? `commit ${source.commit.slice(0, 10)}` : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join(' · ');

  const lines = [
    '📦 **[RepoToPackage] Đã tạo gói**',
    '',
    `🎯 Nguồn: \`${origin}\``,
    '',
    `- Loại gói: \`${classification.archetype}\` (${manifest.type}) — \`${manifest.id}\` v${manifest.version}`,
    `- Đã đóng gói: ${result.includedFileCount} tệp`,
    `- Đã loại: ${countsLine(result.excludedCounts)}`,
  ];
  if (!classification.runnable && (result.adapter?.connections.length ?? 0) === 0) {
    lines.push(
      '- ⏸ Chỉ lưu mã nguồn trong `source/`: chưa có kết nối được nhận diện hoặc runtime phù hợp. Gói không tự chạy; cần cấu hình hoặc bổ sung host trước khi sử dụng.'
    );
    const reason =
      (classification.runnableIssueCode ? RUNNABLE_ISSUE_TEXT[classification.runnableIssueCode] : undefined) ??
      classification.runnableIssue;
    if (reason) lines.push(`- 🔍 Cần xử lý: ${reason}`);
  } else if (!classification.runnable && classification.runnableIssueCode === 'WEB_NEEDS_BUILD') {
    lines.push(`- 🔍 Giao diện web chưa chạy được: ${RUNNABLE_ISSUE_TEXT.WEB_NEEDS_BUILD}`);
  }
  for (const connection of result.adapter?.connections ?? []) {
    const reason = connectionNotInstallableReason(connection);
    if (reason !== undefined) lines.push(`- ⏸ Kết nối \`${connection.kind}\`: ${reason}`);
    // A web-embed connection has a host: it stays off until the person turns it on; its commands are still listed.
    else if (connection.kind === 'web-embed') {
      lines.push('- Kết nối `web-embed`: tắt khi cài; bật trong Kết nối sau khi chạy các lệnh dưới');
    }
    if (connection.kind === 'web-embed' && connection.process) {
      for (const service of connection.process.services) {
        const commands = [...(service.setup ?? []), service.start].map((command) => command.join(' '));
        const needs = (service.env ?? []).filter((variable) => variable.required).map((variable) => variable.name);
        lines.push(
          `  - \`${service.id}\` (cổng ${service.ready.port}): ${commands.join(' → ')}${needs.length > 0 ? `; cần biến môi trường: ${needs.slice(0, 8).join(', ')}${needs.length > 8 ? ', …' : ''}` : ''}`
        );
      }
    }
  }
  const mcpServer = manifest.contributions?.mcpServers?.[0];
  if (mcpServer) {
    lines.push(
      `- 🔌 MCP server: lệnh khởi động \`${mcpServer.command} ${mcpServer.args.join(' ')}\`; mã của repo nằm trong source/ và không được chạy khi đóng gói. Trạng thái bật/tắt được báo ở phần kết nối bên dưới sau khi cài. Phiên bản được ghim theo package.json của repo.`
    );
  }
  if (sensitive.length > 0) {
    const shown = sensitive.slice(0, 8).map((entry) => `\`${entry.path}\``);
    lines.push(
      `- 🔒 Tệp có thể chứa bí mật đã được loại khỏi gói: ${shown.join(', ')}${sensitive.length > shown.length ? `, … (+${sensitive.length - shown.length})` : ''}`
    );
  }
  lines.push(
    '- Kiểm tra tĩnh: không chạy mã của repository; chỉ loại tệp nhạy cảm và báo các điểm đáng chú ý bên dưới. Đây không phải quét mã độc và không kiểm tra tên thư viện với registry.'
  );
  if (result.warnings.length > 0) {
    lines.push('', '⚠️ **Cảnh báo**');
    for (const warning of result.warnings.slice(0, 8)) lines.push(`- ${warning.message}`);
    if (result.warnings.length > 8) lines.push(`- … và ${result.warnings.length - 8} cảnh báo khác`);
  }
  const openItems = (result.adapter?.openItems ?? []).filter((item) => item.kind !== 'needs-runtime');
  if (openItems.length > 0) {
    lines.push(
      '',
      `📋 **Việc còn mở (${openItems.length})** — lưu trong adapter/adapter.json cho agent hoặc bạn xử lý`
    );
    const values = openItems.filter((item) => item.kind === 'env-value').map((item) => item.name ?? '');
    if (values.length > 0) {
      lines.push(
        `- Điền giá trị cho: ${values.slice(0, 10).join(', ')}${values.length > 10 ? `, … (+${values.length - 10})` : ''}`
      );
    }
    for (const item of openItems.filter((entry) => entry.kind !== 'env-value').slice(0, 8)) {
      const where = item.path === undefined ? '' : ` \`${item.path}\`:`;
      const options = item.options === undefined ? '' : ` (${item.options.join(' / ')})`;
      lines.push(`-${where} ${item.note}${options}`);
    }
  }
  lines.push(
    '',
    `🔏 Chữ ký: khoá \`${result.keyId}\` (vân tay \`${result.keyFingerprint.slice(0, 16)}\`). Gói đã được đọc lại sau khi ghi và ${result.verified ? 'vượt qua' : 'CHƯA vượt qua'} kiểm tra toàn vẹn và chữ ký.`,
    `📁 Gói: \`${result.artifactPath}\` (${kilobytes(result.archiveBytes)})`,
    '',
    'Gói ký bằng khoá cục bộ của máy này. Để nộp lên Store cần ký bằng khoá nhà phát hành đã đăng ký.'
  );
  return lines.join('\n');
};

const hintFor = (error: RepoPackagingError): string | undefined => {
  switch (error.code) {
    case 'SOURCE_OUTSIDE_WORKSPACE':
      return 'Mở thư mục đó làm workspace, hoặc dùng địa chỉ https://github.com/<chủ>/<repo>.';
    case 'SOURCE_HOST_NOT_ALLOWED': {
      const allowed = error.details?.allowed;
      return Array.isArray(allowed) ? `Máy chủ được phép: ${allowed.join(', ')}.` : undefined;
    }
    case 'GIT_UNAVAILABLE':
      return 'Cài Git (git-scm.com) rồi thử lại.';
    case 'NOT_RUNNABLE': {
      const archetype = error.details?.archetype;
      return typeof archetype === 'string'
        ? `Đã nhận diện: \`${archetype}\`. Không tạo gói để tránh một gói không chạy được.`
        : undefined;
    }
    case 'TOO_MANY_FILES':
    case 'PAYLOAD_TOO_LARGE':
      return 'Dùng --path <thư-mục> để chỉ đóng gói phần cần thiết (ví dụ thư mục build).';
    default:
      return undefined;
  }
};

/** Vietnamese wording for why a classified repository cannot be hosted, keyed by the classifier's code. */
const RUNNABLE_ISSUE_TEXT: Readonly<Record<string, string>> = {
  NO_WEB_ENTRYPOINT:
    'Không có điểm vào chạy được: repository không có index.html hay bản build đã commit (dist/, build/, docs/), và phiên bản này không chạy trực tiếp ngôn ngữ của nó.',
  WEB_NEEDS_BUILD:
    'Trang chính tải mã nguồn (TypeScript, JSX hoặc template) chỉ chạy được sau khi build. Hãy build dự án rồi đóng gói thư mục kết quả (ví dụ --path dist).',
  HOST_RUNTIME_MISSING:
    'Phiên bản này chưa có runtime để chạy loại gói này từ một package. Repository đã được nhận diện, nhưng đóng gói sẽ chỉ tạo ra một trang không làm gì.',
  MCP_NO_LAUNCH_RECIPE:
    'Đã thấy MCP server nhưng không có package đã xuất bản để khởi động nó: cần package.json có name, version, bin (không private) hoặc pyproject.toml có scripts. Với repo monorepo, thử --path <thư-mục package>.',
  UNSUPPORTED_NATIVE: 'Mã C/C++ gốc không có giao diện web hay WebAssembly mà host có thể chạy.',
};

export const renderFailure = (target: string, error: unknown): string => {
  const known = error instanceof RepoPackagingError ? error : undefined;
  const issueCode = known?.code === 'NOT_RUNNABLE' ? known.details?.issueCode : undefined;
  const translated = typeof issueCode === 'string' ? RUNNABLE_ISSUE_TEXT[issueCode] : undefined;
  const reason = translated ?? (known ? known.message : error instanceof Error ? error.message : String(error));
  const hint = known ? hintFor(known) : undefined;
  return [
    '❌ **[RepoToPackage] Không đóng gói được**',
    '',
    `🎯 Nguồn: \`${target === '' ? '.' : target}\``,
    '',
    `Lý do: ${reason}`,
    ...(hint ? ['', hint] : []),
  ].join('\n');
};
