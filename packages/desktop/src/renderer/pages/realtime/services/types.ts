/** Realtime presentation data is untrusted until verified by a Main-owned provider. */
export type NewsSourceCitation = Readonly<{ label: string; url: string }>;
export type NewsArticle = Readonly<{
  id: string;
  title: string;
  excerpt: string;
  body: string[];
  category: string;
  sources: NewsSourceCitation[];
  imageUrl?: string;
  publishedAt?: string;
  isDemo: boolean;
}>;
export type NewsFeedBlock =
  | Readonly<{ type: 'hero'; article: NewsArticle }>
  | Readonly<{ type: 'subgrid'; articles: NewsArticle[] }>;
export type MarketMetric = Readonly<{
  symbol: string;
  label: string;
  price?: number;
  changePercent?: number;
  sparkline: number[];
}>;
export type TrendingRepo = Readonly<{ name: string; url: string; description: string; language: string }>;
export type WeatherData = Readonly<{
  location?: string;
  temperature?: number;
  condition?: string;
  high?: number;
  low?: number;
  hourlyForecast: ReadonlyArray<{ time: string; temperature: number }>;
}>;
