import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'common.remove': 'Remove',
        'common.file': 'file',
        'common.folder': 'folder',
      })[key] ?? key,
  }),
}));
vi.mock('@/renderer/components/media/UploadProgressBar', () => ({ default: () => null }));
vi.mock('@/renderer/pages/guid/components/GuidWorkspaceFootnote', () => ({ default: () => null }));

import GuidInputCard from '@/renderer/pages/guid/components/GuidInputCard';

const Harness: React.FC<{ onKeyDown: () => void }> = ({ onKeyDown }) => {
  const [input, setInput] = useState('');
  return (
    <GuidInputCard
      variant='hub'
      input={input}
      onInputChange={setInput}
      onAttachmentCaretChange={() => undefined}
      onRemoveAttachmentReference={() => undefined}
      onKeyDown={onKeyDown}
      onPaste={() => undefined}
      onFocus={() => undefined}
      onBlur={() => undefined}
      placeholder='ask'
      isInputActive
      isFileDragging={false}
      activeBorderColor='red'
      inactiveBorderColor='grey'
      activeShadow='none'
      dragHandlers={{}}
      mentionOpen={false}
      mentionSelectorBadge={null}
      mentionDropdown={null}
      files={[]}
      attachmentReferences={[]}
      onRemoveFile={() => undefined}
      actionRow={null}
      workspaceDir=''
      onSelectWorkspace={() => undefined}
      onClearWorkspace={() => undefined}
    />
  );
};

describe('home chat input command palette', () => {
  it('suggests commands when the user types a slash, and inserts the chosen one without sending', async () => {
    const user = userEvent.setup();
    const onKeyDown = vi.fn();
    render(<Harness onKeyDown={onKeyDown} />);
    const box = screen.getByTestId('guid-input');

    await user.click(box);
    await user.type(box, '/repo');
    expect(screen.getByText('/repotopackage')).toBeTruthy();
    expect(screen.getByText('/repotopackage').closest('div.absolute')?.className).toContain('bottom-[calc(100%+8px)]');
    onKeyDown.mockClear();

    await user.keyboard('{Enter}');
    expect(box.textContent).toBe('/repotopackage ');
    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it('suggests pipelines for * and stays closed for ordinary text', async () => {
    const user = userEvent.setup();
    render(<Harness onKeyDown={() => undefined} />);
    const box = screen.getByTestId('guid-input');

    await user.click(box);
    await user.type(box, 'hello');
    expect(screen.queryByText('Slash Commands & Modes')).toBeNull();

    await user.clear(box);
    await user.type(box, '*');
    expect(screen.getByText('*slide-deck')).toBeTruthy();
  });

  it('does not forward Enter while an IME composition is active', () => {
    const onKeyDown = vi.fn();
    render(<Harness onKeyDown={onKeyDown} />);
    const box = screen.getByTestId('guid-input');

    fireEvent.compositionStart(box);
    fireEvent.keyDown(box, { key: 'Enter' });
    fireEvent.compositionEnd(box);

    expect(onKeyDown).not.toHaveBeenCalled();
  });

});
