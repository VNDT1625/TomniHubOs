/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Modal, Spin } from '@arco-design/web-react';
import MarkdownView from '@/renderer/components/Markdown';
import type { SkillDocumentData, SkillDocumentErrorCode } from '@/common/skills/skillDocument';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Read-only viewer for an installed skill's SKILL.md. Reusable: pass the skill name and, when the skill comes from an
 * installed package, its packageId and display name. Main resolves the file; the renderer never supplies a path.
 * Mount the component to open it and unmount it to close it.
 */
export type SkillDocumentModalProps = {
  name: string;
  packageId?: string;
  packageName?: string;
  onClose: () => void;
};

type ViewState =
  | { status: 'loading' }
  | { status: 'ready'; data: SkillDocumentData }
  | { status: 'error'; code: SkillDocumentErrorCode | 'UNAVAILABLE' };

/** Drops the leading YAML frontmatter because name and description are already shown in the header. */
export const stripSkillFrontmatter = (content: string): string =>
  content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/u, '');

const SkillDocumentModal: React.FC<SkillDocumentModalProps> = ({ name, packageId, packageName, onClose }) => {
  const { t } = useTranslation();
  const [view, setView] = useState<ViewState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    const api = window.electronAPI?.skillDocuments;
    setView({ status: 'loading' });
    if (!api) {
      setView({ status: 'error', code: 'UNAVAILABLE' });
    } else {
      api
        .read(packageId === undefined ? { name } : { name, packageId })
        .then((result) => {
          if (!active) return;
          if ('code' in result) {
            setView({ status: 'error', code: result.code });
            return;
          }
          setView({ status: 'ready', data: result.data });
        })
        .catch(() => {
          if (active) setView({ status: 'error', code: 'UNAVAILABLE' });
        });
    }
    return () => {
      active = false;
    };
  }, [name, packageId]);

  const sourceLabel =
    packageId === undefined
      ? t('conversation.attachMenu.skillSourceStandalone', { defaultValue: 'Added by you or built in' })
      : t('conversation.attachMenu.skillSourcePackage', {
          defaultValue: 'Package: {{name}}',
          name: packageName ?? packageId,
        });

  const errorText =
    view.status === 'error'
      ? view.code === 'NOT_FOUND'
        ? t('conversation.attachMenu.skillDocNotFound', { defaultValue: 'This skill file is no longer available.' })
        : view.code === 'TOO_LARGE'
          ? t('conversation.attachMenu.skillDocTooLarge', {
              defaultValue: 'This SKILL.md is too large to show here.',
            })
          : t('conversation.attachMenu.skillDocFailed', { defaultValue: 'The skill could not be read.' })
      : undefined;

  return (
    <Modal
      visible
      title={name}
      onCancel={onClose}
      footer={null}
      className='skill-document-modal'
      wrapClassName='tomni-modal-top'
    >
      <div className='skill-document' data-testid='skill-document-modal'>
        <div className='skill-document__meta'>
          <div className='skill-document__source'>{sourceLabel}</div>
          {view.status === 'ready' && view.data.description ? (
            <p className='skill-document__description'>{view.data.description}</p>
          ) : null}
        </div>
        {view.status === 'loading' ? (
          <div className='skill-document__loading'>
            <Spin />
          </div>
        ) : null}
        {errorText ? <div className='skill-document__error'>{errorText}</div> : null}
        {view.status === 'ready' ? (
          <div className='skill-document__body'>
            <MarkdownView>{stripSkillFrontmatter(view.data.content)}</MarkdownView>
          </div>
        ) : null}
      </div>
    </Modal>
  );
};

export { SkillDocumentModal };
export default SkillDocumentModal;
