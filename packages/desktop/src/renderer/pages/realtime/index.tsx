import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { RealtimeNewsFeed } from './RealtimeNewsFeed';
import { RealtimeArticleView } from './article/RealtimeArticleView';
import { ArticleChatThread } from './article/ArticleChatThread';
import { RealtimeSourceFocusView } from './focus/RealtimeSourceFocusView';
import { browserPathForExternalUrl } from './services/navigation';
import { buildRealtimeResearchDraft } from './services/researchDraft';
import { refreshRealtime, useRealtimeSource } from './services/realtimeClient';
import type { NewsArticle } from './services/types';
import { readWidgetSettings, REALTIME_WIDGET_SETTINGS_CHANGED } from './widgets/widgetRegistry';

const VIEW_SOURCES = ['github', 'huggingface', 'market', 'weather'] as const;
const RealtimePage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const routeView = params.get('view');
  const source = VIEW_SOURCES.find((value) => value === routeView);
  const itemId = params.get('item') ?? undefined;
  const [view, setView] = useState<'feed' | 'article' | 'chat'>('feed');
  const [weatherCity, setWeatherCity] = useState(() => readWidgetSettings().city);
  useEffect(() => {
    const onSettingsChanged = (): void => setWeatherCity(readWidgetSettings().city);
    window.addEventListener(REALTIME_WIDGET_SETTINGS_CHANGED, onSettingsChanged);
    return () => window.removeEventListener(REALTIME_WIDGET_SETTINGS_CHANGED, onSettingsChanged);
  }, []);
  useEffect(() => {
    if (source) setView('feed');
  }, [source]);
  const [article, setArticle] = useState<NewsArticle | null>(null);
  const [initialQuestion, setInitialQuestion] = useState('');
  const news = useRealtimeSource('news');
  const feedRef = useRef<HTMLDivElement>(null);
  const scrollPosition = useRef(0);
  useLayoutEffect(() => {
    if (!source && view === 'feed' && feedRef.current) feedRef.current.scrollTop = scrollPosition.current;
  }, [source, view]);
  const openBrowser = (url: string): void => {
    const path = browserPathForExternalUrl(url);
    if (path) navigate(path);
  };
  const askAgent = (questions: readonly string[]): void => {
    if (!article) return;
    const prompt = buildRealtimeResearchDraft(article, questions);
    navigate('/guid', { state: { realtimeDraft: prompt } });
  };
  if (source) {
    return <RealtimeSourceFocusView source={source} itemId={itemId} city={weatherCity} onOpenExternal={openBrowser} />;
  }
  if (view === 'article' && article)
    return (
      <RealtimeArticleView
        article={article}
        onBack={() => setView('feed')}
        onStartChat={(question) => {
          setInitialQuestion(question);
          setView('chat');
        }}
        onOpenSource={openBrowser}
        onArticleBodyLoaded={(paragraphs) =>
          setArticle((current) => (current?.id === article.id ? { ...current, body: [...paragraphs] } : current))
        }
      />
    );
  if (view === 'chat' && article)
    return (
      <ArticleChatThread
        article={article}
        initialQuestion={initialQuestion}
        onBack={() => setView('feed')}
        onAskAgent={askAgent}
        onOpenSource={openBrowser}
      />
    );
  const articles: NewsArticle[] = news.items.map((item) => ({
    id: item.id,
    title: item.title,
    excerpt: item.description,
    body: [] as string[],
    category: item.sourceLabel ?? 'RSS',
    publishedAt: item.publishedAt,
    sources: item.url ? [{ label: item.sourceLabel ?? 'RSS', url: item.url }] : [],
    isDemo: false,
  }));
  return (
    <RealtimeNewsFeed
      articles={articles}
      status={news.status}
      updatedAt={news.updatedAt}
      error={news.error}
      scrollRef={feedRef}
      onRefresh={() => void refreshRealtime('news', undefined, true)}
      onSelectArticle={(selected) => {
        scrollPosition.current = feedRef.current?.scrollTop ?? scrollPosition.current;
        setArticle(selected);
        setView('article');
      }}
    />
  );
};
export default RealtimePage;
