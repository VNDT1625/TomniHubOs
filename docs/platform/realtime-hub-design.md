# Canonical Architecture Design: Realtime Hub Tab in TomniHubOS

**Document ID:** `docs/platform/realtime-hub-design.md`  
**Status:** PARTIAL (customizable HubRail widgets, Main-owned public provider fetch and drilldowns CURRENT; in-page agent answers, full news synthesis, package widgets and runtime release verification TARGET)    
**Date:** 2026-10-09  
**Authors:** Tomny Architecture & Runtime Team  
**Related Topics:** [Chat Pipeline](../core/chat-pipeline.md), [AI Runtime](../core/ai-runtime.md), [Tool Vocabulary](../core/tool-vocabulary.md), [Current Architecture](../architecture/current.md)

---

## 1. Executive Summary & Vision

TomniHubOS is evolving from a pure agent workspace into a unified **Agentic Operating System**. Users require real-time situational awareness (breaking news, financial markets, trending tech repositories, and local weather) without leaving their primary OS shell.

The **Realtime Hub** is a dedicated top-level surface accessible via the sidebar navigation (`/realtime`). It provides:
1. **Focus on Real-time News Stream:** A continuous, rhythmic river of news cards structured in a repeating `1 - 3 - 1 - 3` pattern (1 Major Hero Story Card → 3-Column Sub-Story Grid → 1 Major Hero Story Card...).
2. **Customizable shared right rail:** The existing HubRail offers a Realtime tab (alongside Explorer), independently housing user-configurable Weather, Market, GitHub, and Hugging Face widgets. Realtime does not mount another right-hand sidebar inside the center page.
3. **In-depth Synthesis Reader View:** Clicking any news article opens an ad-free synthesis reader with inline source citations and multi-source verification cards.
4. **Agentic Follow-up Chat with Collapsible Reference Card:** Once a user asks a follow-up question, the article collapses into a compact `⌥ Continued from: [Title]` card, transitioning seamlessly into an AI-powered conversational thread backed by the article's context and live citations.
5. **Widget Drill-down (Focus View):** Clicking "Triển vọng thị trường ›" or "Trending repositories · See more" expands the respective widget into a full-width focus view with detailed charts and lists.

---

## 2. Verified Current Codebase Baseline

| Area | File Path | Current Status |
| :--- | :--- | :--- |
| **Sidebar Navigation** | `packages/desktop/src/renderer/components/layout/Sider/index.tsx` | **CURRENT:** `PRIMARY_NAV` array contains `home`, `store`, `history`, `company`, `management`. |
| **HashRouter** | `packages/desktop/src/renderer/components/layout/Router.tsx` | **CURRENT:** Maps authenticated routes (`/guid`, `/store`, `/history`, `/browser`, etc.) under `ProtectedLayout`. |
| **Hub Shell Guard** | `packages/desktop/src/renderer/components/layout/hubRoutes.ts` | **CURRENT:** `isHubPagePath(path)` returns true for all authenticated routes (`!isShellFreePath`). |
| **Egress Security** | `packages/desktop/src/process/services/security/newsEgressAuthority.ts` | **CURRENT:** Declares `NewsEgressOperation` (`'feed-validation' \| 'github-trending' \| 'market-data' \| 'rss-refresh' \| 'weather' \| 'bluesky-realtime'`). |
| **Localization** | `packages/desktop/src/renderer/services/i18n/locales/{en-US,vi-VN}/news.json` | **CURRENT:** Baseline translations exist for news categories, weather, markets, and unread counts. |

---

### Implementation evidence (2026-10-15, expanded 2026-10-16)

- **CURRENT — center and rail:** `components/layout/{Sider/index.tsx,Router.tsx}` registers `/realtime`. `renderer/pages/realtime/index.tsx` / `RealtimeNewsFeed.tsx` render a 1–3–1 RSS news feed without a second sidebar; `HubHome/HubRail.tsx` displays `widgets/RealtimeWidgetRail.tsx` via the shared Realtime tab. The rail preserves Explorer and supports adding/removing/reordering/collapsing built-in widgets and choosing one of three weather cities. Config is validated and persisted via `widgets/widgetRegistry.ts`. Clicking widget headers or items routes to `/realtime?view=<source>&item=<id>` and `focus/RealtimeSourceFocusView.tsx`; the rail may also be selected from other Hub routes.
- **CURRENT — real provider integration and security seam:** `common/types/platform/realtimeContent.ts`, preload `main.ts`, `process/services/realtime/realtimeContentBridge.ts`, and `renderer/pages/realtime/services/realtimeClient.ts` expose a Main-owned read-only typed IPC. Main verifies the caller, restricts sources and cities, gates static outbound providers through `requireNewsEgressAdmission`, uses an existing DNS-pinned bounded HTTPS fetch, caches responses, and returns explicit failure states instead of made-up readings. RSS: Hacker News RSS; GitHub: newly created repositories by stars (NOT GitHub's official Trending ranking); Hugging Face: model download ranking; weather: Open-Meteo for three supported cities; market: public Yahoo Finance index/crypto snapshots when available. The old static provider modules remain for earlier tests but are no longer used on the active `/realtime` route.
- **PARTIAL — AI:** The inline question composer retains article title, summary, HTTPS references and user questions, then hands an editable bounded draft to the existing `/guid` agent flow. It does not fabricate an AI response; an embedded model-run and citation-backed multi-turn thread are TARGET.
- **PARTIAL — live data/quality:** Transport, serialization, denial behavior and one simulated renderer-to-Main flow have unit/DOM test coverage, but actual public network access in a packaged Electron build has NOT been demonstrated. Public APIs can reject/rate-limit requests; results use timed refresh (not server push). Market chart history, weather auto-location, user-selected custom sources, authentic GitHub Trending ranks, article extraction and cross-source synthesis, account-bound network consent and package-provided widget SDK remain TARGET. Browser opens use the existing internal `/browser` navigation. No renderer direct network calls are added.
- **Verification (this iteration, 2026-10-15):** `bunx tsc --noEmit` passed; targeted oxlint passed; `bun run test tests/unit/realtime` passed 14/14 across `providers`, `realtimeContentBridge`, and `realtimePage.dom` tests. Format and broader repository/i18n gates require separate verification. Existing shared worktree is heavily modified by concurrent tasks.

**Addendum (2026-10-16):** The Main-only public RSS source now aggregates Hacker News, BBC World and The Guardian with per-feed failure isolation, origin labels, HTTPS-only destinations, URL de-duplication and time ordering. The public article reader uses a new `REALTIME_ARTICLE_CHANNEL` (typed preload/IPC) to retrieve a publisher's article only when its id was returned by the approved live RSS feed, within a five-minute window. HTML is stripped to bounded plain-text paragraphs, cached, and can supply source-grounded context for the existing Hub Agent flow. This is publisher article extraction, **not** synthesized corroborated news. Yahoo Finance provider data now includes actual timed closes for 1D/1W/1M/1Y/5Y line charts; Open-Meteo includes up to eight upcoming hourly readings. Market widget uses an actual 2×2 quote grid; GitHub focus filters by provider-returned language and shows available fork counts. Hugging Face focus offers distinct Models, Datasets and Spaces public API collections. Forced refresh goes through Main and has a minimum 30-second interval per source. The implementation and 25/25 scoped tests are in `packages/desktop/src/process/services/realtime/`, `packages/desktop/src/renderer/pages/realtime/` and `tests/unit/realtime/`. These are **CURRENT code/tests** but **PARTIAL release evidence**; no packaged Electron live proof, governed inline chat, multi-source corroboration, official GitHub Trending rank or package widget SDK is claimed.

The following sections contain the **TARGET** product contract except where CURRENT features are explicitly identified. In particular, network integration is not proof of a production-ready continuous news or AI-analysis service.

## 3. UI/UX Layout Specification

### 3.1 Sidebar Navigation Integration
- Add `{ id: 'realtime', key: 'guid.hubHome.shell.nav.realtime', path: '/realtime', Icon: Lightning }` (or `@icon-park/react` `Radar` / `Lightning`) into `PRIMARY_NAV`.
- Active state matches `/realtime` or `/realtime/*`.

### 3.2 Main Feed Layout (`1 - 3 - 1` Rhythm)
- **CURRENT container:** The center news feed uses the full center width. Widget cards are children of the shared, resizable HubRail's `Realtime` tab (not a nested sticky sidebar). The previous fixed two-column plan is superseded.
- **Left Column (News Stream):**
  - **Hero Card (1):**
    - Grid `1.15fr 1fr` (Headline, published time, excerpt snippet, source count badge, like/menu buttons on the left; featured thumbnail on the right).
  - **Sub-cards Grid (3):**
    - 3-column equal grid. Top image (height ~125-140px), bold headline (2 lines clamped), source count badge, heart/share buttons.
  - **Subsequent Blocks:** Hero Card (1) → Sub-cards (3) → Hero Card (1)... scrolling smoothly.
- **TARGET rich-widget details inside the shared rail:**
  - The shared HubRail scrolls independently and the user can configure built-in cards:
    1. **Weather Widget:** Current temp, location, cloud condition, high/low, and 5-interval forecast with weather icons.
        2. **Market Outlook Widget:** Header opens the central market list; a 2×2 futures/crypto/VIX watchlist with historical sparklines is still TARGET. Current snapshots are index/crypto quotes, not futures.
    3. **Trending Repositories Widget (Image #2):** Header with `📈 Trending repositories · See more`. List of top GitHub repos with avatar, `owner/repo`, Star button, description, language dot indicator (e.g., `🟠 Rust`), and star count.

### 3.3 Article Synthesis Reader View (Image #3)
- Triggered by clicking any news card in the feed.
- **Top Bar:** Back button `← Quay lại Khám phá` (returns to news feed at exact scroll position), Share button, Menu.
- **Article Header & Body:** Editorial typography (serif headline, 16px body, 1.75 line height).
- **Inline Citations:** Pill badges such as `retractionwatch +1`, `unite +1` linking to underlying source fragments.
- **Multi-source Carousel:** Source cards (`retractionwatch`, `theatlantic`, `implicator`, `aiweekly`) showing corroborating reports.
- **Bottom Pinned AI Input:** Floating bar with placeholder *"Đặt câu hỏi tiếp theo..."*, search toggle, model selector, and submit action.

### 3.4 Threaded AI Chat Flow (Image #4)
- Triggered when the user submits a question from the article view.
- **Context Card:** The full article collapses into a top reference card: `⌥ Continued from: [Article Headline]`.
- **Source Count:** Top right pill indicator `Sources [icons] 41 ›` opening the sources drawer.
- **Conversation Stream:** User message bubble on the right; AI response on the left featuring:
  - Latency/Thinking badge: `⏱ Researched 3s`
  - Formatted analytical synthesis with markdown, subheadings, and inline clickable citation pills (`finance.yahoo +2`).
- **Continuous Thread:** Input bar remains pinned at the bottom for multi-turn inquiry.

### 3.5 Focus Drill-down Views
- **Market Focus View:** Large interactive candlestick/line chart, timeframe selector (1D, 1W, 1M, 1Y, ALL), market stats (Open, High, Low, Volume), and expandable watchlist.
- **Trending Repositories Focus View:** Full table of top trending repositories with language filtering (Rust, Python, TypeScript, Go), stars gained today, and direct open buttons.

---

## 4. Technical Architecture & Component Tree

```
packages/desktop/src/renderer/pages/realtime/
├── index.tsx                         # Master page controller & view router (feed | article | market | repo)
├── RealtimeNewsFeed.tsx              # Continuous 1 - 3 - 1 news stream
├── components/
│   ├── RealtimeHeroCard.tsx          # Large hero story card
│   ├── RealtimeSubCardsGrid.tsx      # 3-column sub-cards component
│   └── RealtimeStickySidebar.tsx     # Sticky container for right widgets
├── widgets/
│   ├── WeatherWidget.tsx             # Real-time weather widget
│   ├── MarketOutlookWidget.tsx       # 2x2 market grid with sparklines
│   └── TrendingReposWidget.tsx       # Trending repositories matching Image #2
├── article/
│   ├── RealtimeArticleView.tsx       # Synthesis reader matching Image #3
│   ├── ArticleChatThread.tsx         # Threaded conversation matching Image #4
│   └── ArticleFollowUpInput.tsx      # Bottom floating AI chat bar
├── focus/
│   ├── MarketFocusView.tsx           # Expanded interactive market chart & metrics
│   └── TrendingReposFocusView.tsx    # Expanded GitHub trending directory
├── services/
│   ├── types.ts                      # Interfaces: NewsArticle, MarketMetric, TrendingRepo, WeatherData
│   ├── newsProvider.ts               # Web links, RSS aggregator & fallback provider
│   ├── marketProvider.ts             # Financial market ticker & sparkline provider
│   ├── repoProvider.ts               # GitHub trending repositories provider
│   └── weatherProvider.ts            # Weather API / mock provider
```

---

## 5. Security, Egress, & IPC Contracts

1. **Egress Authority Enforcement:** All network requests initiated by Realtime providers must pass through `requireNewsEgressAdmission` (`packages/desktop/src/process/services/security/newsEgressAuthority.ts`) ensuring unauthorized origins or telemetry bypasses are rejected.
2. **Safe Web Navigation:** Clicking "Mở bài viết gốc" or external URLs uses the internal `/browser` route of TomniHubOS (`packages/desktop/src/renderer/components/layout/Router.tsx`), preventing arbitrary external protocol escalation.
3. **AI Follow-up Chat Integration:** Follow-up questions leverage TomniHubOS's existing AI runtime chat bridge (`/packages/desktop/src/common/chat`), injecting the article's text and citation list as bounded system context.

---

## 6. Implementation Task Breakdown

### Task 1: Core Routing, Navigation, & i18n
- **Dependencies:** None
- **Allowlist:**
  - `packages/desktop/src/renderer/components/layout/Sider/index.tsx`
  - `packages/desktop/src/renderer/components/layout/Router.tsx`
  - `packages/desktop/src/renderer/services/i18n/locales/vi-VN/news.json`
  - `packages/desktop/src/renderer/services/i18n/locales/en-US/news.json`
- **Forbidden:** Core electron main files outside router.
- **Acceptance Criteria:**
  - Sidebar shows "Realtime" tab with Lightning icon.
  - Clicking navigates to `/realtime` without reload or shell break.
  - Active tab styling matches Hub Shell conventions.

### Task 2: Realtime Types & Providers Layer
- **Dependencies:** Task 1
- **Allowlist:**
  - `packages/desktop/src/renderer/pages/realtime/services/*`
- **Forbidden:** Direct DOM manipulation.
- **Acceptance Criteria:**
  - Clean TypeScript interfaces for `NewsArticle`, `MarketMetric`, `TrendingRepo`, `WeatherData`.
  - Default mock & web providers returning structured data with zero network crashes.

### Task 3: Continuous News Stream & Sticky Sidebar (`1 - 3 - 1` Layout)
- **Dependencies:** Task 2
- **Allowlist:**
  - `packages/desktop/src/renderer/pages/realtime/RealtimeNewsFeed.tsx`
  - `packages/desktop/src/renderer/pages/realtime/components/*`
  - `packages/desktop/src/renderer/pages/realtime/widgets/*`
- **Forbidden:** Hardcoded external images without fallback.
- **Acceptance Criteria:**
  - Renders 1 Hero card → 3 Sub cards → 1 Hero card repeating.
  - Right sidebar stays fixed/sticky during left column scroll.
  - Matches styles of Image #1 and Image #2.

### Task 4: In-Depth Article Synthesis Reader (Image #3)
- **Dependencies:** Task 3
- **Allowlist:**
  - `packages/desktop/src/renderer/pages/realtime/article/RealtimeArticleView.tsx`
- **Forbidden:** Navigation that alters hash history inappropriately.
- **Acceptance Criteria:**
  - Clicking any news card opens full article view with `← Quay lại Khám phá`.
  - Renders editorial typography, inline citations (`retractionwatch +1`), and source cards.
  - Back button smoothly returns to the feed preserving scroll position.

### Task 5: AI Follow-up Chat & Collapsible Reference (Image #4)
- **Dependencies:** Task 4
- **Allowlist:**
  - `packages/desktop/src/renderer/pages/realtime/article/ArticleChatThread.tsx`
  - `packages/desktop/src/renderer/pages/realtime/article/ArticleFollowUpInput.tsx`
- **Forbidden:** Bypassing chat context composer.
- **Acceptance Criteria:**
  - Submitting a question collapses article into `⌥ Continued from: [Title]`.
  - Displays user message, `⏱ Researched 3s` badge, formatted answer with citation pills.
  - Floating bottom input bar supports further follow-up questions.

### Task 6: Market & Trending Repos Focus Views
- **Dependencies:** Task 3
- **Allowlist:**
  - `packages/desktop/src/renderer/pages/realtime/focus/*`
- **Forbidden:** Global CSS pollution.
- **Acceptance Criteria:**
  - Clicking `Triển vọng thị trường ›` opens Market Focus View with interactive chart.
  - Clicking `Trending repositories · See more` opens full Trending Repositories View.
  - Back button returns to the main Realtime Feed cleanly.

---

## 7. Verification & Rollback Strategy

1. **Unit & Render Verification:**
   - Verify layout responsiveness across standard desktop resolutions (1280px to 2560px).
   - Ensure dark mode colors adhere to Tomni Design System tokens (`--bg-primary`, `--bg-secondary`, `--border`).
2. **Rollback Plan:**
   - Realtime is an isolated route `/realtime` and isolated directory `packages/desktop/src/renderer/pages/realtime/`.
   - Reverting the entry in `Sider/index.tsx` and `Router.tsx` cleanly disables the feature with zero impact on the rest of TomniHubOS.
