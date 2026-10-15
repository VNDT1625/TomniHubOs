# Realtime Hub Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the top-level Realtime Hub surface in TomniHubOS featuring a 1-3-1 continuous news stream, sticky right-hand widgets (Weather, Market 2x2, Trending Repositories), an editorial article synthesis reader, a collapsed `⌥ Continued from` AI follow-up chat flow, and interactive focus views.

**Architecture:** A route-driven center page (`@renderer/pages/realtime`) in the existing Hub Shell, with 1–3–1 news rhythm. Instead of a dedicated sticky sidebar, user-configurable widgets are mounted in the existing HubRail `Realtime` tab. Clicking a widget or item navigates to `/realtime?view=<source>&item=<id>`. The Main process owns bounded public provider fetches and passes typed, cacheable results over an explicit preload IPC. Embedded streamed synthesis and citation-backed answers remain TARGET.

**Tech Stack:** React 18, TypeScript, Lucide/IconPark React icons, Vitest + React Testing Library (tested with `bun run test`).

**Spec:** `docs/platform/realtime-hub-design.md`

**Implementation checkpoint (2026-10-15): PARTIAL.** Realtime now has a real Main-owned, sender-checked public-content IPC for RSS, GitHub, Hugging Face, city weather and market snapshots; its sources are allowlisted, DNS-pinned, request-bounded and cached. The center is news-only; the global HubRail's Realtime tab owns configurable widgets, with add/remove/move/collapse and local persistence; widget/item clicks route to central collection/detail. `bun run test tests/unit/realtime` passed 14/14 and TypeScript passed. Actual packaged-app/network validation, true GitHub Trending, multi-source synthesis, inline AI agent, package widgets and rich market charts are NOT yet release proven. The original steps below are historical TARGET examples, notably their proposed mock providers, second sidebar and synthetic AI replies are superseded by secure production boundaries. No commits/pushes were performed in the shared dirty worktree.

### Execution review — 2026-10-16 (code and tests, not release proof)

The 2026-10-09 step-by-step snippets below are **historical**: they propose a mock feed, standalone sticky sidebar and fabricated AI response, all superseded by the safe Main-owned production architecture. These example checkboxes must **not** be checked by restoring fake data or bypassing agent permissions. This table is the authoritative current checkpoint for the seven task goals.

| Task | Status | Acceptance evidence / remaining dependency |
|---|---|---|
| 1. Navigation, shell and i18n | **CURRENT** | `Router.tsx`, `HubSidebar.tsx`, `HubShell.tsx`, localized `guid.json`; reachable `/realtime` |
| 2. Typed public data providers | **PARTIAL** | Typed IPC and sender admission in `realtimeContentBridge.ts` + preload; RSS, GitHub recent-by-stars, Hugging Face models/datasets/spaces, Open-Meteo hourly and Yahoo historical market readings, cache and bounded manual refresh. Packaged live-provider smoke, true GitHub Trending and user-authorized custom providers remain unproven |
| 3. 1–3–1 feed and widgets | **CURRENT** | `RealtimeNewsFeed.tsx`, `RealtimeWidgetRail.tsx`, `widgetRegistry.ts`, scoped global CSS. Shared HubRail replaces the deprecated nested sidebar; 2×2 Market, Weather hourly preview, GitHub metadata, persistent add/remove/move/collapse |
| 4. Editorial article reader | **PARTIAL** | `RealtimeArticleView.tsx` plus gated `REALTIME_ARTICLE_CHANNEL`: only a previously returned articleId may request bounded HTML extraction, rendered as plain text; article URLs and source labels are preserved. Publisher access may fail; cross-source verification and genuinely synthesized citations remain TARGET |
| 5. Governed AI follow-up | **PARTIAL / BLOCKED** | `ArticleChatThread.tsx` handles Continued from / multi-turn questions; `/guid` handoff passes bounded article paragraphs, title, excerpt, HTTPS source links and questions. True embedded conversation + citation-backed model output require reuse of Hub's governed user/model/chat session pipeline; fabricating a response is expressly forbidden |
| 6. Market/GitHub/HF/weather focus | **PARTIAL** | `RealtimeSourceFocusView.tsx`, `RealtimeHistoryChart.tsx` provide provider-derived price line graph for 1D/1W/1M/1Y/5Y, actual provider data + no-history fallback, Github language/search/fork metadata, Hugging Face category tabs and weather hourly. OHLCV, richer repo metrics and officially sourced Trending rank remain TARGET |
| 7. Master route/controller | **CURRENT** | `index.tsx` transitions, article scroll restoration, widget drilldowns, safe Browser navigation, Back from focus to News Feed and Weather city sync |

**Automated evidence:** `bun run test tests/unit/realtime/` passed 25/25 after adding dataset/space and GitHub filters; `bunx tsc --noEmit` passed. The Main article/market/weather parsing, request rejection, cache/refetch and DOM transitions are covered by `tests/unit/realtime`. These fixtures **do not** prove full packaged Electron/network compatibility. `node scripts/check-i18n.js` fails on pre-existing missing translations across multiple unrelated locales; it is not a Realtime release pass. This checkout contains unrelated concurrent edits; no broad commit or revert may include them.

## Global Constraints

- Navigation ID must be `realtime`, path `/realtime`, icon `@icon-park/react` `Lightning` (or `Radar`).
- UI theme must use Tomni dark design tokens (`#0d0d0f`, `#141416`, `#18181b`, `#222226`, `#27272a`, `#f4f4f5`, `#a1a1aa`, `#71717a`).
- News feed must follow the exact `1 - 3 - 1 - 3` alternating rhythm (1 major Hero card → 3-column sub-cards grid → 1 major Hero card).
- CURRENT: Widgets live inside the resizable global HubRail Realtime tab; do not create a second sticky sidebar inside the news feed.
- CURRENT: GitHub shows public API repositories created during the recent 14-day window sorted by stars, not an official trending result. TARGET: add richer repo visuals and accurate official trending semantics.
- Article Synthesis Reader must match Image #3: back button `← Quay lại Khám phá`, serif headline, inline citations (`retractionwatch +1`), source corroboration cards, and pinned bottom AI input.
- AI Chat Flow must match Image #4: submitting a question collapses article into `⌥ Continued from: [Title]`, displays `Sources [icons] 41 ›`, user message bubble, AI response with `⏱ Researched 3s` badge, formatted headings, inline citation pills (`finance.yahoo +2`), and persistent bottom follow-up input bar.
- Clicking external article links must route safely via TomniHubOS internal `/browser` route.
- All tests must pass via `bun run test <test-file>`.

## Review Focus

1. **Feed rhythm with uneven article counts:** When article count is not an exact multiple of 4, the feed must gracefully render remaining items without crashing or leaving blank grid columns.
2. **Scroll position preservation:** Navigating into an article reader and clicking `← Quay lại Khám phá` must restore the exact previous scroll position in the news feed.
3. **Empty / offline provider fallbacks:** If news, market, or trending repos network calls fail or return empty arrays, UI must render elegant fallback empty states with retry triggers instead of blank screens.
4. **Chat context injection:** Asking a follow-up question in the chat flow must retain the article's title, snippet, and source URLs in the conversation context.
5. **Keyboard accessibility in chat input:** Pressing Enter in the bottom chat bar must submit the question, while Shift+Enter inserts a newline.

---

### Task 1: Navigation, Shell Integration, and i18n

**Files:**
- Modify: `packages/desktop/src/renderer/components/layout/Sider/index.tsx`
- Modify: `packages/desktop/src/renderer/components/layout/Router.tsx`
- Modify: `packages/desktop/src/renderer/services/i18n/locales/vi-VN/guid.json`
- Modify: `packages/desktop/src/renderer/services/i18n/locales/en-US/guid.json`
- Test: `tests/unit/realtime/navigation.test.ts`

**Interfaces:**
- Consumes: `@renderer/components/layout/Sider/index.tsx` `PRIMARY_NAV`
- Produces: Primary navigation item `{ id: 'realtime', key: 'guid.hubHome.shell.nav.realtime', path: '/realtime', Icon: Lightning }` and route `/realtime` mapped to `@renderer/pages/realtime`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/realtime/navigation.test.ts
import { describe, it, expect } from 'vitest';
import viGuid from '../../../packages/desktop/src/renderer/services/i18n/locales/vi-VN/guid.json';
import enGuid from '../../../packages/desktop/src/renderer/services/i18n/locales/en-US/guid.json';

describe('Realtime Navigation & i18n Integration', () => {
  it('has realtime i18n keys in both Vietnamese and English', () => {
    expect(viGuid.hubHome.shell.nav.realtime).toBe('Thời gian thực');
    expect(enGuid.hubHome.shell.nav.realtime).toBe('Realtime');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/unit/realtime/navigation.test.ts`  
Expected: FAIL with undefined `realtime` key.

- [ ] **Step 3: Implement i18n keys, Sider entry, and Router mapping**

1. Add `"realtime": "Thời gian thực"` to `packages/desktop/src/renderer/services/i18n/locales/vi-VN/guid.json` under `hubHome.shell.nav`.
2. Add `"realtime": "Realtime"` to `packages/desktop/src/renderer/services/i18n/locales/en-US/guid.json` under `hubHome.shell.nav`.
3. In `packages/desktop/src/renderer/components/layout/Sider/index.tsx`, import `Lightning` from `@icon-park/react` and add `{ id: 'realtime', key: 'guid.hubHome.shell.nav.realtime', path: '/realtime', Icon: Lightning }` right after `home`.
4. In `packages/desktop/src/renderer/components/layout/Router.tsx`, add lazy import `const RealtimePage = React.lazy(() => import('@renderer/pages/realtime'));` and register `<Route path='/realtime' element={withRouteFallback(RealtimePage)} />`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/unit/realtime/navigation.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/components/layout/Sider/index.tsx packages/desktop/src/renderer/components/layout/Router.tsx packages/desktop/src/renderer/services/i18n/locales/vi-VN/guid.json packages/desktop/src/renderer/services/i18n/locales/en-US/guid.json tests/unit/realtime/navigation.test.ts
git commit -m "feat(realtime): add realtime navigation entry, routing, and i18n keys"
```

---

### Task 2: Realtime Types and Data Providers

**Files:**
- Create: `packages/desktop/src/renderer/pages/realtime/services/types.ts`
- Create: `packages/desktop/src/renderer/pages/realtime/services/newsProvider.ts`
- Create: `packages/desktop/src/renderer/pages/realtime/services/marketProvider.ts`
- Create: `packages/desktop/src/renderer/pages/realtime/services/repoProvider.ts`
- Create: `packages/desktop/src/renderer/pages/realtime/services/weatherProvider.ts`
- Test: `tests/unit/realtime/realtimeProviders.test.ts`

**Interfaces:**
- Consumes: None (independent domain services)
- Produces:
  - `NewsArticle`, `NewsFeedBlock` (`{ type: 'hero', article: NewsArticle } | { type: 'subgrid', articles: NewsArticle[] }`), `partitionArticlesIntoBlocks(articles: NewsArticle[]): NewsFeedBlock[]`
  - `MarketMetric`, `getMarketMetrics(): MarketMetric[]`
  - `TrendingRepo`, `getTrendingRepos(): TrendingRepo[]`
  - `WeatherData`, `getWeatherData(): WeatherData`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/realtime/realtimeProviders.test.ts
import { describe, it, expect } from 'vitest';
import { getNewsArticles, partitionArticlesIntoBlocks } from '../../../packages/desktop/src/renderer/pages/realtime/services/newsProvider';
import { getMarketMetrics } from '../../../packages/desktop/src/renderer/pages/realtime/services/marketProvider';
import { getTrendingRepos } from '../../../packages/desktop/src/renderer/pages/realtime/services/repoProvider';
import { getWeatherData } from '../../../packages/desktop/src/renderer/pages/realtime/services/weatherProvider';

describe('Realtime Data Providers', () => {
  it('partitions articles into alternating 1 - 3 - 1 blocks', () => {
    const articles = getNewsArticles();
    expect(articles.length).toBeGreaterThanOrEqual(5);
    const blocks = partitionArticlesIntoBlocks(articles);
    expect(blocks[0].type).toBe('hero');
    expect(blocks[1].type).toBe('subgrid');
    if (blocks[1].type === 'subgrid') {
      expect(blocks[1].articles.length).toBeLessThanOrEqual(3);
    }
  });

  it('provides 2x2 market metrics with sparklines', () => {
    const metrics = getMarketMetrics();
    expect(metrics.length).toBe(4);
    expect(metrics.map(m => m.symbol)).toEqual(['ES=F', 'NQ=F', 'BTC-USD', '^VIX']);
    metrics.forEach(m => {
      expect(m.sparkline.length).toBeGreaterThan(5);
    });
  });

  it('provides trending repositories with language and stars matching Image #2', () => {
    const repos = getTrendingRepos();
    expect(repos.length).toBeGreaterThanOrEqual(2);
    expect(repos[0].name).toContain('storytold/photocraft');
    expect(repos[0].language).toBe('Rust');
    expect(repos[0].languageColor).toBe('#dea584');
  });

  it('provides weather and hourly forecast', () => {
    const weather = getWeatherData();
    expect(weather.temperature).toBeDefined();
    expect(weather.hourlyForecast.length).toBeGreaterThanOrEqual(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/unit/realtime/realtimeProviders.test.ts`  
Expected: FAIL with module not found.

- [ ] **Step 3: Implement types and data providers**

1. Create `packages/desktop/src/renderer/pages/realtime/services/types.ts` defining `NewsArticle`, `NewsSourceCitation`, `NewsFeedBlock`, `MarketMetric`, `TrendingRepo`, `WeatherData`, and `HourlyForecast`.
2. Create `packages/desktop/src/renderer/pages/realtime/services/newsProvider.ts`:
   - Curated articles representing Image #1 and Image #3:
     - Hero 1: "OpenAI rút lại ba bài báo toán học do AI tạo ra vì lỗi dấu" (Image #1 hero).
     - Subgrid 1: "Chính phủ Mỹ dự kiến phạt gã khổng lồ viễn thông...", "Tại sao người Mỹ ghét nền kinh tế...", "Mưa giông kéo dài tại miền Trung...".
     - Hero 2: "Anthropic cập nhật chính sách sử dụng, cấm hành vi lạm dụng Claude" (Image #1 bottom card).
     - Subgrid 2: Tech & AI updates.
   - Implement `partitionArticlesIntoBlocks(articles: NewsArticle[]): NewsFeedBlock[]` following the `1 - 3 - 1 - 3` pattern.
3. Create `packages/desktop/src/renderer/pages/realtime/services/marketProvider.ts`:
   - Returns S&P Futures (`ES=F`), NASDAQ (`NQ=F`), Bitcoin (`BTC-USD`), VIX (`^VIX`) with current price, change percentage, positive/negative direction, and sparkline array.
4. Create `packages/desktop/src/renderer/pages/realtime/services/repoProvider.ts`:
   - Returns repositories matching Image #2: `storytold/photocraft` (Rust), `facebook/react` (TypeScript), `astral-sh/uv` (Rust), `ollama/ollama` (Go), `vllm-project/vllm` (Python).
5. Create `packages/desktop/src/renderer/pages/realtime/services/weatherProvider.ts`:
   - Returns current city ("Hà Nội"), temperature, high/low, condition ("Nhiều mây"), and 5-slot hourly forecast (`Bây giờ`, `15:00`, `16:00`, `17:00`, `18:00`).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/unit/realtime/realtimeProviders.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/pages/realtime/services/ tests/unit/realtime/realtimeProviders.test.ts
git commit -m "feat(realtime): implement realtime domain types and mock/web providers"
```

---

### Task 3: Continuous News Feed and Sticky Sidebar (`1 - 3 - 1` Layout)

**Files:**
- Create: `packages/desktop/src/renderer/pages/realtime/components/RealtimeHeroCard.tsx`
- Create: `packages/desktop/src/renderer/pages/realtime/components/RealtimeSubCardsGrid.tsx`
- Create: `packages/desktop/src/renderer/pages/realtime/widgets/WeatherWidget.tsx`
- Create: `packages/desktop/src/renderer/pages/realtime/widgets/MarketOutlookWidget.tsx`
- Create: `packages/desktop/src/renderer/pages/realtime/widgets/TrendingReposWidget.tsx`
- Create: `packages/desktop/src/renderer/pages/realtime/components/RealtimeStickySidebar.tsx`
- Create: `packages/desktop/src/renderer/pages/realtime/RealtimeNewsFeed.tsx`
- Test: `tests/unit/realtime/realtimeFeed.dom.test.tsx`

**Interfaces:**
- Consumes: `NewsFeedBlock`, `MarketMetric`, `TrendingRepo`, `WeatherData` from Task 2
- Produces: `RealtimeNewsFeed` component accepting `onSelectArticle(article: NewsArticle)`, `onOpenMarketFocus()`, and `onOpenRepoFocus()`.

- [ ] **Step 1: Write the failing DOM test**

```tsx
// tests/unit/realtime/realtimeFeed.dom.test.tsx
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RealtimeNewsFeed } from '../../../packages/desktop/src/renderer/pages/realtime/RealtimeNewsFeed';

describe('RealtimeNewsFeed Component', () => {
  it('renders hero story and sub-cards in 1-3-1 pattern', () => {
    const onSelectArticle = vi.fn();
    render(
      <RealtimeNewsFeed
        onSelectArticle={onSelectArticle}
        onOpenMarketFocus={vi.fn()}
        onOpenRepoFocus={vi.fn()}
      />
    );

    // Hero title is rendered
    expect(screen.getByText(/OpenAI rút lại ba bài báo toán học/i)).toBeInTheDocument();
    
    // Clicking hero card triggers onSelectArticle
    fireEvent.click(screen.getByText(/OpenAI rút lại ba bài báo toán học/i));
    expect(onSelectArticle).toHaveBeenCalled();

    // Sticky sidebar widgets are rendered
    expect(screen.getByText(/Triển vọng thị trường/i)).toBeInTheDocument();
    expect(screen.getByText(/Trending repositories/i)).toBeInTheDocument();
    expect(screen.getByText(/storytold\/photocraft/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/unit/realtime/realtimeFeed.dom.test.tsx`  
Expected: FAIL with component not found.

- [ ] **Step 3: Implement feed and widget components**

1. Implement `RealtimeHeroCard.tsx`:
   - Horizontal card with grid `1.15fr 1fr`, publisher tag, time badge, bold title, excerpt, source count indicator (`retractionwatch +1`), and featured thumbnail.
2. Implement `RealtimeSubCardsGrid.tsx`:
   - 3-column grid of sub-story cards with top image, 2-line clamped title, timestamp, source badge, heart/menu buttons.
3. Implement `WeatherWidget.tsx`:
   - Current temperature, city, condition text, high/low, and horizontal hourly forecast cards.
4. Implement `MarketOutlookWidget.tsx`:
   - Header with `Triển vọng thị trường ›` (calls `onOpenMarketFocus`), 2x2 grid (S&P, NASDAQ, Bitcoin, VIX) with SVG mini sparkline and percentage color (green/red).
5. Implement `TrendingReposWidget.tsx`:
   - Header with `📈 Trending repositories · See more` (calls `onOpenRepoFocus`).
   - Repository items matching Image #2: repo icon/avatar, `owner/repo` link, Star button, description snippet, colored language dot (e.g. `🟠 Rust`), and star count.
6. Implement `RealtimeStickySidebar.tsx`:
   - Container with `position: sticky; top: 16px; display: flex; flex-direction: column; gap: 16px; width: 370px;` containing the three widgets.
7. Implement `RealtimeNewsFeed.tsx`:
   - Layout: Two-column grid (`1fr 370px`, gap `24px`).
   - Left column: Map over `partitionArticlesIntoBlocks(articles)` rendering `RealtimeHeroCard` or `RealtimeSubCardsGrid`.
   - Right column: `RealtimeStickySidebar`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/unit/realtime/realtimeFeed.dom.test.tsx`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/pages/realtime/components/ packages/desktop/src/renderer/pages/realtime/widgets/ packages/desktop/src/renderer/pages/realtime/RealtimeNewsFeed.tsx tests/unit/realtime/realtimeFeed.dom.test.tsx
git commit -m "feat(realtime): implement 1-3-1 news stream and sticky widgets sidebar"
```

---

### Task 4: In-Depth Article Synthesis Reader (Image #3)

**Files:**
- Create: `packages/desktop/src/renderer/pages/realtime/article/ArticleFollowUpInput.tsx`
- Create: `packages/desktop/src/renderer/pages/realtime/article/RealtimeArticleView.tsx`
- Test: `tests/unit/realtime/realtimeArticleView.dom.test.tsx`

**Interfaces:**
- Consumes: `NewsArticle` from Task 2
- Produces: `RealtimeArticleView` accepting `article: NewsArticle`, `onBack(): void`, `onStartChat(initialQuestion: string): void`.

- [ ] **Step 1: Write the failing DOM test**

```tsx
// tests/unit/realtime/realtimeArticleView.dom.test.tsx
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RealtimeArticleView } from '../../../packages/desktop/src/renderer/pages/realtime/article/RealtimeArticleView';
import { getNewsArticles } from '../../../packages/desktop/src/renderer/pages/realtime/services/newsProvider';

describe('RealtimeArticleView (Image #3)', () => {
  it('renders editorial article, inline citations, sources carousel, and triggers back/chat actions', () => {
    const article = getNewsArticles()[0];
    const onBack = vi.fn();
    const onStartChat = vi.fn();

    render(
      <RealtimeArticleView
        article={article}
        onBack={onBack}
        onStartChat={onStartChat}
      />
    );

    // Back link is visible
    expect(screen.getByText(/Quay lại Khám phá/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Quay lại Khám phá/i));
    expect(onBack).toHaveBeenCalled();

    // Headline & inline citations
    expect(screen.getByText(article.title)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Đặt câu hỏi tiếp theo/i)).toBeInTheDocument();

    // Type a question and submit
    const input = screen.getByPlaceholderText(/Đặt câu hỏi tiếp theo/i);
    fireEvent.change(input, { target: { value: 'nói rõ hơn xem' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(onStartChat).toHaveBeenCalledWith('nói rõ hơn xem');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/unit/realtime/realtimeArticleView.dom.test.tsx`  
Expected: FAIL with component not found.

- [ ] **Step 3: Implement Article Synthesis Reader**

1. Create `ArticleFollowUpInput.tsx`:
   - Floating input container at the bottom with pills `🔍 Search ⌄`, `💻 Computer`, `Model ⌄`, audio button, and submit arrow button. Handles Enter to submit.
2. Create `RealtimeArticleView.tsx`:
   - Top Bar: `← Quay lại Khám phá` button (calls `onBack`), Share action `↗ Chia sẻ`, Menu `⋯`.
   - Editorial Header: Title, published date, author/source badges.
   - Body typography: 16px body, 1.75 line height, inline source citations (`retractionwatch +1`, `unite +1`).
   - Multi-source Carousel: Cards showing corroborating source cards (`retractionwatch`, `theatlantic`, `implicator`, `aiweekly`).
   - Bottom Pinned AI Input: Renders `ArticleFollowUpInput` with `onSubmit={onStartChat}`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/unit/realtime/realtimeArticleView.dom.test.tsx`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/pages/realtime/article/ tests/unit/realtime/realtimeArticleView.dom.test.tsx
git commit -m "feat(realtime): implement article synthesis reader view with citations and floating input"
```

---

### Task 5: AI Follow-Up Chat Flow with Collapsible Reference (Image #4)

**Files:**
- Create: `packages/desktop/src/renderer/pages/realtime/article/ArticleChatThread.tsx`
- Test: `tests/unit/realtime/articleChatThread.dom.test.tsx`

**Interfaces:**
- Consumes: `NewsArticle`, `ChatMessage`
- Produces: `ArticleChatThread` accepting `article: NewsArticle`, `initialQuestion: string`, `onBack(): void`.

- [ ] **Step 1: Write the failing DOM test**

```tsx
// tests/unit/realtime/articleChatThread.dom.test.tsx
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ArticleChatThread } from '../../../packages/desktop/src/renderer/pages/realtime/article/ArticleChatThread';
import { getNewsArticles } from '../../../packages/desktop/src/renderer/pages/realtime/services/newsProvider';

describe('ArticleChatThread (Image #4)', () => {
  it('collapses article into Continued from card and renders user bubble and AI answer', () => {
    const article = getNewsArticles()[0];
    const onBack = vi.fn();

    render(
      <ArticleChatThread
        article={article}
        initialQuestion="nói rõ hơn xem"
        onBack={onBack}
      />
    );

    // Collapsed Continued from card
    expect(screen.getByText(/Continued from/i)).toBeInTheDocument();
    expect(screen.getByText(article.title)).toBeInTheDocument();

    // User question bubble
    expect(screen.getByText('nói rõ hơn xem')).toBeInTheDocument();

    // AI answer with Researched 3s badge and citation pills
    expect(screen.getByText(/Researched 3s/i)).toBeInTheDocument();
    expect(screen.getByText(/Run rate/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/unit/realtime/articleChatThread.dom.test.tsx`  
Expected: FAIL with component not found.

- [ ] **Step 3: Implement ArticleChatThread matching Image #4**

1. Create `ArticleChatThread.tsx`:
   - Top Bar: `← Quay lại Khám phá`, `Sources [icons] 41 ›` badge pill, `↗ Chia sẻ`, `⋯`.
   - Top Reference Card: `⌥ Continued from: [Article Title]`. Clicking this can expand/collapse back into full article or jump to top.
   - User Message Bubble: Align right, background `#27272a`, rounded corners, text of the submitted question.
   - AI Response Section:
     - Badge: `⏱ Researched 3s`
     - Synthetic analytical text with bold definitions, subheadings (e.g. `“Run rate” là gì?`), and inline citation pills (`finance.yahoo +2`, `finance.yahoo +1`).
   - Sticky bottom `ArticleFollowUpInput` allowing ongoing multi-turn questions. Each new question appends to the conversation messages array.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/unit/realtime/articleChatThread.dom.test.tsx`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/pages/realtime/article/ArticleChatThread.tsx tests/unit/realtime/articleChatThread.dom.test.tsx
git commit -m "feat(realtime): implement collapsed continued-from chat thread matching image #4"
```

---

### Task 6: Market and Trending Repositories Expanded Focus Views

**Files:**
- Create: `packages/desktop/src/renderer/pages/realtime/focus/MarketFocusView.tsx`
- Create: `packages/desktop/src/renderer/pages/realtime/focus/TrendingReposFocusView.tsx`
- Test: `tests/unit/realtime/realtimeFocusViews.dom.test.tsx`

**Interfaces:**
- Consumes: `MarketMetric`, `TrendingRepo` from Task 2
- Produces: `MarketFocusView` and `TrendingReposFocusView` with `onBack(): void`.

- [ ] **Step 1: Write the failing DOM test**

```tsx
// tests/unit/realtime/realtimeFocusViews.dom.test.tsx
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MarketFocusView } from '../../../packages/desktop/src/renderer/pages/realtime/focus/MarketFocusView';
import { TrendingReposFocusView } from '../../../packages/desktop/src/renderer/pages/realtime/focus/TrendingReposFocusView';

describe('Realtime Focus Views', () => {
  it('renders MarketFocusView with interactive timeframe tabs and stats', () => {
    const onBack = vi.fn();
    render(<MarketFocusView onBack={onBack} />);

    expect(screen.getByText(/Chi tiết Thị trường Tài chính/i)).toBeInTheDocument();
    expect(screen.getByText('1D')).toBeInTheDocument();
    expect(screen.getByText('1W')).toBeInTheDocument();

    fireEvent.click(screen.getByText(/Quay lại/i));
    expect(onBack).toHaveBeenCalled();
  });

  it('renders TrendingReposFocusView with language filters and repositories list', () => {
    const onBack = vi.fn();
    render(<TrendingReposFocusView onBack={onBack} />);

    expect(screen.getByText(/Danh mục Repositories Thịnh hành/i)).toBeInTheDocument();
    expect(screen.getByText(/storytold\/photocraft/i)).toBeInTheDocument();
    expect(screen.getByText('Rust')).toBeInTheDocument();

    fireEvent.click(screen.getByText(/Quay lại/i));
    expect(onBack).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/unit/realtime/realtimeFocusViews.dom.test.tsx`  
Expected: FAIL with components not found.

- [ ] **Step 3: Implement Focus Views**

1. Create `MarketFocusView.tsx`:
   - Top bar with back button `← Quay lại`.
   - Timeframe selector buttons (`1D`, `1W`, `1M`, `1Y`, `ALL`).
   - Main interactive SVG chart with gradient area fill.
   - Grid of detailed market stats (Open, High, Low, 52-Wk High, 52-Wk Low, Volume).
   - Watchlist table listing S&P Futures, NASDAQ, Bitcoin, VIX, Gold, Crude Oil with 24h change and sparkline.
2. Create `TrendingReposFocusView.tsx`:
   - Top bar with back button `← Quay lại`.
   - Language filter pills (`Tất cả`, `Rust`, `Python`, `TypeScript`, `Go`, `C++`).
   - Search input to filter repositories by name or topic.
   - Comprehensive repository cards with owner avatar, description, stars gained today, fork count, and direct link button (`Mở trong Browser`).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test tests/unit/realtime/realtimeFocusViews.dom.test.tsx`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/pages/realtime/focus/ tests/unit/realtime/realtimeFocusViews.dom.test.tsx
git commit -m "feat(realtime): implement expanded market outlook and trending repos focus views"
```

---

### Task 7: Master Realtime Page Controller & End-to-End Integration

**Files:**
- Create: `packages/desktop/src/renderer/pages/realtime/index.tsx`
- Test: `tests/unit/realtime/realtimePageController.dom.test.tsx`

**Interfaces:**
- Consumes: `RealtimeNewsFeed`, `RealtimeArticleView`, `ArticleChatThread`, `MarketFocusView`, `TrendingReposFocusView`
- Produces: Default export `RealtimePage` for `@renderer/pages/realtime`.

- [ ] **Step 1: Write the failing DOM test**

```tsx
// tests/unit/realtime/realtimePageController.dom.test.tsx
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RealtimePage from '../../../packages/desktop/src/renderer/pages/realtime/index';

describe('RealtimePage Master Controller', () => {
  it('transitions between feed, article view, chat thread, and back to feed', () => {
    render(<RealtimePage />);

    // Initially in Feed view
    expect(screen.getByText(/OpenAI rút lại ba bài báo toán học/i)).toBeInTheDocument();

    // Click news article -> opens Article View
    fireEvent.click(screen.getByText(/OpenAI rút lại ba bài báo toán học/i));
    expect(screen.getByText(/Quay lại Khám phá/i)).toBeInTheDocument();

    // Ask a question -> transitions to Image #4 Chat Thread
    const input = screen.getByPlaceholderText(/Đặt câu hỏi tiếp theo/i);
    fireEvent.change(input, { target: { value: 'giải thích thêm' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    // Collapsed card appears
    expect(screen.getByText(/Continued from/i)).toBeInTheDocument();
    expect(screen.getByText('giải thích thêm')).toBeInTheDocument();

    // Click back -> returns to Feed
    fireEvent.click(screen.getByText(/Quay lại Khám phá/i));
    expect(screen.getByText(/OpenAI rút lại ba bài báo toán học/i)).toBeInTheDocument();
  });

  it('navigates to market focus view and back', () => {
    render(<RealtimePage />);

    fireEvent.click(screen.getByText(/Triển vọng thị trường/i));
    expect(screen.getByText(/Chi tiết Thị trường Tài chính/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText(/Quay lại/i));
    expect(screen.getByText(/Triển vọng thị trường/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/unit/realtime/realtimePageController.dom.test.tsx`  
Expected: FAIL with module not found.

- [ ] **Step 3: Implement RealtimePage controller**

1. Create `packages/desktop/src/renderer/pages/realtime/index.tsx`:
   - State: `activeView: 'feed' | 'article' | 'chat' | 'market-focus' | 'repo-focus'`.
   - State: `selectedArticle: NewsArticle | null`.
   - State: `initialChatQuestion: string`.
   - Maintain scroll position on transition out of feed, restore on `onBack`.
   - Switch statement rendering:
     - `'feed'`: `<RealtimeNewsFeed onSelectArticle={...} onOpenMarketFocus={...} onOpenRepoFocus={...} />`
     - `'article'`: `<RealtimeArticleView article={selectedArticle!} onBack={...} onStartChat={(q) => { setInitialChatQuestion(q); setActiveView('chat'); }} />`
     - `'chat'`: `<ArticleChatThread article={selectedArticle!} initialQuestion={initialChatQuestion} onBack={...} />`
     - `'market-focus'`: `<MarketFocusView onBack={...} />`
     - `'repo-focus'`: `<TrendingReposFocusView onBack={...} />`

- [ ] **Step 4: Run all Realtime test suites to verify full pass**

Run: `bun run test tests/unit/realtime/`  
Expected: All test suites PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/pages/realtime/index.tsx tests/unit/realtime/realtimePageController.dom.test.tsx
git commit -m "feat(realtime): implement master page controller and full view transitions"
```
