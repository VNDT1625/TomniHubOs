/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Goal slash commands (`/goal`, `/goal-all`).
 *
 * These commands turn a short user requirement into a fully expanded autonomous
 * instruction that is sent to the agent. The chat bubble still shows the raw
 * `/goal ...` text the user typed (display message), while the agent receives the
 * expanded prompt below (model input). This is what makes the agent understand,
 * immediately and without reading any external file, that "goal = the objective"
 * and that it must follow the mandatory closed-loop pipeline until the goal is
 * reached (or credits run out).
 *
 * The runtime prompt follows the canonical repository rules in `AGENTS.md` and
 * the execution protocol in `docs/execution/mvp-plan.md`.
 */

export const GOAL_COMMAND_NAME = 'goal';
export const GOAL_ALL_COMMAND_NAME = 'goal-all';

/** Matches `/goal <requirement>` or `/goal-all <requirement>` (goal-all first). */
const GOAL_COMMAND_RE = /^\/(goal-all|goal)\s+([\s\S]+)$/i;

/** Matches `/goal off`, `/goal stop`, `/goal-all off`, `/goal-all stop` (turn Goal Mode off). */
const GOAL_OFF_RE = /^\/(?:goal-all|goal)\s+(?:off|stop)\s*$/i;

/** Matches `/goal verify <command>` / `/goal verify off` (set/clear the independent verify command). */
const GOAL_VERIFY_RE = /^\/(?:goal-all|goal)\s+verify\b\s*([\s\S]*)$/i;

export type GoalCommandVariant = 'goal' | 'goal-all';

/**
 * Machine-readable status contract enforced by the renderer compliance engine.
 * The agent MUST end every turn with this marker so the renderer can gate the
 * run by code (see `goalCompliance.ts`).
 */
export const GOAL_STATUS_CONTRACT =
  'BẮT BUỘC — kết thúc MỖI lượt bằng đúng MỘT dòng trạng thái máy đọc được: [[GOAL next=continue|done|blocked tests=pass|fail|none phase=<số pha 1-9>]]. Dùng next=done CHỈ khi mọi Definition of Done đạt VÀ tests=pass; chưa xong dùng next=continue; bị chặn cứng dùng next=blocked. Thiếu dòng này lượt sẽ bị từ chối và bắt làm lại.';

export type ParsedGoalCommand = {
  variant: GoalCommandVariant;
  requirement: string;
};

/** Whether the input deactivates Goal Mode (`/goal off` / `/goal stop`). */
export const isGoalOffCommand = (input: string): boolean => {
  if (!input) return false;
  return GOAL_OFF_RE.test(input.trim());
};

export type ParsedGoalVerify =
  | { kind: 'set'; command: string } // set the verify command
  | { kind: 'clear' }; // `/goal verify off` — clear it

/**
 * Parse a `/goal verify ...` control command. Returns null when the input is not
 * a verify control command. `/goal verify off|stop|clear` clears; otherwise the
 * remainder is the shell command run to independently verify a `done` claim.
 */
export const parseGoalVerifyCommand = (input: string): ParsedGoalVerify | null => {
  if (!input) return null;
  const match = input.trim().match(GOAL_VERIFY_RE);
  if (!match) return null;
  const rest = (match[1] ?? '').trim();
  if (rest === '' || /^(off|stop|clear)$/i.test(rest)) return { kind: 'clear' };
  return { kind: 'set', command: rest };
};

/**
 * Parse a raw composer input. Returns null when the text is not a goal command
 * or has no requirement after the command name.
 */
export const parseGoalCommand = (input: string): ParsedGoalCommand | null => {
  if (!input) return null;
  const trimmed = input.trim();
  // `/goal off` and `/goal verify ...` are control commands, not requirements.
  if (GOAL_OFF_RE.test(trimmed)) return null;
  if (GOAL_VERIFY_RE.test(trimmed)) return null;
  const match = trimmed.match(GOAL_COMMAND_RE);
  if (!match) return null;
  const variant = match[1].toLowerCase() === GOAL_ALL_COMMAND_NAME ? 'goal-all' : 'goal';
  const requirement = match[2].trim();
  if (!requirement) return null;
  return { variant, requirement };
};

// Shared mandatory pipeline. English headings keep it stable for the model while
// the directives are written so the agent acts immediately.
export const MANDATORY_PIPELINE = [
  'QUY TRÌNH BẮT BUỘC 100% (đi đủ, đúng thứ tự, lặp lại từ pha lỗi — KHÔNG bỏ/đảo bước):',
  '1. Phân tích query: bóc tách mục tiêu chính, ràng buộc, phạm vi, và tự suy ra Definition of Done nếu chưa nêu; lưu trạng thái trong task state nội bộ của phiên, không tạo file Markdown theo dõi riêng.',
  '2. Lấy data: dùng `mtui --json map intent` rồi `compass read`/`read` để gom file liên quan; nhiều query cùng dùng MTUI/ide_research thì leader gọi song song và tự tổng hợp, không spawn; web search khi thiếu thông tin ngoài codebase.',
  '3. Suy luận + bổ sung dữ liệu và năng lực còn thiếu: đọc AGENTS.md và canonical doc phù hợp từ docs/README.md; lấp khoảng trống trong đúng phạm vi.',
  '4. Planning: chia thành các task rời rạc có thứ tự phụ thuộc rõ ràng, mỗi task có tiêu chí "xong" kiểm chứng được.',
  '5. Tối ưu plan cho sub-agent: chỉ spawn khi task độc lập cả đầu ra, write target VÀ hành động/tool-family chính; cùng tool chỉ khác query thì leader gọi tool song song. Khác hành động rõ ràng (vd. implement + independent test/review, code investigation + runtime Quick Test) mới chia ≤ 3–4 sub-agent; file chung/integration/checkpoint chạy tuần tự.',
  '6. Thực hiện tasks: bám stack dự án (Arco + @icon-park/react + UnoCSS semantic token + i18n; renderer không Node API, main không DOM API); auto-fix `bun run lint:fix` + `bun run format`; chạm renderer/locale thì `bun run i18n:types` + `node scripts/check-i18n.js`.',
  '7. Quick test mỗi bước: sau MỖI task chạy quick test nhanh (script Python/Node một-lần, xóa file tạm sau khi xong) + `getDiagnostics` + `bunx tsc --noEmit` cho phần liên quan; PASS → đánh dấu task [x], FAIL → vào pha 9.',
  '8. Test lần cuối: sau MỖI tính năng hoặc bước lớn, chạy bun run test cùng typecheck, lint và i18n phù hợp; ghi kết quả vào task state nội bộ của phiên.',
  '9. Khi lỗi: thu thập bằng chứng, tái hiện, cô lập nguyên nhân gốc, lập kế hoạch sửa, thực hiện rồi chạy lại test; nếu thất bại thì cập nhật giả thuyết từ bằng chứng mới và lặp.',
].join('\n');

export const RECOVERY_AND_RULES = [
  'Phục hồi khi treo: đóng tiến trình kẹt trong phạm vi nhưng không kill app người dùng đang dùng, chờ tài nguyên giải phóng, đọc task state nội bộ rồi tiếp tục đúng pha; treo lặp 2 lần cùng bước thì đánh dấu [-] và đi tiếp.',
  'Tự chủ trong phạm vi an toàn và lưu lý do ngắn trong task state nội bộ. Khi cần quyền mới, quyết định kiến trúc có nhiều hướng khác biệt, hoặc dữ liệu người dùng không thể suy ra an toàn, đánh dấu blocked và xin hướng dẫn; không tạo status Markdown riêng.',
  'An toàn: KHÔNG commit/push trừ khi yêu cầu nêu rõ; KHÔNG xóa dữ liệu hàng loạt; KHÔNG đụng production; KHÔNG dùng Claude/computer-use để test UI. Chỉ dừng hẳn khi gặp quyết định kiến trúc lớn không thể tự quyết an toàn (vd buộc sửa Rust backend tomnycore).',
  'Cập nhật trạng thái task ([ ] → [x] hoặc [-]) ngay khi xong mỗi sub-task; trả lời người dùng bằng tiếng Việt, giữ tiếng Anh cho code/định danh/commit/key i18n.',
  GOAL_STATUS_CONTRACT,
].join('\n');

// Each variant only differs by a leading objective line, an intro paragraph, and
// a "done" line; the pipeline and the recovery/safety rules are identical. We
// precompute the static head/tail of each prompt once at module load so that
// expanding a command at send-time is a single string concatenation rather than
// re-joining several long arrays on every call.
type GoalVariantSpec = {
  /** Static text before the user requirement. */
  head: string;
  /** Static text after the user requirement (intro + pipeline + done + rules). */
  tail: string;
};

const buildTail = (intro: string, doneLine: string): string =>
  '\n\n' + [intro, '', MANDATORY_PIPELINE, '', doneLine, '', RECOVERY_AND_RULES].join('\n');

const GOAL_VARIANT_SPECS: Record<GoalCommandVariant, GoalVariantSpec> = {
  goal: {
    head: 'MỤC TIÊU (GOAL) của phiên này: ',
    tail: buildTail(
      'Hãy tự thực hiện theo vòng lặp khép kín, lặp đến khi đạt Definition of Done hoặc bị chặn. Bắt đầu ngay và chỉ hỏi khi cần quyền mới, dữ liệu người dùng, hoặc quyết định không thể suy ra an toàn.',
      'Điều kiện dừng: mọi tiêu chí Definition of Done PASS + test tracker xanh + typecheck/lint/i18n sạch; hoặc hết credit; hoặc gặp quyết định kiến trúc lớn không thể tự quyết an toàn.'
    ),
  },
  'goal-all': {
    head: 'MỤC TIÊU GOAL-ALL, chế độ nghiệm thu nghiêm ngặt hơn: ',
    tail: buildTail(
      'Tự chủ tối đa trong phạm vi và quyền hiện có để đạt kết quả vượt mức tối thiểu: chủ động phủ edge case, độ bền, test, tài liệu và trải nghiệm nhưng không mở rộng authority hoặc phá vỡ ràng buộc dự án. Chỉ hỏi khi bị chặn theo AGENTS.md.',
      'Tiêu chí "xong" của GOAL-ALL: vượt Definition of Done tự đặt (≥101%), test tracker xanh, typecheck/lint/i18n sạch, đã chủ động phủ các trường hợp biên/độ bền hợp lý. Chỉ dừng khi đạt mức này, hết credit, hoặc gặp quyết định kiến trúc lớn không thể tự quyết an toàn.'
    ),
  },
};

/**
 * Expand a `/goal` or `/goal-all` composer input into the full autonomous
 * instruction to send to the agent. Returns null when the input is not a goal
 * command (caller should then send the original text unchanged).
 */
export const expandGoalCommand = (input: string): string | null => {
  const parsed = parseGoalCommand(input);
  if (!parsed) return null;
  const spec = GOAL_VARIANT_SPECS[parsed.variant];
  return spec.head + parsed.requirement + spec.tail;
};
