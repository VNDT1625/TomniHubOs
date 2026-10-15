/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  attachmentReferenceToken,
  insertAttachmentReference,
  removeAttachmentReference,
  serializeAttachmentReferences,
  type SemanticAttachmentReference,
} from '@/common/chat/semanticAttachmentReference';

const imageReference: SemanticAttachmentReference = {
  id: 'ref-image',
  attachmentKey: 'C:/workspace/assets/before image.png',
  label: 'before image.png',
  referencePath: 'assets/before image.png',
  source: 'file',
};

const documentReference: SemanticAttachmentReference = {
  id: 'ref-document',
  attachmentKey: 'docs/report.json',
  label: 'report.json',
  referencePath: 'docs/report.json',
  source: 'workspace',
};

describe('semantic attachment references', () => {
  it('inserts a stable reference token at the requested caret position', () => {
    const value = 'Hãy xem ảnh này rồi so sánh.';
    const caret = value.indexOf('rồi');
    const result = insertAttachmentReference(value, caret, imageReference);

    expect(result.value).toBe(`Hãy xem ảnh này ${attachmentReferenceToken(imageReference.id)}rồi so sánh.`);
    expect(result.caret).toBe(caret + attachmentReferenceToken(imageReference.id).length);
  });

  it('serializes each inline token to its referenced path at its semantic position', () => {
    const value = `Hãy xem ảnh này ${attachmentReferenceToken(imageReference.id)}, rồi so file này ${attachmentReferenceToken(documentReference.id)}.`;

    expect(serializeAttachmentReferences(value, [imageReference, documentReference], 'model')).toBe(
      'Hãy xem ảnh này [File reference: assets/before image.png], rồi so file này [File reference: docs/report.json].'
    );
    expect(serializeAttachmentReferences(value, [imageReference, documentReference], 'display')).toBe(
      'Hãy xem ảnh này [before image.png], rồi so file này [report.json].'
    );
  });

  it('removes only one inline occurrence without removing the attachment identity', () => {
    const value = `${attachmentReferenceToken(imageReference.id)} and ${attachmentReferenceToken(imageReference.id)}`;

    expect(removeAttachmentReference(value, imageReference.id)).toBe(
      ` and ${attachmentReferenceToken(imageReference.id)}`
    );
  });

  it('keeps unknown typed marker text literal instead of treating it as authorized file access', () => {
    const unknown = attachmentReferenceToken('not-an-owned-reference');

    expect(serializeAttachmentReferences(`Look ${unknown}`, [imageReference], 'model')).toBe(`Look ${unknown}`);
  });
});
