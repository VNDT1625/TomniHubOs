/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  FileViewerDocument,
  FileViewerRef,
  HubFileErrorCode,
} from '@/common/integrations/library/libraryContracts';
import { explorerSize } from '@/renderer/pages/guid/HubHome/explorer/path';
import { Button } from '@arco-design/web-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FileViewerBody } from './FileViewerBody';
import { LIBRARY_ROUTE, parseFileViewerSearch } from './fileViewerRoute';

type ViewState =
  | { status: 'loading' }
  | { status: 'ready'; document: FileViewerDocument }
  | { status: 'error'; code: HubFileErrorCode };

const errorKey = (code: HubFileErrorCode): string =>
  code === 'NOT_FOUND'
    ? 'guid.hubHome.fileViewer.errors.notFound'
    : code === 'DENIED'
      ? 'guid.hubHome.fileViewer.errors.denied'
      : 'guid.hubHome.fileViewer.errors.generic';

/** Centre file viewer (S12): text, Markdown, code, images and PDF. The route carries an opaque reference, never a path. */
const FileViewerPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const ref: FileViewerRef | null = useMemo(() => parseFileViewerSearch(params), [params]);
  const refKey = ref ? `${ref.kind}:${ref.id}` : '';
  const [state, setState] = useState<ViewState>({ status: 'loading' });
  const [added, setAdded] = useState(false);
  const [actionError, setActionError] = useState<HubFileErrorCode | null>(null);

  useEffect(() => {
    let current = true;
    setAdded(false);
    setActionError(null);
    const api = window.electronAPI?.fileViewer;
    if (!ref || !api) {
      setState({ status: 'error', code: ref ? 'IO_ERROR' : 'INVALID_REQUEST' });
      return undefined;
    }
    setState({ status: 'loading' });
    void api
      .read({ ref })
      .then((result) => {
        if (!current) return;
        setState(
          result.ok === false ? { status: 'error', code: result.code } : { status: 'ready', document: result.data }
        );
      })
      .catch(() => {
        if (current) setState({ status: 'error', code: 'IO_ERROR' });
      });
    return () => {
      current = false;
    };
    // `ref` is derived from `refKey`, so the effect depends on the reference's value, not its identity.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [refKey]);

  const goBack = useCallback(() => {
    if (ref?.kind === 'library') navigate(LIBRARY_ROUTE);
    else navigate(-1);
  }, [navigate, ref]);

  const openExternal = useCallback(() => {
    if (!ref) return;
    setActionError(null);
    void window.electronAPI?.fileViewer
      ?.openExternal({ ref })
      .then((result) => {
        if (result.ok === false) setActionError(result.code);
      })
      .catch(() => setActionError('IO_ERROR'));
  }, [ref]);

  const addToLibrary = useCallback(() => {
    if (ref?.kind !== 'view') return;
    setActionError(null);
    void window.electronAPI?.library
      ?.addFromView({ viewId: ref.id })
      .then((result) => {
        if (result.ok === false) setActionError(result.code);
        else setAdded(true);
      })
      .catch(() => setActionError('IO_ERROR'));
  }, [ref]);

  const viewed = state.status === 'ready' ? state.document : undefined;

  return (
    <div className='hub-page hub-fv' data-testid='hub-file-viewer'>
      <header className='hub-fv-bar'>
        <Button type='secondary' size='small' onClick={goBack} data-testid='file-viewer-back'>
          {t(ref?.kind === 'library' ? 'guid.hubHome.fileViewer.backToLibrary' : 'guid.hubHome.fileViewer.back')}
        </Button>
        <div className='hub-fv-title'>
          <h1>{viewed?.name ?? ''}</h1>
          {viewed && <p>{explorerSize(viewed.sizeBytes)}</p>}
        </div>
        <div className='hub-fv-actions'>
          {ref?.kind === 'view' && viewed && (
            <Button type='secondary' size='small' disabled={added} onClick={addToLibrary}>
              {t(added ? 'guid.hubHome.fileViewer.addedToLibrary' : 'guid.hubHome.fileViewer.addToLibrary')}
            </Button>
          )}
          {viewed?.canOpenExternal && (
            <Button type='secondary' size='small' onClick={openExternal}>
              {t('guid.hubHome.fileViewer.openExternal')}
            </Button>
          )}
        </div>
      </header>
      {actionError && (
        <p className='hub-fv-notice hub-fv-notice--bad' role='alert'>
          {t(errorKey(actionError))}
        </p>
      )}
      {state.status === 'loading' && (
        <p className='hub-fv-notice' role='status'>
          {t('guid.hubHome.fileViewer.loading')}
        </p>
      )}
      {state.status === 'error' && (
        <p className='hub-fv-notice hub-fv-notice--bad' role='alert'>
          {t(errorKey(state.code))}
        </p>
      )}
      {viewed && <FileViewerBody name={viewed.name} content={viewed.content} />}
    </div>
  );
};

export default FileViewerPage;
