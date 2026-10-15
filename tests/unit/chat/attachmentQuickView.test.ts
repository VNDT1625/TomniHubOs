import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  ATTACHMENT_QUICK_VIEW_METADATA_REASONS,
  type AttachmentQuickView,
  type AttachmentQuickViewMetadataReason,
} from '@/common/chat/attachmentQuickView';

describe('AttachmentQuickView', () => {
  it('defines renderer-safe bounded preview variants in common', () => {
    expect(ATTACHMENT_QUICK_VIEW_METADATA_REASONS).toEqual(['unsupported', 'directory', 'too-large', 'unavailable']);
    expectTypeOf<AttachmentQuickViewMetadataReason>().toEqualTypeOf<
      'unsupported' | 'directory' | 'too-large' | 'unavailable'
    >();
    expectTypeOf<AttachmentQuickView>().toEqualTypeOf<
      | { kind: 'text'; content: string; truncated: boolean }
      | { kind: 'image'; dataUrl: string; width: number; height: number }
      | { kind: 'metadata'; name: string; size: number; reason: AttachmentQuickViewMetadataReason }
    >();
  });
});
