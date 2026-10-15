import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getTrendingRepos } from '../services/repoProvider';
export const TrendingReposFocusView: React.FC<{ onBack: () => void; onOpenRepo: (url: string) => void }> = ({
  onBack,
  onOpenRepo,
}) => {
  const { t } = useTranslation();
  const [language, setLanguage] = useState('All');
  const [search, setSearch] = useState('');
  const repos = getTrendingRepos().filter(
    (repo) =>
      (language === 'All' || repo.language === language) &&
      (repo.name.toLowerCase().includes(search.toLowerCase()) ||
        repo.description.toLowerCase().includes(search.toLowerCase()))
  );
  return (
    <main className='realtime-page realtime-focus-page'>
      <button type='button' className='realtime-back' onClick={onBack}>
        ← {t('news.hub.back')}
      </button>
      <h1>{t('news.hub.reposDetail')}</h1>
      <p>{t('news.hub.repoPreview')}</p>
      <input
        className='realtime-filter-input'
        type='search'
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={t('news.hub.searchRepo')}
        aria-label={t('news.hub.searchRepo')}
      />
      <div className='realtime-timeframes'>
        {['All', 'Rust', 'Python', 'TypeScript', 'Go', 'JavaScript'].map((name) => (
          <button
            type='button'
            key={name}
            aria-pressed={language === name}
            className={language === name ? 'selected' : ''}
            onClick={() => setLanguage(name)}
          >
            {name === 'All' ? t('news.category.all') : name}
          </button>
        ))}
      </div>
      <div className='realtime-repos-focus-list'>
        {repos.length === 0 ? (
          <div className='realtime-empty'>{t('news.github.empty')}</div>
        ) : (
          repos.map((repo) => (
            <div key={repo.name} className='realtime-repo-focus-row'>
              <div>
                <strong>{repo.name}</strong>
                <p>{repo.description}</p>
                <span className='realtime-metadata'>{repo.language}</span>
              </div>
              <button className='realtime-action' type='button' onClick={() => onOpenRepo(repo.url)}>
                {t('news.hub.openRepo')} ↗
              </button>
            </div>
          ))
        )}
      </div>
    </main>
  );
};
