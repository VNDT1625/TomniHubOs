/** Independent VIU authoring/runtime package entrypoint. */

import { ipcBridge } from '@/common';
import { createPremiumStarterProject, type ViuProjectState, type ViuTransaction } from '@/common/viu';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import ViuNextCanvas from '@package-apps/design/renderer/viu/next/ViuNextCanvas';
import { viuClient, type ViuLocalAssetRef } from '@package-apps/design/renderer/viu/viuClient';
import { createDesignPackageMount, type DesignPackageMountOptions } from '@package-apps/design/renderer/runtime';
import { useDesignLabels } from '@package-apps/design/renderer/useDesignLabels';

const WORKSPACE_KEY = 'standalone:design-studio';

const ASSET_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  ktx2: 'image/ktx2',
  hdr: 'image/vnd.radiance',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
};

const transactionFromResult = (project: ViuProjectState, commands: ViuTransaction['commands']): ViuTransaction => ({
  transactionId: `viu-design-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
  documentId: project.projectId,
  baseRevision: Math.max(0, project.revision - 1),
  actor: { id: 'viu-design-user', kind: 'user' },
  origin: 'canvas',
  commands,
  mode: 'commit',
  summary: 'VIU standalone canvas edit',
});

const DesignStudioPackageApp: React.FC<{ options: DesignPackageMountOptions }> = () => {
  const labels = useDesignLabels();
  const [project, setProject] = useState<ViuProjectState>(() => createPremiumStarterProject());
  const [localAssets, setLocalAssets] = useState<ViuLocalAssetRef[]>([]);
  const commitQueue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let active = true;
    void Promise.all([viuClient.inspectV2(WORKSPACE_KEY), viuClient.listAssets(WORKSPACE_KEY)]).then(
      ([projectResult, assetResult]) => {
        if (!active) return;
        if (projectResult.ok) setProject(projectResult.data);
        if (assetResult.ok) setLocalAssets(assetResult.data);
      }
    );
    return () => {
      active = false;
    };
  }, []);

  const linkLocalAsset = useCallback(async (): Promise<void> => {
    const selected = await ipcBridge.dialog.showOpen.invoke({
      properties: ['openFile'],
      filters: [{ name: labels.assets.title, extensions: Object.keys(ASSET_MIME_BY_EXTENSION) }],
    });
    const selectedPath = selected?.[0];
    if (!selectedPath) return;
    const extension = selectedPath.split('.').pop()?.toLocaleLowerCase('en-US') ?? '';
    const mimeType = ASSET_MIME_BY_EXTENSION[extension];
    if (!mimeType) return;
    const result = await viuClient.grantAsset({
      workspaceKey: WORKSPACE_KEY,
      path: selectedPath,
      grantPath: selectedPath,
      mimeType,
    });
    if (result.ok) {
      setLocalAssets((current) => [...current.filter((asset) => asset.id !== result.data.id), result.data]);
    }
  }, [labels.assets.title]);

  return (
    <ViuNextCanvas
      labels={labels}
      project={project}
      localAssets={localAssets}
      className='h-full min-h-0'
      onLinkAsset={() => void linkLocalAsset()}
      onProjectChange={(nextProject, result) => {
        setProject(nextProject);
        const transaction = transactionFromResult(nextProject, result.normalizedCommands);
        commitQueue.current = commitQueue.current.then(async () => {
          const committed = await viuClient.commitV2({ workspaceKey: WORKSPACE_KEY, transaction });
          if (!committed.ok || committed.data.accepted) return;
          setProject(committed.data.state);
        });
      }}
    />
  );
};

export const mount = createDesignPackageMount(DesignStudioPackageApp);
