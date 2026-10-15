import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { NewsArticle } from '../services/types';
import { ArticleFollowUpInput } from './ArticleFollowUpInput';

type Props = {
  article: NewsArticle;
  onBack: () => void;
  onStartChat: (question: string) => void;
  onOpenSource: (url: string) => void;
  onArticleBodyLoaded?: (paragraphs: readonly string[]) => void;
};
export const RealtimeArticleView: React.FC<Props> = ({
  article,
  onBack,
  onStartChat,
  onOpenSource,
  onArticleBodyLoaded,
}) => {
  const { t } = useTranslation();
  const bodyCallback = useRef(onArticleBodyLoaded);
  bodyCallback.current = onArticleBodyLoaded;
  const [remote, setRemote] = useState<{
    status: 'loading' | 'ready' | 'error';
    paragraphs: readonly string[];
    code?: string;
  }>({ status: 'loading', paragraphs: [] });
  useEffect(() => {
    if (article.isDemo || article.body.length > 0) return;
    let active = true;
    const read = window.electronAPI?.realtimeContent?.readArticle;
    if (!read) {
      setRemote({ status: 'error', paragraphs: [], code: 'UNAVAILABLE' });
      return;
    }
    setRemote({ status: 'loading', paragraphs: [] });
    void read({ articleId: article.id })
      .then((result) => {
        if (!active) return;
        if (result.ok) {
          setRemote({ status: 'ready', paragraphs: result.paragraphs });
          bodyCallback.current?.(result.paragraphs);
        } else setRemote({ status: 'error', paragraphs: [], code: 'code' in result ? result.code : 'UNAVAILABLE' });
      })
      .catch(() => {
        if (active) setRemote({ status: 'error', paragraphs: [], code: 'OFFLINE' });
      });
    return () => {
      active = false;
    };
  }, [article.id, article.isDemo]);
  return (
    <main className='realtime-page realtime-reader-page'>
      <nav className='realtime-reader-nav'>
        <button className='realtime-back' type='button' onClick={onBack}>
          ← {t('news.hub.backToDiscover')}
        </button>
        {article.isDemo && <span className='realtime-preview-tag'>{t('news.hub.demoBadge')}</span>}
      </nav>
      <article className='realtime-reader-body'>
        <div className='realtime-metadata'>
          {article.category} · {article.publishedAt ?? ''}
        </div>
        <h1>{article.title}</h1>
        <p className='realtime-reader-lead'>{article.excerpt}</p>
        {(article.body.length ? article.body : remote.paragraphs).map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
        {!article.isDemo && article.body.length === 0 && remote.status === 'loading' && (
          <p role='status'>{t('news.hub.custom.loadingArticle')}</p>
        )}
        {!article.isDemo && article.body.length === 0 && remote.status === 'error' && (
          <p role='status' className='realtime-warning'>
            {t('news.hub.custom.articleUnavailable')} ({remote.code})
          </p>
        )}
        <p className='realtime-warning'>
          {article.isDemo ? t('news.hub.articleDisclaimer') : t('news.hub.custom.newsDescription')}
        </p>
        <h2>{t('news.allSources')}</h2>
        <div className='realtime-sources'>
          {article.sources.map((source) => (
            <button
              key={source.url}
              className='realtime-source-card'
              type='button'
              onClick={() => onOpenSource(source.url)}
            >
              <strong>{source.label}</strong>
              <small>{source.url}</small>
              <span>↗</span>
            </button>
          ))}
        </div>
      </article>
      <ArticleFollowUpInput onSubmit={onStartChat} />
    </main>
  );
};
