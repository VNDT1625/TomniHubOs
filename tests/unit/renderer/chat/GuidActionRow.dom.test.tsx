import { ConfigProvider } from '@arco-design/web-react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import GuidActionRow from '@/renderer/pages/guid/components/GuidActionRow';

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: () => false,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const renderActionRow = (agentSwitcherItems: React.ComponentProps<typeof GuidActionRow>['agentSwitcherItems']) => {
  const onAgentSwitch = vi.fn();
  render(
    <ConfigProvider>
      <GuidActionRow
        variant='hub'
        files={[]}
        onFilesUploaded={vi.fn()}
        modelSelectorNode={null}
        selectedAgent='tomnyagentic'
        selectedMode='default'
        onModeSelect={vi.fn()}
        is_presetAgent={false}
        selectedAgentInfo={undefined}
        assistants={[]}
        localeKey='en-US'
        onClosePresetTag={vi.fn()}
        agentSwitcherItems={agentSwitcherItems}
        onAgentSwitch={onAgentSwitch}
        allSkills={[]}
        disabledBuiltinSkills={[]}
        enabledSkills={[]}
        onToggleSkill={vi.fn()}
        mcpServers={[]}
        selectedMcpServerIds={[]}
        onToggleMcpServer={vi.fn()}
        loading={false}
        isButtonDisabled={false}
        onSend={vi.fn()}
      />
    </ConfigProvider>
  );
  return onAgentSwitch;
};

afterEach(cleanup);

describe('GuidActionRow CLI agent selector', () => {
  it('switches the active CLI agent from the Hub composer', async () => {
    const onAgentSwitch = renderActionRow([
      { key: 'tomnyagentic', label: 'Tomny', isCurrent: true },
      { key: 'claude', label: 'Claude', isCurrent: false },
    ]);

    fireEvent.click(screen.getByText('Tomny').closest('button')!);
    fireEvent.click(await screen.findByText('Claude'));

    expect(onAgentSwitch.mock.calls[0]?.[0]).toBe('claude');
  });

  it('provides a stable DOM tooltip target for the composite agent selector', () => {
    renderActionRow([{ key: 'tomnyagentic', label: 'Tomny', isCurrent: true }]);

    const agentButton = screen.getByRole('button', { name: 'guid.agentSwitcherLabel' });

    expect(agentButton.closest('[data-agent-switcher-tooltip-target]')).toBeInstanceOf(HTMLElement);
  });

  it('does not render an empty selector when no CLI agent is available', () => {
    renderActionRow([]);

    expect(screen.queryByText('Tomny')).not.toBeInTheDocument();
  });
});
