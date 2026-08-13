/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ConfigProvider, Message } from '@arco-design/web-react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPremiumStarterProject, type ViuProjectState, type ViuTransactionResult } from '@/common/viu';
import type { ViuLocalAssetRef } from '@/renderer/pages/studio/ide/Viu/viuClient';

type CanvasProps = {
  labels: {
    componentLibrary: {
      variants: (count: number) => string;
      properties: (count: number) => string;
      targetScreen: (name: string) => string;
    };
  };
  project: ViuProjectState;
  localAssets: ViuLocalAssetRef[];
  onLinkAsset: () => void;
  onPublishPreview: () => void;
  onCopyPreviewReference: () => void;
  onProjectChange: (project: ViuProjectState, result: ViuTransactionResult) => void;
  onAgentRequest?: (request: string) => void;
};

const mocks = vi.hoisted(() => ({
  canvasProps: undefined as unknown,
  inspectV2: vi.fn(),
  listAssets: vi.fn(),
  grantAsset: vi.fn(),
  commitV2: vi.fn(),
  publishPreview: vi.fn(),
  copyText: vi.fn(),
  showOpen: vi.fn(),
  layoutContext: null as null | { siderCollapsed: boolean; setSiderCollapsed: ReturnType<typeof vi.fn> },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/common', () => ({
  ipcBridge: { dialog: { showOpen: { invoke: mocks.showOpen } } },
}));

vi.mock('@renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => mocks.layoutContext,
}));

vi.mock('@/renderer/pages/studio/ide/Viu/next/ViuNextCanvas', () => ({
  default: (props: unknown) => {
    mocks.canvasProps = props;
    return null;
  },
}));

vi.mock('@/renderer/pages/studio/ide/Viu/viuClient', () => ({
  viuClient: {
    inspectV2: mocks.inspectV2,
    listAssets: mocks.listAssets,
    grantAsset: mocks.grantAsset,
    commitV2: mocks.commitV2,
  },
}));

vi.mock('@/renderer/pages/studio/ide/teamEdit/teamEditClient', () => ({
  teamEditClient: { publishPreview: mocks.publishPreview },
  createViuLocalTestReference: (packageId: string) => `viu-preview://team-test/${packageId}`,
}));

vi.mock('@/renderer/utils/ui/clipboard', () => ({
  copyText: mocks.copyText,
}));

import ViuPanel from '@/renderer/pages/studio/ide/Viu';

const ROOT = 'C:\\repo';
const ASSET: ViuLocalAssetRef = {
  id: 'asset-hero',
  protocolUrl: 'viu-asset://asset-hero',
  displayName: 'Hero.PNG',
  extension: 'png',
  mimeType: 'image/png',
  kind: 'image',
  sizeBytes: 1024,
  modifiedAtMs: 123,
  metadataSha256: 'hash',
  missing: false,
};

const transactionResult = (state: ViuProjectState): ViuTransactionResult => ({
  accepted: true,
  state,
  revision: state.revision,
  normalizedCommands: [],
  inverseCommands: [],
  diagnostics: [],
  changedNodeIds: [],
});

const renderPanel = (rootPath: string | null = ROOT) => {
  const onStartAgent = vi.fn();
  const rendered = render(
    <ConfigProvider>
      <ViuPanel rootPath={rootPath} onRequestWorkspace={vi.fn()} onStartAgent={onStartAgent} />
    </ConfigProvider>
  );
  return { ...rendered, onStartAgent };
};

const getCanvas = async (): Promise<CanvasProps> => {
  await waitFor(() => expect(mocks.canvasProps).toBeTruthy());
  return mocks.canvasProps as CanvasProps;
};

beforeEach(() => {
  const project = createPremiumStarterProject('panel-callbacks');
  mocks.canvasProps = undefined;
  mocks.layoutContext = null;
  mocks.inspectV2.mockReset().mockResolvedValue({ ok: true, data: project });
  mocks.listAssets.mockReset().mockResolvedValue({ ok: true, data: [] });
  mocks.grantAsset.mockReset();
  mocks.commitV2.mockReset();
  mocks.publishPreview.mockReset().mockResolvedValue({ ok: true, data: { packageId: 'preview-package' } });
  mocks.copyText.mockReset().mockResolvedValue(undefined);
  mocks.showOpen.mockReset().mockResolvedValue(undefined);
  vi.spyOn(Message, 'success').mockImplementation(() => undefined as never);
  vi.spyOn(Message, 'error').mockImplementation(() => undefined as never);
  vi.spyOn(Message, 'info').mockImplementation(() => undefined as never);
  vi.stubGlobal('crypto', { randomUUID: () => 'callback-id' });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ViuPanel callback integration', () => {
  it('filters cancelled and unsupported asset choices, then links a supported local asset', async () => {
    renderPanel();
    let canvas = await getCanvas();

    act(() => canvas.onLinkAsset());
    await waitFor(() => expect(mocks.showOpen).toHaveBeenCalledOnce());
    expect(mocks.grantAsset).not.toHaveBeenCalled();

    mocks.showOpen.mockResolvedValueOnce(['C:\\assets\\notes.txt']);
    act(() => canvas.onLinkAsset());
    await waitFor(() => expect(mocks.showOpen).toHaveBeenCalledTimes(2));
    expect(mocks.grantAsset).not.toHaveBeenCalled();

    mocks.showOpen.mockResolvedValueOnce(['C:\\assets\\Hero.PNG']);
    mocks.grantAsset.mockResolvedValueOnce({ ok: true, data: ASSET });
    act(() => canvas.onLinkAsset());

    await waitFor(() =>
      expect(mocks.grantAsset).toHaveBeenCalledWith({
        workspaceKey: `repo:${ROOT}`,
        path: 'C:\\assets\\Hero.PNG',
        grantPath: 'C:\\assets\\Hero.PNG',
        mimeType: 'image/png',
      })
    );
    canvas = await getCanvas();
    await waitFor(() => expect(canvas.localAssets).toEqual([ASSET]));
  });

  it('serializes canvas transactions and reconciles a rejected commit with server state', async () => {
    renderPanel();
    const canvas = await getCanvas();
    const optimistic = { ...canvas.project, revision: canvas.project.revision + 1 };
    const server = { ...canvas.project, title: 'Server-authoritative project', revision: canvas.project.revision + 2 };
    mocks.commitV2.mockResolvedValueOnce({
      ok: true,
      data: { ...transactionResult(server), accepted: false },
    });

    act(() => canvas.onProjectChange(optimistic, transactionResult(optimistic)));

    await waitFor(() => expect(mocks.commitV2).toHaveBeenCalledOnce());
    await waitFor(() => expect((mocks.canvasProps as CanvasProps).project).toEqual(server));
    expect(mocks.commitV2.mock.calls[0]?.[0].transaction).toEqual(
      expect.objectContaining({
        documentId: optimistic.projectId,
        baseRevision: optimistic.revision - 1,
        actor: { id: 'viu-editor-user', kind: 'user' },
        origin: 'canvas',
        mode: 'commit',
      })
    );
  });

  it('forwards an agent request with a bounded VIU-only instruction', async () => {
    const { onStartAgent } = renderPanel();
    const canvas = await getCanvas();

    act(() => canvas.onAgentRequest?.('Refine the pricing hierarchy'));

    expect(onStartAgent).toHaveBeenCalledWith(expect.stringContaining('Do not generate application code yet'));
    expect(onStartAgent).toHaveBeenCalledWith(expect.stringContaining('Refine the pricing hierarchy'));
    expect(onStartAgent).toHaveBeenCalledWith(expect.stringContaining(JSON.stringify(`repo:${ROOT}`)));
  });

  it('reports unavailable publication and ignores copy before a reference exists', async () => {
    renderPanel(null);
    const canvas = await getCanvas();

    act(() => canvas.onCopyPreviewReference());
    act(() => canvas.onPublishPreview());

    expect(mocks.copyText).not.toHaveBeenCalled();
    expect(Message.info).toHaveBeenCalledWith('ide.viu.next.teamPreview.unavailable');
    expect(mocks.publishPreview).not.toHaveBeenCalled();
    expect(canvas.onAgentRequest).toBeUndefined();
  });

  it('rejects publication when the project has no valid start screen', async () => {
    const project = createPremiumStarterProject('panel-empty-flow');
    project.screenOrder = [];
    mocks.inspectV2.mockResolvedValueOnce({ ok: true, data: project });
    renderPanel();
    const canvas = await getCanvas();

    act(() => canvas.onPublishPreview());

    await waitFor(() => expect(Message.error).toHaveBeenCalledWith('ide.viu.next.teamPreview.error'));
    expect(mocks.publishPreview).not.toHaveBeenCalled();
  });

  it('surfaces both structured and thrown Team publication failures', async () => {
    renderPanel();
    let canvas = await getCanvas();
    mocks.publishPreview.mockResolvedValueOnce({ ok: false, error: 'Team service unavailable' });

    act(() => canvas.onPublishPreview());
    await waitFor(() => expect(Message.error).toHaveBeenCalledWith('Team service unavailable'));

    mocks.publishPreview.mockRejectedValueOnce(new Error('transport failed'));
    canvas = await getCanvas();
    act(() => canvas.onPublishPreview());
    await waitFor(() => expect(Message.error).toHaveBeenCalledWith('ide.viu.next.teamPreview.error'));
    expect(mocks.publishPreview).toHaveBeenCalledTimes(2);
  });

  it('evaluates dynamic component-library labels supplied to the canvas', async () => {
    renderPanel();
    const canvas = await getCanvas();

    expect(canvas.labels.componentLibrary.variants(3)).toBe('ide.viu.next.componentLibrary.variants');
    expect(canvas.labels.componentLibrary.properties(2)).toBe('ide.viu.next.componentLibrary.properties');
    expect(canvas.labels.componentLibrary.targetScreen('Checkout')).toBe('ide.viu.next.componentLibrary.targetScreen');
  });

  it('temporarily collapses an expanded IDE sider and restores it on exit', async () => {
    const setSiderCollapsed = vi.fn();
    mocks.layoutContext = { siderCollapsed: false, setSiderCollapsed };
    const { unmount } = renderPanel();
    await getCanvas();

    expect(setSiderCollapsed).toHaveBeenCalledWith(true);
    unmount();
    expect(setSiderCollapsed).toHaveBeenCalledWith(false);
  });
});
