/** Standalone document/file hub extracted from the legacy Studio suite. */

import { Button, Tooltip } from '@arco-design/web-react';
import { CloseSmall, Left, Share, Star, StarOne } from '@icon-park/react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CollabJoinData, PublishInfo } from '@package-apps/shared/renderer/collaboration/collabClient';
import { unpublishCollab } from '@package-apps/shared/renderer/collaboration/collabClient';
import { resolveAdapterKind } from '@renderer/pages/editor/editorRegistry';
import CollabModal from '@package-apps/document-studio/renderer/studio/components/CollabModal';
import StudioDashboard from '@package-apps/document-studio/renderer/studio/components/StudioDashboard';
import StudioPeerView from '@package-apps/document-studio/renderer/studio/components/StudioPeerView';
import { useEditorToolsProvider } from '@package-apps/document-studio/renderer/studio/editorToolsProvider';
import { FILE_KIND_META } from '@package-apps/document-studio/renderer/studio/fileKindMeta';
import {
  baseName,
  getLastStudioView,
  isStarred,
  setLastStudioView,
  toggleStarred,
} from '@package-apps/document-studio/renderer/studioStorage';
import DocumentEditorSurface from '@package-apps/document-studio/renderer/DocumentEditorSurface';
import type { DocumentPackageMountOptions } from '@package-apps/document-studio/renderer/documentRuntime';

type DocumentStudioView =
  | { mode: 'dashboard' }
  | { mode: 'editor'; filePath: string }
  | { mode: 'peer'; join: CollabJoinData; hostBaseUrl: string };

type DocumentEditorViewProps = {
  filePath: string;
  starred: boolean;
  onBack: () => void;
  onClose: () => void;
  onStar: (filePath: string) => void;
  onJoin: (join: CollabJoinData, joinCode: string) => void;
};

const DocumentEditorView: React.FC<DocumentEditorViewProps> = ({
  filePath,
  starred,
  onBack,
  onClose,
  onStar,
  onJoin,
}) => {
  const { t } = useTranslation();
  const name = baseName(filePath);
  const kind = resolveAdapterKind({ fileName: name });
  const meta = FILE_KIND_META[kind];
  const Icon = meta.Icon;
  const [collabOpen, setCollabOpen] = useState(false);
  const [share, setShare] = useState<PublishInfo | null>(null);

  useEffect(
    () => () => {
      if (share) void unpublishCollab(share.shareId);
    },
    [share]
  );

  return (
    <div className='size-full flex flex-col min-h-0 bg-1'>
      <header className='h-52px shrink-0 flex items-center gap-12px px-16px border-b border-b-1'>
        <Button type='text' icon={<Left theme='outline' size={18} />} className='!text-t-secondary' onClick={onBack}>
          {t('studio.action.back')}
        </Button>
        <span className={`flex-center shrink-0 ${meta.accentClass}`}>
          <Icon theme='outline' size={18} fill='currentColor' />
        </span>
        <span className='text-14px font-[500] text-t-primary truncate'>{name}</span>
        <span className='text-12px text-t-tertiary'>· {t(meta.labelKey)}</span>
        <div className='flex-1' />
        <Tooltip content={share ? t('studio.collab.live') : t('studio.collab.title')} mini>
          <Button
            type={share ? 'primary' : 'text'}
            status={share ? 'success' : undefined}
            className={share ? '' : '!text-t-secondary'}
            icon={<Share theme='outline' size={16} />}
            onClick={() => setCollabOpen(true)}
          >
            {share ? t('studio.collab.live') : t('studio.collab.share')}
          </Button>
        </Tooltip>
        <Tooltip content={starred ? t('studio.action.unstar') : t('studio.action.star')} mini>
          <Button
            type='text'
            className={starred ? '!text-warning' : '!text-t-tertiary'}
            icon={starred ? <StarOne theme='filled' size={17} /> : <Star theme='outline' size={17} />}
            onClick={() => onStar(filePath)}
          />
        </Tooltip>
        <Tooltip content={t('studio.action.closeFile')} mini>
          <Button type='text' status='danger' icon={<CloseSmall theme='outline' size={18} />} onClick={onClose} />
        </Tooltip>
      </header>
      <main className='flex-1 min-h-0 p-16px'>
        <DocumentEditorSurface filePath={filePath} />
      </main>
      <CollabModal
        visible={collabOpen}
        filePath={filePath}
        onClose={() => setCollabOpen(false)}
        onPublished={setShare}
        onJoined={onJoin}
      />
    </div>
  );
};

type DocumentStudioPageProps = {
  options: DocumentPackageMountOptions;
};

const DocumentStudioPage: React.FC<DocumentStudioPageProps> = ({ options }) => {
  useEditorToolsProvider();
  const [view, setView] = useState<DocumentStudioView>(() => {
    const last = getLastStudioView();
    return last.mode === 'editor' ? last : { mode: 'dashboard' };
  });
  const [openFiles, setOpenFiles] = useState<string[]>(() => (view.mode === 'editor' ? [view.filePath] : []));
  const [, setStarTick] = useState(0);

  useEffect(() => {
    if (view.mode !== 'peer') setLastStudioView(view);
  }, [view]);

  const openFile = (filePath: string): void => {
    setOpenFiles((current) => (current.includes(filePath) ? current : [...current, filePath]));
    setView({ mode: 'editor', filePath });
  };

  const closeFile = (filePath: string): void => {
    setOpenFiles((current) => current.filter((item) => item !== filePath));
    setView({ mode: 'dashboard' });
  };

  const handleStar = (filePath: string): void => {
    toggleStarred(filePath);
    setStarTick((tick) => tick + 1);
  };

  const joinPeer = (join: CollabJoinData, joinCode: string): void => {
    setView({ mode: 'peer', join, hostBaseUrl: `http://${joinCode}` });
  };

  return (
    <div className='size-full relative'>
      <div className='size-full' style={{ display: view.mode === 'dashboard' ? 'block' : 'none' }}>
        <StudioDashboard
          onOpenFile={openFile}
          onOpenIde={() => options.openDefaultSurface('ide')}
          onOpenViu={() => options.openPackageModule('com.tomni.design-studio', 'design')}
          onJoinSession={joinPeer}
          onAutomation={() => options.openPackageModule('com.tomni.automation-studio', 'automation')}
          onMakeVideo={() => options.openPackageModule('com.tomni.video-studio', 'video')}
          onMusic={() => options.openPackageModule('com.tomni.music-studio', 'music')}
        />
      </div>
      {openFiles.map((filePath) => {
        const active = view.mode === 'editor' && view.filePath === filePath;
        return (
          <div key={filePath} className='absolute inset-0' style={{ display: active ? 'block' : 'none' }}>
            <DocumentEditorView
              filePath={filePath}
              starred={isStarred(filePath)}
              onBack={() => setView({ mode: 'dashboard' })}
              onClose={() => closeFile(filePath)}
              onStar={handleStar}
              onJoin={joinPeer}
            />
          </div>
        );
      })}
      {view.mode === 'peer' ? (
        <div className='absolute inset-0'>
          <StudioPeerView
            join={view.join}
            hostBaseUrl={view.hostBaseUrl}
            onBack={() => setView({ mode: 'dashboard' })}
          />
        </div>
      ) : null}
    </div>
  );
};

export default DocumentStudioPage;
