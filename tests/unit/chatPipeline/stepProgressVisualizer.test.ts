/**
 * @license
 * Copyright 2026 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { parseStepProgress } from '@/renderer/pages/conversation/Messages/components/StepProgressVisualizer';

describe('StepProgressVisualizer - parseStepProgress', () => {
  it('returns null for ordinary conversation text without step checklist', () => {
    const text = 'Xin chao! Toi co the giup gi cho ban hom nay?';
    expect(parseStepProgress(text)).toBeNull();
  });

  it('parses multi-step progress when execution is in-progress (Step 2/4)', () => {
    const text = `📦 **[RepoToPackage] Tiến trình phân tích mã nguồn**

🎯 Mục tiêu: \`./sample-repo\`

- [x] Bước 1/4: Đã quét xong tệp và phụ thuộc dự án
- [ ] Bước 2/4: Phân loại thành công dạng gói Tomni Package
- [ ] Bước 3/4: Đang chạy Laya Static Guardrail kiểm tra bảo mật...
- [ ] Bước 4/4: Ký số Ed25519 và tạo gói .tomny bundle`;

    const parsed = parseStepProgress(text);
    expect(parsed).not.toBeNull();
    expect(parsed?.headerTitle).toBe('RepoToPackage: Đóng gói tự động');
    expect(parsed?.target).toBe('./sample-repo');
    expect(parsed?.steps.length).toBe(4);
    expect(parsed?.steps[0].completed).toBe(true);
    expect(parsed?.steps[1].completed).toBe(false);
    expect(parsed?.steps[1].inProgress).toBe(true);
    expect(parsed?.progressPercent).toBe(25);
    expect(parsed?.isComplete).toBe(false);
    expect(parsed?.isZeroToken).toBe(true);
  });

  it('parses completed progress with artifact path and package ID', () => {
    const text = `📦 **[RepoToPackage] Hoàn thành đóng gói thành công! (Zero-Token)**

🎯 Mục tiêu: \`./my-extension\`

- [x] Bước 1/4: Đã tải và quét repository
- [x] Bước 2/4: Phân loại gói: \`agent-plugin\` (extension)
- [x] Bước 3/4: Laya Static Guardrail: **Passed** (Không có mã độc / slopsquatting)
- [x] Bước 4/4: Ký số Ed25519 thành công: \`key_abc123\`

🎉 **Kết quả:** Gói đã được tạo tại:
\`C:/build/my-extension-1.0.0.tomny\` (142 KB)

✅ ID gói: \`com.example.extension\` (v1.0.0)`;

    const parsed = parseStepProgress(text);
    expect(parsed).not.toBeNull();
    expect(parsed?.isComplete).toBe(true);
    expect(parsed?.progressPercent).toBe(100);
    expect(parsed?.artifactPath).toBe('C:/build/my-extension-1.0.0.tomny');
    expect(parsed?.packageId).toBe('com.example.extension');
    expect(parsed?.packageVersion).toBe('1.0.0');
    expect(parsed?.steps.every((s) => s.completed)).toBe(true);
  });

  it('handles Laya Pipeline 4-stage guardrails checklist', () => {
    const text = `🛡️ **Laya Pipeline: Kiểm duyệt & Xác thực**

- [x] Bước 1/4: AST & Symbol Table Matching
- [x] Bước 2/4: Sandboxed Dynamic Testing
- [ ] Bước 3/4: Diff & Regression Guardrail
- [ ] Bước 4/4: Dual-Model Verifier & Automated Rollback`;

    const parsed = parseStepProgress(text);
    expect(parsed).not.toBeNull();
    expect(parsed?.headerTitle).toBe('Laya Pipeline: Kiểm duyệt & Xác thực');
    expect(parsed?.steps.length).toBe(4);
    expect(parsed?.progressPercent).toBe(50);
    expect(parsed?.steps[2].inProgress).toBe(true);
  });
});
