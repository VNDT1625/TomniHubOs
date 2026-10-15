/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { Spin } from '@arco-design/web-react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { artifactTitle, collectArtifactEntries, type ArtifactEntry } from './artifactsModel';
import styles from './ArtifactsPage.module.css';

/**
 * `/artifacts`: the records agents produced in conversations (scheduled-run triggers, skill suggestions),
 * newest first. Rendered in the shell centre; it never redirects to the Store.
 */
const ArtifactsPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [entries, setEntries] = useState<ArtifactEntry[]>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void ipcBridge.database.getUserConversations
      .invoke({ limit: 100 })
      .then((result) =>
        collectArtifactEntries(result?.items ?? [], (conversation_id) =>
          ipcBridge.conversation.listArtifacts.invoke({ conversation_id })
        )
      )
      .then((items) => {
        if (live) setEntries(items);
      })
      .catch(() => {
        if (live) {
          setFailed(true);
          setEntries([]);
        }
      });
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className='hub-page' data-testid='hub-artifacts-page'>
      <header className='hub-page-heading'>
        <div>
          <h1>{t('guid.hubHome.artifacts.title')}</h1>
          <p>{t('guid.hubHome.artifacts.subtitle')}</p>
        </div>
      </header>
      {entries === undefined ? (
        <Spin loading style={{ display: 'block', margin: '48px auto' }} />
      ) : entries.length === 0 ? (
        <div className={styles.empty} data-testid='hub-artifacts-empty'>
          <strong>{t(failed ? 'guid.hubHome.artifacts.loadError' : 'guid.hubHome.artifacts.emptyTitle')}</strong>
          {!failed && <span>{t('guid.hubHome.artifacts.emptyHint')}</span>}
        </div>
      ) : (
        <ul className={styles.list} data-testid='hub-artifacts-list'>
          {entries.map(({ artifact, conversationId, conversationName }) => (
            <li key={artifact.id}>
              <button
                type='button'
                className={styles.row}
                onClick={() => navigate(`/conversation/${conversationId}`)}
              >
                <span className={styles.kind}>{t(`guid.hubHome.artifacts.kind.${artifact.kind}`)}</span>
                <strong className={styles.name}>{artifactTitle(artifact)}</strong>
                <span className={styles.meta}>
                  {conversationName} · {t(`guid.hubHome.artifacts.status.${artifact.status}`)} ·{' '}
                  {new Date(artifact.created_at).toLocaleString()}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default ArtifactsPage;
