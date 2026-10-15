/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The parts of the app an assistant may point at. Only an id from this catalog can be spotlighted, so text
 * written by a model or a document never becomes a selector that the page evaluates.
 */
export type SpotlightTarget = Readonly<{
  id: string;
  /** Shown as the title of the coach mark. */
  label: string;
  /** What this control does, in one sentence. */
  hint: string;
  /** Selector for the control. Written here, never taken from user or model text. */
  selector: string;
  /** Page that has the control, when it is not visible everywhere. */
  route?: string;
  /** Words people use for it, in Vietnamese and English. Matched without accents and case. */
  aliases: readonly string[];
}>;

export const SPOTLIGHT_TARGETS: readonly SpotlightTarget[] = [
  {
    id: 'settings',
    label: 'Cài đặt',
    hint: 'Mở cài đặt hệ thống: model, MCP, giao diện, tài khoản.',
    selector: 'button[aria-label="Cài đặt hệ thống"]',
    aliases: ['cai dat', 'settings', 'cau hinh', 'tuy chon', 'preferences', 'model provider', 'api key'],
  },
  {
    id: 'notifications',
    label: 'Trung tâm thông báo',
    hint: 'Xem thông báo khẩn, bản tin gom và các kênh kết nối.',
    selector: '[aria-label="Trung tâm Thông báo"]',
    aliases: ['thong bao', 'notification', 'notifications', 'chuong', 'bell', 'alert'],
  },
  {
    id: 'search',
    label: 'Tìm kiếm nhanh',
    hint: 'Tìm lệnh, trang và cuộc trò chuyện. Phím tắt Ctrl + K.',
    selector: '[data-spotlight-id="search"]',
    aliases: ['tim kiem', 'search', 'ctrl k', 'omni search', 'go lenh', 'command palette'],
  },
  {
    id: 'chat-input',
    label: 'Ô nhập tin nhắn',
    hint: 'Gõ câu hỏi ở đây. Gõ / để xem lệnh, @ để chọn agent hoặc tệp, # cho tri thức, * cho pipeline.',
    selector: '[data-testid="guid-input"], .sendbox-panel textarea',
    aliases: ['o nhap', 'nhap tin nhan', 'chat input', 'sendbox', 'soan tin', 'prompt', 'composer'],
  },
  {
    id: 'attach-file',
    label: 'Đính kèm tệp',
    hint: 'Thêm tệp hoặc thư mục vào cuộc trò chuyện.',
    selector: '[data-testid="file-upload-btn"]',
    aliases: ['dinh kem', 'attach', 'tai len', 'upload', 'them tep', 'file'],
  },
  {
    id: 'super',
    label: 'Chế độ Super',
    hint: 'Bật để agent dùng trình duyệt và bộ công cụ mở rộng ngay từ tin đầu tiên.',
    selector: '[data-spotlight-id="super"]',
    route: '/guid',
    aliases: ['super', 'che do super', 'trinh duyet', 'browser control', 'cong cu mo rong'],
  },
  {
    id: 'pipeline',
    label: 'Dây chuyền xử lý',
    hint: 'Sắp xếp các bước bảo mật, hiểu ngữ cảnh và chọn công cụ trước khi gửi tới model.',
    selector: '[data-spotlight-id="pipeline"]',
    aliases: ['day chuyen', 'pipeline', 'chat pipeline', 'bao mat', 'security stage', 'laya'],
  },
  {
    id: 'nav-home',
    label: 'Trang chủ',
    hint: 'Về trang chủ để bắt đầu cuộc trò chuyện mới.',
    selector: '[data-spotlight-id="nav-home"]',
    aliases: ['trang chu', 'home', 'bat dau', 'chat moi', 'new chat'],
  },
  {
    id: 'nav-store',
    label: 'Cửa hàng gói',
    hint: 'Cài, gỡ và cập nhật ứng dụng, theme, MCP và pipeline.',
    selector: '[data-spotlight-id="nav-store"]',
    aliases: ['cua hang', 'store', 'goi', 'package', 'cai ung dung', 'marketplace'],
  },
  {
    id: 'nav-history',
    label: 'Lịch sử',
    hint: 'Xem lại các cuộc trò chuyện và ứng dụng đã mở.',
    selector: '[data-spotlight-id="nav-history"]',
    aliases: ['lich su', 'history', 'cuoc tro chuyen cu', 'recent'],
  },
  {
    id: 'nav-manager',
    label: 'Quản lý',
    hint: 'Theo dõi tác vụ của agent, cron và tài nguyên máy.',
    selector: '[data-spotlight-id="nav-management"]',
    aliases: ['quan ly', 'manager', 'tac vu', 'task', 'cron', 'lap lich', 'tai nguyen'],
  },
];

/** Lower case, no accents, single spaces: the form in which a request is compared with the aliases. */
export const normalizeSpotlightQuery = (value: string): string =>
  value
    .normalize('NFD')
    .replaceAll(/\p{M}/gu, '')
    .replaceAll('đ', 'd')
    .replaceAll('Đ', 'd')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, ' ')
    .trim();

export const getSpotlightTarget = (id: string): SpotlightTarget | undefined =>
  SPOTLIGHT_TARGETS.find((target) => target.id === id);

/**
 * Finds the control a request is about. An exact id wins; otherwise the target whose alias appears in the
 * request, longest alias first so "chat input" beats "chat". Returns undefined when nothing matches.
 */
export const resolveSpotlightTarget = (request: string): SpotlightTarget | undefined => {
  const normalized = normalizeSpotlightQuery(request);
  if (!normalized) return undefined;
  const byId = SPOTLIGHT_TARGETS.find((target) => target.id === normalized.replaceAll(' ', '-'));
  if (byId) return byId;
  let best: { target: SpotlightTarget; length: number } | undefined;
  const padded = ` ${normalized} `;
  for (const target of SPOTLIGHT_TARGETS) {
    for (const alias of [target.label, ...target.aliases]) {
      const normalizedAlias = normalizeSpotlightQuery(alias);
      if (!normalizedAlias || !padded.includes(` ${normalizedAlias} `)) continue;
      if (!best || normalizedAlias.length > best.length) best = { target, length: normalizedAlias.length };
    }
  }
  return best?.target;
};
