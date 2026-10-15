import type { NewsArticle, NewsFeedBlock } from './types';

/** Editorial examples only: not claimed to be current news or corroborated reports. */
const SAMPLES = [
  {
    id: 'web-standards',
    category: 'Technology',
    url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP',
    label: 'MDN Web Docs',
    en: [
      'How browsers communicate over HTTP',
      'An introduction to how requests, responses and status codes work on the web.',
    ],
    vi: [
      'HTTP hoạt động như thế nào?',
      'Tìm hiểu cách trình duyệt gửi yêu cầu, nhận phản hồi và sử dụng mã trạng thái.',
    ],
  },
  {
    id: 'typescript',
    category: 'Development',
    url: 'https://www.typescriptlang.org/docs/',
    label: 'TypeScript Docs',
    en: ['Getting started with TypeScript', 'Explore static typing and the TypeScript handbook.'],
    vi: ['Bắt đầu với TypeScript', 'Tổng quan hệ thống kiểu dữ liệu và tài liệu chính thức của TypeScript.'],
  },
  {
    id: 'react',
    category: 'Development',
    url: 'https://react.dev/learn',
    label: 'React Docs',
    en: ['Building interfaces with React', 'Read the official guide to components and application state.'],
    vi: ['Xây dựng giao diện với React', 'Khám phá hướng dẫn chính thức về component và state.'],
  },
  {
    id: 'fetch',
    category: 'Technology',
    url: 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API',
    label: 'MDN Web Docs',
    en: ['Working with the Fetch API', 'Understand browser requests and asynchronous response handling.'],
    vi: ['Làm việc với Fetch API', 'Tìm hiểu về yêu cầu mạng và xử lý phản hồi bất đồng bộ.'],
  },
  {
    id: 'accessibility',
    category: 'Design',
    url: 'https://www.w3.org/WAI/fundamentals/accessibility-intro/',
    label: 'W3C WAI',
    en: ['An introduction to web accessibility', 'Learn why inclusive interactions and readable content matter.'],
    vi: ['Giới thiệu về khả năng truy cập web', 'Tìm hiểu nguyên tắc thiết kế giao diện dễ tiếp cận.'],
  },
  {
    id: 'github-api',
    category: 'Development',
    url: 'https://docs.github.com/en/rest',
    label: 'GitHub Docs',
    en: ['Exploring the GitHub REST API', 'Official documentation for repository metadata and API access.'],
    vi: ['Tìm hiểu GitHub REST API', 'Tài liệu chính thức về metadata repository và truy cập API.'],
  },
  {
    id: 'rss',
    category: 'Technology',
    url: 'https://www.rssboard.org/rss-specification',
    label: 'RSS Advisory Board',
    en: ['How RSS feeds are structured', 'The RSS specification explains feed channels and article entries.'],
    vi: ['Cấu trúc nguồn tin RSS', 'Đọc đặc tả RSS về kênh tin và mục nội dung.'],
  },
  {
    id: 'web-security',
    category: 'Security',
    url: 'https://developer.mozilla.org/en-US/docs/Web/Security',
    label: 'MDN Web Docs',
    en: ['Web security fundamentals', 'Learn about the browser security model and best practices.'],
    vi: ['Kiến thức nền tảng về bảo mật web', 'Tìm hiểu mô hình bảo mật trình duyệt và các thực hành an toàn.'],
  },
] as const;

export const getNewsArticles = (language: string = 'vi'): NewsArticle[] =>
  SAMPLES.map((sample) => {
    const [title, excerpt] = language.startsWith('vi') ? sample.vi : sample.en;
    return {
      id: sample.id,
      title,
      excerpt,
      body: [excerpt],
      category: sample.category,
      sources: [{ label: sample.label, url: sample.url }],
      isDemo: true,
    };
  });

/** Preserve the 1 hero / up to 3 subcards rhythm with no empty remainder groups. */
export function partitionArticlesIntoBlocks(articles: readonly NewsArticle[]): NewsFeedBlock[] {
  const blocks: NewsFeedBlock[] = [];
  for (let index = 0; index < articles.length; ) {
    blocks.push({ type: 'hero', article: articles[index] });
    index += 1;
    if (index < articles.length) {
      blocks.push({ type: 'subgrid', articles: articles.slice(index, index + 3) });
      index += 3;
    }
  }
  return blocks;
}
