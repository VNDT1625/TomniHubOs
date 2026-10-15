import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachmentReferenceToken, type SemanticAttachmentReference } from '@/common/chat/semanticAttachmentReference';
import { useGuidSend, type GuidSendDeps } from '@/renderer/pages/guid/hooks/useGuidSend';

const calls = vi.hoisted(() => ({
  create: vi.fn(),
  get: vi.fn(),
  send: vi.fn(),
  navigate: vi.fn(),
  emit: vi.fn(),
  workspace: vi.fn(),
  display: vi.fn(
    (input: string, files: string[], workspace: string) => `display:${input}|${files.join(',')}|${workspace}`
  ),
  language: vi.fn((input: string) => `language:${input}`),
  info: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));
vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: { create: { invoke: calls.create }, get: { invoke: calls.get }, sendMessage: { invoke: calls.send } },
  },
}));
vi.mock('@/renderer/utils/emitter', () => ({ emitter: { emit: calls.emit } }));
vi.mock('@/renderer/utils/file/messageFiles', () => ({ buildDisplayMessage: calls.display }));
vi.mock('@/renderer/services/i18n/responseLanguage', () => ({ withResponseLanguageDirective: calls.language }));
vi.mock('@/renderer/utils/workspace/workspaceHistory', () => ({ updateWorkspaceTime: calls.workspace }));
vi.mock('@/renderer/hooks/mcp/catalog', () => ({ toSessionMcpServer: vi.fn() }));
vi.mock('@/renderer/pages/conversation/hooks/superGuidance', () => ({
  BROWSER_CONTROL_MCP_NAME: 'Browser Control',
  withSuperBrowserRules: (rules: string) => rules,
  withIdeMemoryRules: (_id: string, rules: string) => rules,
}));
vi.mock('@/renderer/components/Spotlight/spotlightBus', () => ({ runGuideCommand: () => ({ handled: false }) }));
vi.mock('@/renderer/pages/cron/scheduleDraft', () => ({ runScheduleCommand: () => false }));
vi.mock('@/renderer/services/personalMemoryCommand', () => ({ handlePersonalMemoryCommand: () => false }));
vi.mock('@arco-design/web-react', () => ({
  Message: { info: calls.info, error: calls.error, warning: calls.warning },
}));

const cases = [
  { backend: 'tomny', type: 'tomnyagentic', prefix: 'tomnyagentic' },
  { backend: 'claude', type: 'acp', prefix: 'acp' },
  { backend: 'openclaw-gateway', type: 'openclaw-gateway', prefix: 'openclaw' },
  { backend: 'nanobot', type: 'nanobot', prefix: 'nanobot' },
] as const;

const setup = (
  backend: string,
  preset = false,
  continueConversationId?: string,
  semanticReferences: SemanticAttachmentReference[] = []
) => {
  const view = renderHook(() => {
    const [input, setInput] = useState('Read report');
    const [files, setFiles] = useState(['report.pdf']);
    const [workspaceReferences, setWorkspaceReferences] = useState([{ relativePath: 'docs', kind: 'folder' as const }]);
    const [dir, setDir] = useState('C:/Work/Project');
    const [loading, setLoading] = useState(false);
    const agentInfo = {
      agent_type: backend === 'claude' ? 'acp' : backend,
      backend,
      name: backend,
      ...(preset ? { custom_agent_id: 'preset-1', is_preset: true } : {}),
    };
    const effective = { agent_type: backend, isFallback: false, originalType: backend, isAvailable: true };
    const deps: GuidSendDeps = {
      input,
      setInput,
      files,
      setFiles,
      attachmentReferences: semanticReferences,
      workspaceReferences,
      setWorkspaceReferences,
      dir,
      setDir,
      loading,
      setLoading,
      selectedAgent: backend,
      selectedAgentKey: backend,
      selectedAgentInfo: agentInfo,
      is_presetAgent: preset,
      selectedMode: 'agent',
      selectedAcpModel: null,
      currentAcpCachedModelInfo: null,
      current_model: {
        id: 'provider',
        platform: 'openai',
        name: 'Provider',
        base_url: '',
        api_key: '',
        use_model: 'model',
      },
      findAgentByKey: () => agentInfo,
      getEffectiveAgentType: () => effective,
      resolvePresetRulesAndSkills: async () => ({}),
      resolveEnabledSkills: () => undefined,
      resolveDisabledBuiltinSkills: () => undefined,
      guidDisabledBuiltinSkills: undefined,
      guidEnabledSkills: undefined,
      availableMcpServers: [],
      selectedMcpServerIds: [],
      currentEffectiveAgentInfo: effective,
      isGoogleAuth: false,
      setMentionOpen: vi.fn(),
      setMentionQuery: vi.fn(),
      setMentionSelectorOpen: vi.fn(),
      setMentionActiveIndex: vi.fn(),
      navigate: calls.navigate,
      continueConversationId,
      t: ((key: string) => key) as GuidSendDeps['t'],
    };
    const send = useGuidSend(deps);
    return { ...send, input, files, dir, loading, setInput, setFiles, setDir };
  });
  return view;
};
const dispatch = (view: ReturnType<typeof setup>) => {
  act(() => view.result.current.sendMessageHandler());
};
const settled = async (view: ReturnType<typeof setup>) => {
  await waitFor(() => expect(view.result.current.loading).toBe(false));
};

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  calls.get.mockResolvedValue(undefined);
  calls.create.mockImplementation(async (params: { type: string; extra: Record<string, unknown> }) => ({
    ...params,
    id: 'conversation-1',
    extra: { ...params.extra, workspace: 'C:/Work/Project' },
  }));
  calls.send.mockResolvedValue({ msg_id: 'message-1' });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(window, 'alert').mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Home native send without leaving the live grid', () => {
  it.each(cases)(
    'creates and natively starts $backend, without navigation or initial-message storage',
    async ({ backend, type }) => {
      const view = setup(backend);
      dispatch(view);
      await settled(view);
      expect(calls.create).toHaveBeenCalledOnce();
      expect(calls.create.mock.calls[0][0]).toMatchObject({
        type,
        name: 'Read report',
        extra: { workspace: 'C:/Work/Project' },
      });
      expect(calls.send).toHaveBeenCalledOnce();
      expect(calls.send).toHaveBeenCalledWith(
        expect.objectContaining({
          conversation_id: 'conversation-1',
          input: 'display:Read report|report.pdf|C:/Work/Project',
          model_input: 'language:display:Read report|report.pdf|C:/Work/Project',
          files: ['report.pdf'],
          workspace_references: [{ relativePath: 'docs', kind: 'folder' }],
        })
      );
      expect(calls.navigate).not.toHaveBeenCalled();
      expect(sessionStorage.length).toBe(0);
      expect(view.result.current.input).toBe('');
      expect(view.result.current.files).toEqual([]);
      expect(view.result.current.dir).toBe('C:/Work/Project');
    }
  );

  it('treats a native file-import token as a sendable draft', async () => {
    const reference: SemanticAttachmentReference = {
      id: 'imported-file',
      attachmentKey: 'C:/Users/me/Downloads/imported.txt',
      label: 'imported.txt',
      referencePath: 'C:/Users/me/Downloads/imported.txt',
      source: 'file',
    };
    const view = setup('tomny', false, undefined, [reference]);

    act(() => {
      view.result.current.setFiles([reference.attachmentKey]);
      view.result.current.setInput(attachmentReferenceToken(reference.id));
    });

    expect(view.result.current.isButtonDisabled).toBe(false);
    dispatch(view);
    await settled(view);

    expect(calls.send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: 'display:[imported.txt]|C:/Users/me/Downloads/imported.txt|C:/Work/Project',
        model_input:
          'language:display:[File reference: C:/Users/me/Downloads/imported.txt]|C:/Users/me/Downloads/imported.txt|C:/Work/Project',
        files: [reference.attachmentKey],
      })
    );
  });

  it('serializes semantic file references at their exact model-text position', async () => {
    const reference: SemanticAttachmentReference = {
      id: 'report-file',
      attachmentKey: 'report.pdf',
      label: 'report.pdf',
      referencePath: 'C:/Work/Project/report.pdf',
      source: 'file',
    };
    const view = setup('tomny', false, undefined, [reference]);
    act(() => view.result.current.setInput(`Read ${attachmentReferenceToken(reference.id)} now`));

    dispatch(view);
    await settled(view);

    expect(calls.display).toHaveBeenCalledWith('Read [report.pdf] now', ['report.pdf'], 'C:/Work/Project');
    expect(calls.language).toHaveBeenCalledWith(
      'display:Read [File reference: C:/Work/Project/report.pdf] now|report.pdf|C:/Work/Project',
      'conversation-1'
    );
  });

  it('keeps human-readable semantic references in a preset navigation handoff', async () => {
    const reference: SemanticAttachmentReference = {
      id: 'report-file',
      attachmentKey: 'report.pdf',
      label: 'report.pdf',
      referencePath: 'C:/Work/Project/report.pdf',
      source: 'file',
    };
    const view = setup('tomny', true, undefined, [reference]);
    act(() => view.result.current.setInput(`Read ${attachmentReferenceToken(reference.id)} now`));

    dispatch(view);
    await settled(view);

    expect(JSON.parse(sessionStorage.getItem('tomnyagentic_initial_message_conversation-1') ?? '{}')).toMatchObject({
      input: 'Read [report.pdf] now',
    });
  });

  it.each(cases)('retains the legacy preset navigation handoff for $backend', async ({ backend, prefix }) => {
    const view = setup(backend, true);
    dispatch(view);
    await settled(view);
    expect(calls.create).toHaveBeenCalledOnce();
    expect(calls.send).not.toHaveBeenCalled();
    expect(calls.navigate).toHaveBeenCalledWith('/conversation/conversation-1');
    expect(JSON.parse(sessionStorage.getItem(`${prefix}_initial_message_conversation-1`) ?? '{}')).toEqual({
      input: 'Read report',
      files: ['report.pdf'],
      workspace_references: [{ relativePath: 'docs', kind: 'folder' }],
    });
  });

  it('retains the conversation-page handoff for Tomny /goal controls', async () => {
    const view = setup('tomny');
    act(() => view.result.current.setInput('/goal Finish the release'));
    dispatch(view);
    await settled(view);
    expect(calls.send).not.toHaveBeenCalled();
    expect(calls.navigate).toHaveBeenCalledWith('/conversation/conversation-1');
    expect(JSON.parse(sessionStorage.getItem('tomnyagentic_initial_message_conversation-1') ?? '{}')).toEqual({
      input: '/goal Finish the release',
      files: ['report.pdf'],
      workspace_references: [{ relativePath: 'docs', kind: 'folder' }],
    });
  });

  it('locks duplicate sendMessageHandler calls in the same tick until native acceptance', async () => {
    let finish!: (value: { msg_id: string }) => void;
    calls.send.mockReturnValue(
      new Promise<{ msg_id: string }>((resolve) => {
        finish = resolve;
      })
    );
    const view = setup('tomny');
    act(() => {
      view.result.current.sendMessageHandler();
      view.result.current.sendMessageHandler();
    });
    await waitFor(() => expect(calls.send).toHaveBeenCalledOnce());
    expect(calls.create).toHaveBeenCalledOnce();
    expect(view.result.current.loading).toBe(true);
    dispatch(view);
    expect(calls.create).toHaveBeenCalledOnce();
    await act(async () => finish({ msg_id: 'accepted' }));
    await settled(view);
  });

  it.each(cases)('retains the draft and attachments when native $backend send fails', async ({ backend }) => {
    calls.send.mockRejectedValue(new Error('Native bridge unavailable'));
    const view = setup(backend);
    dispatch(view);
    await settled(view);
    expect(view.result.current.input).toBe('Read report');
    expect(view.result.current.files).toEqual(['report.pdf']);
    expect(view.result.current.dir).toBe('C:/Work/Project');
    expect(calls.navigate).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  });

  it.each(cases)('preserves the draft when $backend creation returns no valid conversation', async ({ backend }) => {
    calls.create.mockResolvedValue(undefined);
    const view = setup(backend);
    dispatch(view);
    await settled(view);
    expect(calls.send).not.toHaveBeenCalled();
    expect(calls.navigate).not.toHaveBeenCalled();
    expect(view.result.current.input).toBe('Read report');
    expect(view.result.current.files).toEqual(['report.pdf']);
    expect(view.result.current.dir).toBe('C:/Work/Project');
  });

  it('does not treat an empty native receipt as success', async () => {
    calls.send.mockResolvedValue({ msg_id: '' });
    const view = setup('tomny');
    dispatch(view);
    await settled(view);
    expect(view.result.current.input).toBe('Read report');
    expect(view.result.current.files).toEqual(['report.pdf']);
  });

  it('clears only the captured draft and attachments while retaining new text, files and workspace', async () => {
    let finish!: (value: { msg_id: string }) => void;
    calls.send.mockReturnValue(
      new Promise<{ msg_id: string }>((resolve) => {
        finish = resolve;
      })
    );
    const view = setup('tomny');
    dispatch(view);
    await waitFor(() => expect(calls.send).toHaveBeenCalledOnce());
    act(() => {
      view.result.current.setInput('Next task already typed');
      view.result.current.setFiles(['report.pdf', 'next.csv']);
      view.result.current.setDir('C:/Work/Next');
    });
    await act(async () => finish({ msg_id: 'accepted' }));
    await settled(view);
    expect(view.result.current.input).toBe('Next task already typed');
    expect(view.result.current.files).toEqual(['next.csv']);
    expect(view.result.current.dir).toBe('C:/Work/Next');
    expect(calls.send.mock.calls[0][0]).toMatchObject({ files: ['report.pdf'] });
  });

  it('continues the selected agent conversation instead of minting a new tile', async () => {
    calls.get.mockResolvedValue({
      id: 'agent-conversation-7',
      type: 'tomnyagentic',
      extra: { workspace: 'C:/Work/AgentFolder' },
    });
    const view = setup('tomny', false, 'agent-conversation-7');
    dispatch(view);
    await settled(view);
    expect(calls.create).not.toHaveBeenCalled();
    expect(calls.get).toHaveBeenCalledWith({ id: 'agent-conversation-7' });
    expect(calls.send).toHaveBeenCalledOnce();
    expect(calls.send).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: 'agent-conversation-7',
        input: 'display:Read report|report.pdf|C:/Work/AgentFolder',
        model_input: 'language:display:Read report|report.pdf|C:/Work/AgentFolder',
        files: ['report.pdf'],
      })
    );
    expect(calls.navigate).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
    expect(view.result.current.input).toBe('');
    expect(view.result.current.files).toEqual([]);
    expect(view.result.current.dir).toBe('C:/Work/Project');
    expect(calls.emit).toHaveBeenCalledWith('chat.history.refresh');
  });

  it('falls back to creating a conversation when the selected one no longer exists', async () => {
    calls.get.mockResolvedValue(undefined);
    const view = setup('tomny', false, 'agent-conversation-gone');
    dispatch(view);
    await settled(view);
    expect(calls.create).toHaveBeenCalledOnce();
    expect(calls.send).toHaveBeenCalledOnce();
    expect(calls.send.mock.calls[0][0]).toMatchObject({ conversation_id: 'conversation-1' });
  });

  it('retains the draft when continuation into the selected conversation fails', async () => {
    calls.get.mockResolvedValue({ id: 'agent-conversation-7', type: 'tomnyagentic', extra: {} });
    calls.send.mockResolvedValue({ msg_id: '' });
    const view = setup('tomny', false, 'agent-conversation-7');
    dispatch(view);
    await settled(view);
    expect(calls.create).not.toHaveBeenCalled();
    expect(view.result.current.input).toBe('Read report');
    expect(view.result.current.files).toEqual(['report.pdf']);
  });
});
