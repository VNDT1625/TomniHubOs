/** Narrow, read-only Realtime IPC contract. No renderer-provided URLs or arbitrary API operations. */
export const REALTIME_CONTENT_CHANNEL = 'realtime-content.read' as const;
export const REALTIME_ARTICLE_CHANNEL = 'realtime-content.article' as const;
export type RealtimeSource = 'news' | 'github' | 'huggingface' | 'weather' | 'market';
export type RealtimeCity = 'hanoi' | 'hochiminh' | 'danang';
export type RealtimeMarketRange = '1d' | '1w' | '1m' | '1y' | '5y';
export type RealtimeHuggingFaceKind = 'models' | 'datasets' | 'spaces';
export type RealtimePoint = Readonly<{ time: string; value: number }>;
export type RealtimeEntry = Readonly<{
  id: string;
  title: string;
  description: string;
  url?: string;
  language?: string;
  publishedAt?: string;
  sourceLabel?: string;
  /** Verified provider readings, never synthetic series. */
  history?: readonly RealtimePoint[];
  forecast?: readonly RealtimePoint[];
  weatherCode?: number;
  value?: number;
  changePercent?: number;
  forks?: number;
  unit?: string;
}>;
export type RealtimeReadRequest = Readonly<{
  source: RealtimeSource;
  city?: RealtimeCity;
  range?: RealtimeMarketRange;
  force?: boolean;
  kind?: RealtimeHuggingFaceKind;
}>;
export type RealtimeReadResult =
  | Readonly<{ ok: true; source: RealtimeSource; updatedAt: string; items: readonly RealtimeEntry[] }>
  | Readonly<{ ok: false; code: 'DENIED' | 'INVALID' | 'OFFLINE' | 'UNAVAILABLE' | 'RATE_LIMITED' }>;
export type RealtimeArticleReadRequest = Readonly<{ articleId: string }>;
export type RealtimeArticleReadResult =
  | Readonly<{ ok: true; paragraphs: readonly string[] }>
  | Readonly<{ ok: false; code: 'DENIED' | 'INVALID' | 'OFFLINE' | 'UNAVAILABLE' | 'RATE_LIMITED' }>;
export type RealtimeContentNativeAPI = Readonly<{
  read(request: RealtimeReadRequest): Promise<RealtimeReadResult>;
  readArticle(request: RealtimeArticleReadRequest): Promise<RealtimeArticleReadResult>;
}>;
