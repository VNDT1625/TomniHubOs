import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { NewsArticle } from '../services/types';
import { ArticleFollowUpInput } from './ArticleFollowUpInput';

type Props = {
  article: NewsArticle;
  initialQuestion: string;
  onBack: () => void;
  onAskAgent: (questions: readonly string[]) => void;
  onOpenSource: (url: string) => void;
};
/** Keeps article and question context until it is handed to the governed Hub chat pipeline. */
export const ArticleChatThread: React.FC<Props> = ({ article, initialQuestion, onBack, onAskAgent, onOpenSource }) => {
  const { t } = useTranslation();
  const [questions, setQuestions] = useState<string[]>([initialQuestion]);
  return (
    <main className='realtime-page realtime-reader-page'>
      <nav className='realtime-reader-nav'>
        <button type='button' className='realtime-back' onClick={onBack}>
          ← {t('news.hub.backToDiscover')}
        </button>
        <span>{t('news.sourceCount', { count: article.sources.length })}</span>
      </nav>
      <div className='realtime-chat'>
        <div className='realtime-context-card'>
          <span>{t('news.hub.continuedFrom')}</span>
          <strong>{article.title}</strong>
        </div>
        <div className='realtime-chat-sources'>
          {article.sources.map((source) => (
            <button key={source.url} type='button' onClick={() => onOpenSource(source.url)}>
              {source.label} ↗
            </button>
          ))}
        </div>
        {questions.map((question, index) => (
          <div className='realtime-chat-message' key={index}>
            {question}
          </div>
        ))}
        <div className='realtime-chat-pending' role='status'>
          <h2>{t('news.hub.agentHandoffTitle')}</h2>
          <p>{t('news.hub.agentHandoffDescription')}</p>
          <button type='button' className='realtime-primary-button' onClick={() => onAskAgent(questions)}>
            {t('news.hub.continueInHub')} ↗
          </button>
        </div>
      </div>
      <ArticleFollowUpInput onSubmit={(question) => setQuestions((previous) => [...previous, question])} />
    </main>
  );
};
