/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { createViuImeDraftController } from '@/common/viu/authoring';

describe('VIU IME-safe text composition', () => {
  it('holds Vietnamese composition until one explicit editing-session commit', () => {
    const controller = createViuImeDraftController('Title');
    const vietnamese = 'Ti\u1ebfng Vi\u1ec7t ho\u00e0n ch\u1ec9nh';

    controller.compositionStart();
    controller.change('Tie');
    expect(controller.commit()).toBeNull();
    controller.compositionEnd(vietnamese);

    expect(controller.commit()).toBe(vietnamese);
    expect(controller.commit()).toBeNull();
  });

  it('does not let an external refresh clobber active CJK composition', () => {
    const controller = createViuImeDraftController('Original');
    const cjk = '\u8a2d\u8a08\u7a3f';

    controller.compositionStart();
    controller.change(cjk);
    controller.syncExternal('Remote refresh');

    expect(controller.snapshot().draft).toBe(cjk);
    controller.compositionEnd(cjk);
    expect(controller.commit()).toBe(cjk);
  });

  it('cancels a draft without producing a commit', () => {
    const controller = createViuImeDraftController('Stable');
    controller.change('Discard me');

    expect(controller.cancel()).toMatchObject({ draft: 'Stable', dirty: false, composing: false });
    expect(controller.commit()).toBeNull();
  });
});
