/** @vitest-environment jsdom */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { attachmentReferenceToken, type SemanticAttachmentReference } from '@/common/chat/semanticAttachmentReference';
import SemanticAttachmentEditor from '@/renderer/components/chat/SemanticAttachmentEditor';

const reference: SemanticAttachmentReference = {
  id: 'image-1',
  attachmentKey: '/tmp/before.png',
  label: 'before.png',
  referencePath: '/tmp/before.png',
  source: 'file',
};

describe('SemanticAttachmentEditor', () => {
  it('renders an owned attachment marker as a removable inline file chip', () => {
    render(
      <SemanticAttachmentEditor
        value={`Hãy xem ảnh này ${attachmentReferenceToken(reference.id)}`}
        references={[reference]}
        onValueChange={vi.fn()}
        onCaretChange={vi.fn()}
        onRemoveReference={vi.fn()}
      />
    );

    expect(screen.getByText('Hãy xem ảnh này')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Remove before.png' })).toBeDefined();
  });

  it('forwards hover of an owned token to its quick-view handler', () => {
    const onQuickView = vi.fn();
    render(
      <SemanticAttachmentEditor
        value={`Hãy xem ${attachmentReferenceToken(reference.id)}`}
        references={[reference]}
        onValueChange={vi.fn()}
        onCaretChange={vi.fn()}
        onRemoveReference={vi.fn()}
        onQuickViewReference={onQuickView}
      />
    );

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Remove before.png' }).parentElement!);
    expect(onQuickView).toHaveBeenCalledWith(reference);
  });

  it('does not expose an owned marker token as editable text', () => {
    render(
      <SemanticAttachmentEditor
        value={`Hãy xem ${attachmentReferenceToken(reference.id)}`}
        references={[reference]}
        onValueChange={vi.fn()}
        onCaretChange={vi.fn()}
        onRemoveReference={vi.fn()}
      />
    );

    expect(screen.getByRole('textbox').textContent).not.toContain('[[tomni:attachment:');
  });

  it('restores the supplied semantic caret after a reference is inserted', () => {
    render(
      <SemanticAttachmentEditor
        value={'Before ' + attachmentReferenceToken(reference.id) + ' after'}
        references={[reference]}
        caretOffset={7}
        onValueChange={vi.fn()}
        onCaretChange={vi.fn()}
        onRemoveReference={vi.fn()}
      />
    );

    const selection = window.getSelection();
    expect(selection?.anchorNode).toBe(screen.getByRole('textbox').firstChild);
    expect(selection?.anchorOffset).toBe(7);
  });

    it('treats an owned chip as one Backspace action at the chip end', () => {
    const onValueChange = vi.fn();
    const prefix = 'Read ';
    const value = prefix + attachmentReferenceToken(reference.id);
    render(
      <SemanticAttachmentEditor
        value={value}
        references={[reference]}
        caretOffset={value.length}
        onValueChange={onValueChange}
        onCaretChange={vi.fn()}
        onRemoveReference={vi.fn()}
      />
    );
    const editor = screen.getByRole('textbox');
    expect(fireEvent.keyDown(editor, { key: 'Backspace' })).toBe(false);
    expect(onValueChange).toHaveBeenCalledWith(prefix);
  });

  it('treats an owned chip as one Delete action at the chip start', () => {
    const onValueChange = vi.fn();
    const prefix = 'Read ';
    render(
      <SemanticAttachmentEditor
        value={prefix + attachmentReferenceToken(reference.id) + ' next'}
        references={[reference]}
        caretOffset={prefix.length}
        onValueChange={onValueChange}
        onCaretChange={vi.fn()}
        onRemoveReference={vi.fn()}
      />
    );
    expect(fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Delete' })).toBe(false);
    expect(onValueChange).toHaveBeenCalledWith(prefix + ' next');
  });

  it('does not turn an unowned typed marker into an interactive file chip', () => {
    render(
      <SemanticAttachmentEditor
        value={`Look ${attachmentReferenceToken('unowned')}`}
        references={[reference]}
        onValueChange={vi.fn()}
        onCaretChange={vi.fn()}
        onRemoveReference={vi.fn()}
      />
    );

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('textbox').textContent).toBe(`Look ${attachmentReferenceToken('unowned')}`);
  });
});
