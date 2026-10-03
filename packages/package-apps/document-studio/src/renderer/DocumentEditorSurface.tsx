/**
 * Document-only editor dispatcher used by the independently downloaded package.
 * It intentionally avoids the global adapter side-effect registry because the
 * text/code adapter imports IDE-owned LSP modules.
 */

import { Button, Result, Spin } from '@arco-design/web-react';
import { Components } from '@icon-park/react';
import React, { Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { RawTextAdapter, type AdapterComponent, type EditorAdapterProps } from '@renderer/pages/editor/adapterRegistry';
import type { EditorAdapterKind } from '@renderer/pages/editor/editorRegistry';
import { useUniversalEditor } from '@renderer/pages/editor/hooks/useUniversalEditor';

const DocxAdapter = React.lazy(() => import('@package-apps/document-studio/renderer/adapters/formats/DocxAdapter'));
const SpreadsheetAdapter = React.lazy(
  () => import('@package-apps/document-studio/renderer/adapters/formats/SpreadsheetAdapter')
);
const SlideAdapter = React.lazy(() => import('@package-apps/document-studio/renderer/adapters/formats/SlideAdapter'));
const PdfAdapter = React.lazy(() => import('@package-apps/document-studio/renderer/adapters/formats/PdfAdapter'));
const BinaryInspectAdapter = React.lazy(
  () => import('@package-apps/document-studio/renderer/adapters/formats/BinaryInspectAdapter')
);

const DOCUMENT_ADAPTERS: Partial<Record<EditorAdapterKind, React.LazyExoticComponent<AdapterComponent>>> = {
  docx: DocxAdapter,
  spreadsheet: SpreadsheetAdapter,
  slide: SlideAdapter,
  pdf: PdfAdapter,
  image: BinaryInspectAdapter,
  media: BinaryInspectAdapter,
  'binary-inspect': BinaryInspectAdapter,
};

type DocumentEditorSurfaceProps = {
  filePath: string;
};

const DocumentEditorSurface: React.FC<DocumentEditorSurfaceProps> = ({ filePath }) => {
  const { t } = useTranslation();
  const { kind, mode, readOnly, file } = useUniversalEditor({ filePath });
  const Adapter = DOCUMENT_ADAPTERS[kind] ?? RawTextAdapter;

  const save = React.useCallback((next?: string): Promise<void> => file.save(next), [file]);
  const adapterProps: EditorAdapterProps = {
    filePath,
    content: file.content,
    savedContent: file.savedContent,
    mode,
    dirty: file.dirty,
    loading: file.loading,
    saving: file.saving,
    error: file.error,
    onChange: file.setContent,
    onSave: save,
    reload: file.reload,
    readOnly,
  };

  if (file.loading && file.savedContent === '' && file.error === null) {
    return (
      <div className='size-full flex-center'>
        <Spin tip={t('editor.state.loading')} />
      </div>
    );
  }

  if (file.error !== null) {
    return (
      <Result
        status='error'
        title={t('editor.state.errorTitle')}
        subTitle={file.error.message}
        extra={
          <Button type='primary' onClick={() => void file.reload()}>
            {t('editor.action.retry')}
          </Button>
        }
      />
    );
  }

  if (!Adapter) {
    return (
      <Result
        status='warning'
        icon={<Components theme='outline' size={42} />}
        title={t('editor.adapter.comingSoonTitle')}
      />
    );
  }

  return (
    <Suspense
      fallback={
        <div className='size-full flex-center'>
          <Spin tip={t('editor.state.loading')} />
        </div>
      }
    >
      <Adapter {...adapterProps} />
    </Suspense>
  );
};

export default DocumentEditorSurface;
