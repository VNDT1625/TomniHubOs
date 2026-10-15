import React from 'react';
import { useTranslation } from 'react-i18next';
import { partitionArticlesIntoBlocks } from './services/newsProvider';
import type { NewsArticle } from './services/types';

type Props = {
  onSelectArticle: (article: NewsArticle) => void;
  scrollRef?: React.Ref<HTMLDivElement>;
  articles: readonly NewsArticle[];
  status?: 'idle' | 'loading' | 'ready' | 'error';
  updatedAt?: string;
  error?: string;
  onRefresh?: () => void;
};

/** The centre owns editorial content only; widgets now live in the shared HubRail. */
export const RealtimeNewsFeed: React.FC<Props> = ({
  onSelectArticle,
  scrollRef,
  articles,
  status,
  updatedAt,
  error,
  onRefresh,
}) => {
  const { t } = useTranslation();
  const blocks = partitionArticlesIntoBlocks(articles);
  return (
    <main className='realtime-page' data-testid='realtime-page'>
      <header className='realtime-page-header'>
        <div>
          <span className='realtime-eyebrow'>{t('news.navTitle')}</span>
          <h1>{t('news.hub.discover')}</h1>
          <p>{t('news.hub.custom.newsDescription')}</p>
        </div>
        <button type='button' className='realtime-action' onClick={onRefresh}>
          {t('news.refresh')} ↻
        </button>
      </header>
      {updatedAt && (
        <p className='realtime-metadata'>{t('news.lastUpdated', { time: new Date(updatedAt).toLocaleString() })}</p>
      )}
      {error && (
        <div className='realtime-warning' role='status'>
          {t('news.hub.custom.failed')} ({error})
        </div>
      )}
      <div className='realtime-layout realtime-layout--feed-only'>
        <section className='realtime-feed-scroll' ref={scrollRef} aria-label={t('news.hub.feedTitle')}>
          <h2 className='realtime-section-title'>{t('news.hub.feedTitle')}</h2>
          {status === 'loading' && <p role='status'>{t('news.refreshing')}</p>}
          {blocks.length === 0 && status !== 'loading' ? (
            <div className='realtime-empty'>{t('news.hub.custom.noLiveNews')}</div>
          ) : (
            blocks.map((block, index) =>
              block.type === 'hero' ? (
                <article className='realtime-hero-card' key={block.article.id}>
                  <div className='realtime-card-copy'>
                    <span className='realtime-metadata'>
                      {block.article.category} · {block.article.publishedAt ?? ''}
                    </span>
                    <h3>
                      <button
                        type='button'
                        className='realtime-title-button'
                        onClick={() => onSelectArticle(block.article)}
                      >
                        {block.article.title}
                      </button>
                    </h3>
                    <p>{block.article.excerpt}</p>
                    <span className='realtime-metadata'>
                      {t('news.sourceCount', { count: block.article.sources.length })}
                    </span>
                    <button type='button' className='realtime-action' onClick={() => onSelectArticle(block.article)}>
                      {t('news.hub.readArticle')} →
                    </button>
                  </div>
                  <button
                    type='button'
                    className='realtime-hero-art'
                    aria-label={block.article.title}
                    onClick={() => onSelectArticle(block.article)}
                  >
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <strong>Tomni / Realtime</strong>
                  </button>
                </article>
              ) : (
                <div className='realtime-subgrid' key={block.articles[0]?.id}>
                  {block.articles.map((article, subIndex) => (
                    <article className='realtime-subcard' key={article.id}>
                      <button
                        className='realtime-subcard-visual'
                        type='button'
                        aria-label={article.title}
                        onClick={() => onSelectArticle(article)}
                      >
                        <span>{String(index + subIndex + 1).padStart(2, '0')}</span>
                      </button>
                      <div className='realtime-subcard-copy'>
                        <span className='realtime-metadata'>{article.category}</span>
                        <h3>
                          <button
                            className='realtime-title-button'
                            type='button'
                            onClick={() => onSelectArticle(article)}
                          >
                            {article.title}
                          </button>
                        </h3>
                        <span className='realtime-metadata'>{article.publishedAt ?? ''}</span>
                      </div>
                    </article>
                  ))}
                </div>
              )
            )
          )}
        </section>
      </div>
    </main>
  );
};
