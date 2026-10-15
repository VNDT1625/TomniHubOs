/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Export/import of an assistant as a share bundle (agent.md + assistant.json in a zip). Import only fills the editor;
 * nothing is saved until the user presses Save. Export builds the file from what the editor currently shows.
 */

import type { CreateAssistantRequest, Assistant } from '@/common/types/agent/assistantTypes';
import {
  ASSISTANT_BUNDLE_MAX_BYTES,
  AssistantBundleError,
  buildAssistantBundle,
  bundleFileName,
  readAssistantBundle,
} from '@/common/types/agent/assistant/assistantBundle';
import { Button, Message } from '@arco-design/web-react';
import { Download, Upload } from '@icon-park/react';
import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';

export type AssistantBundleActionsProps = {
  /** Current editor state as an assistant record; called at click time so it is never stale. */
  buildCurrent: () => Assistant;
  /** Receives a validated request. The caller fills the editor from it; it does not save. */
  onImport: (request: CreateAssistantRequest) => void;
  /** Import is offered only while creating, so a bundle never overwrites an existing assistant. */
  canImport: boolean;
};

const AssistantBundleActions: React.FC<AssistantBundleActionsProps> = ({ buildCurrent, onImport, canImport }) => {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    try {
      const assistant = buildCurrent();
      const bytes = await buildAssistantBundle(assistant);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/zip' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = bundleFileName(assistant.name);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      const code = error instanceof AssistantBundleError ? error.code : 'export_failed';
      Message.error(t('settings.assistantBundleExportFailed', { code, defaultValue: `Export failed (${code}).` }));
    }
  };

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      if (file.size > ASSISTANT_BUNDLE_MAX_BYTES) throw new AssistantBundleError('bundle_too_large');
      const request = await readAssistantBundle(new Uint8Array(await file.arrayBuffer()));
      onImport(request);
      Message.success(
        t('settings.assistantBundleImported', { defaultValue: 'Assistant loaded. Review it, then save.' })
      );
    } catch (error) {
      const code = error instanceof AssistantBundleError ? error.code : 'import_failed';
      Message.error(t('settings.assistantBundleImportFailed', { code, defaultValue: `Import failed (${code}).` }));
    }
  };

  return (
    <div className='flex items-center gap-8px' data-testid='assistant-bundle-actions'>
      {canImport && (
        <>
          <Button size='small' type='outline' icon={<Upload size={14} />} onClick={() => inputRef.current?.click()}>
            {t('settings.assistantBundleImport', { defaultValue: 'Import' })}
          </Button>
          <input
            ref={inputRef}
            type='file'
            accept='.zip,application/zip'
            className='hidden'
            data-testid='assistant-bundle-input'
            onChange={(event) => void handleFile(event)}
          />
        </>
      )}
      <Button size='small' type='outline' icon={<Download size={14} />} onClick={() => void handleExport()}>
        {t('settings.assistantBundleExport', { defaultValue: 'Export' })}
      </Button>
    </div>
  );
};

export default AssistantBundleActions;
