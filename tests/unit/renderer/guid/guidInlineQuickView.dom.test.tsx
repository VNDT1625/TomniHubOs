import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { attachmentReferenceToken, type SemanticAttachmentReference } from '@/common/chat/semanticAttachmentReference';
import GuidInputCard from '@/renderer/pages/guid/components/GuidInputCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { label?: string }) => {
      const translations: Record<string, string> = {
        'common.remove': 'Remove',
        'common.file': 'file',
        'common.folder': 'folder',
        'common.attachmentQuickView.label': 'Quick view for ' + values?.label,
        'common.attachmentQuickView.loading': 'Loading preview…',
        'common.attachmentQuickView.unsupported': 'This file type cannot be previewed here.',
        'common.attachmentQuickView.directory': 'Folders cannot be previewed here.',
        'common.attachmentQuickView.too-large': 'This file is too large for a quick view.',
        'common.attachmentQuickView.unavailable': 'This file is no longer available.',
      };
      return translations[key] ?? key;
    },
  }),
}));
vi.mock('@/renderer/components/media/UploadProgressBar', () => ({ default: () => null }));
vi.mock('@/renderer/pages/guid/components/GuidWorkspaceFootnote', () => ({ default: () => null }));

const reference: SemanticAttachmentReference = {
  id: 'notes-file',
  attachmentKey: '/tmp/notes.txt',
  label: 'notes.txt',
  referencePath: '/tmp/notes.txt',
  source: 'file',
};

const renderCard = () =>
  render(
    <GuidInputCard
      variant='hub'
      input={`Review ${attachmentReferenceToken(reference.id)}`}
      onInputChange={vi.fn()}
      onAttachmentCaretChange={vi.fn()}
      onRemoveAttachmentReference={vi.fn()}
      onKeyDown={vi.fn()}
      onPaste={vi.fn()}
      onFocus={vi.fn()}
      onBlur={vi.fn()}
      placeholder='Ask'
      isInputActive={false}
      isFileDragging={false}
      activeBorderColor='red'
      inactiveBorderColor='grey'
      activeShadow='none'
      dragHandlers={{}}
      mentionOpen={false}
      mentionSelectorBadge={null}
      mentionDropdown={null}
      files={['/tmp/notes.txt']}
      attachmentReferences={[reference]}
      quickViews={{
        '/tmp/notes.txt': async () => ({ kind: 'text', content: 'safe inline excerpt', truncated: false }),
      }}
      onRemoveFile={vi.fn()}
      actionRow={null}
      workspaceDir=''
      onSelectWorkspace={vi.fn()}
      onClearWorkspace={vi.fn()}
    />
  );

describe('GuidInputCard inline attachment quick view', () => {
    it('closes an inline preview when the token disappears or inventory takes focus', async () => {
    const view = renderCard();
    fireEvent.mouseOver(screen.getByRole('button', { name: 'Remove notes.txt' }).parentElement!);
    expect(await screen.findByText('safe inline excerpt')).toBeDefined();
    fireEvent(window, new CustomEvent('tomni:attachment-preview-open', { detail: 'inventory' }));
    expect(screen.queryByText('safe inline excerpt')).toBeNull();
    fireEvent.mouseOver(screen.getByRole('button', { name: 'Remove notes.txt' }).parentElement!);
    expect(await screen.findByText('safe inline excerpt')).toBeDefined();
    view.rerender(
      <GuidInputCard variant='hub' input='Review ' onInputChange={vi.fn()} onAttachmentCaretChange={vi.fn()}
        onRemoveAttachmentReference={vi.fn()} onKeyDown={vi.fn()} onPaste={vi.fn()}
        onFocus={vi.fn()} onBlur={vi.fn()} placeholder='Ask'
        isInputActive={false} isFileDragging={false} activeBorderColor='red'
        inactiveBorderColor='grey' activeShadow='none' dragHandlers={{}}
        mentionOpen={false} mentionSelectorBadge={null} mentionDropdown={null}
        attachmentReferences={[]} quickViews={{}}
        actionRow={null} workspaceDir='' onSelectWorkspace={vi.fn()} onClearWorkspace={vi.fn()} />
    );
    expect(screen.queryByText('safe inline excerpt')).toBeNull();
  });

  it('shows the Main-bounded quick view when hovering a semantic inline token', async () => {
    renderCard();

    fireEvent.mouseOver(screen.getByRole('button', { name: 'Remove notes.txt' }).parentElement!);

    expect(await screen.findByText('safe inline excerpt')).toBeDefined();
    expect(screen.getByRole('status', { name: 'Quick view for notes.txt' })).toBeDefined();
  });
});
