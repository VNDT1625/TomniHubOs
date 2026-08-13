/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { GOAL_STATUS_CONTRACT, MANDATORY_PIPELINE, RECOVERY_AND_RULES, type GoalCommandVariant } from './goalCommand';

/**
 * Persistent "Goal Mode" steering.
 *
 * A one-shot `/goal` message can fall out of the model's context after a few
 * turns. Goal Mode keeps the workflow binding by re-injecting steering on EVERY
 * turn (deterministically, at the renderer layer — not relying on the backend),
 * until the user turns it off with `/goal off`.
 *
 * `GOAL_TURN_REMINDER` is the compact reminder prepended to each ordinary turn
 * while Goal Mode is active. `buildGoalSteering` is the full steering block (used
 * for the initial activation / anywhere the complete pipeline is wanted).
 *
 * Note: this guarantees the steering TEXT is present every turn; it cannot force
 * an LLM to comply 100% (no text mechanism can). True structural enforcement
 * would require gating the agent's tool loop in the backend.
 */

/** Compact, firm reminder injected on every ordinary turn while Goal Mode is on. */
export const GOAL_TURN_REMINDER = [
  '[GOAL MODE — STEERING BẮT BUỘC] Phiên đang ở chế độ Goal. MỌI phản hồi PHẢI tuân thủ QUY TRÌNH BẮT BUỘC, không bỏ/đảo bước:',
  'phân tích query → đọc AGENTS.md và canonical docs liên quan → lấy dữ liệu → planning → tối ưu plan, chỉ spawn khi khác đầu ra và write target → thực hiện → quick test sau MỖI task → test gate sau mỗi bước lớn → phân tích nguyên nhân gốc → fix → test lại.',
  'Tự chủ trong phạm vi an toàn; lưu tiến độ trong task state nội bộ, không tạo status Markdown. Xin hướng dẫn khi cần quyền mới hoặc quyết định kiến trúc không thể suy ra an toàn. KHÔNG commit, push, xóa hàng loạt hoặc đụng production trừ khi được yêu cầu. Gõ /goal off để tắt.',
  GOAL_STATUS_CONTRACT,
].join('\n');

/** Full Goal Mode steering block (pipeline + recovery/safety rules). */
export const buildGoalSteering = (variant: GoalCommandVariant): string => {
  const header =
    variant === 'goal-all'
      ? '[GOAL-ALL MODE - STEERING BẮT BUỘC] Tự chủ trong phạm vi, nghiệm thu 101% trong phạm vi và ưu tiên vượt mục tiêu. MỌI turn phải theo:'
      : '[GOAL MODE — STEERING BẮT BUỘC] MỌI turn phải theo:';
  return [header, '', MANDATORY_PIPELINE, '', RECOVERY_AND_RULES].join('\n');
};
