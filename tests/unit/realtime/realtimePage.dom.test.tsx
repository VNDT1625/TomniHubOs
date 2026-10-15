import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type {
  RealtimeReadRequest,
  RealtimeReadResult,
} from '../../../packages/desktop/src/common/types/platform/realtimeContent';
import RealtimePage from '../../../packages/desktop/src/renderer/pages/realtime';
import { RealtimeNewsFeed } from '../../../packages/desktop/src/renderer/pages/realtime/RealtimeNewsFeed';
import { RealtimeWidgetRail } from '../../../packages/desktop/src/renderer/pages/realtime/widgets/RealtimeWidgetRail';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => (options?.count === undefined ? key : `${key} ${options.count}`),
    i18n: { language: 'vi' },
  }),
}));
const sample = (req: RealtimeReadRequest): RealtimeReadResult => ({
  ok: true,
  source: req.source,
  updatedAt: '2026-10-15T02:00:00Z',
  items:
    req.source === 'news'
      ? [
          {
            id: 'n1',
            title: 'Live RSS headline',
            description: 'A public RSS description',
            sourceLabel: 'Hacker News RSS',
            url: 'https://news.ycombinator.com/item?id=1',
          },
        ]
      : req.source === 'github'
        ? [
            {
              id: 'example/repo',
              title: 'example/repo',
              description: 'Live repository',
              url: 'https://github.com/example/repo',
              language: 'TypeScript',
              value: 450,
            },
          ]
        : req.source === 'huggingface'
          ? [
              {
                id: 'org/model',
                title: 'org/model',
                description: 'text-generation',
                url: 'https://huggingface.co/org/model',
                value: 30,
              },
            ]
          : req.source === 'weather'
            ? [{ id: req.city ?? 'hanoi', title: 'Hà Nội', description: 'H: 33° L: 25°', value: 28, unit: '°C' }]
            : [{ id: 'Bitcoin', title: 'Bitcoin', description: 'Market price', value: 60000 }],
});
beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal('electronAPI', {
    realtimeContent: {
      read: vi.fn(async (req: RealtimeReadRequest) => sample(req)),
      readArticle: vi.fn(async () => ({
        ok: true,
        paragraphs: ['Verified text from the publisher is shown here, with no markup or arbitrary script injection.'],
      })),
    },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const Location = () => {
  const location = useLocation();
  return (
    <output data-testid='location'>
      {JSON.stringify({ path: location.pathname, search: location.search, state: location.state })}
    </output>
  );
};
const setup = (url = '/realtime', includeRail = false) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      {includeRail && <RealtimeWidgetRail />}
      <RealtimePage />
      <Location />
    </MemoryRouter>
  );

describe('Realtime live page transitions', () => {
  it('renders Main-supplied RSS content, opens the reader and hands source context to Hub', async () => {
    setup();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Live RSS headline' }))[0]!);
        expect(screen.getByText('A public RSS description')).toBeTruthy();
    await screen.findByText('Verified text from the publisher is shown here, with no markup or arbitrary script injection.');
    const field = screen.getByRole('textbox', { name: 'news.hub.askPlaceholder' });
    fireEvent.change(field, { target: { value: 'Why?' } });
    fireEvent.keyDown(field, { key: 'Enter', code: 'Enter' });
    expect(screen.getByText('news.hub.continuedFrom')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /news.hub.continueInHub/ }));
    const current = JSON.parse(screen.getByTestId('location').textContent ?? '{}') as {
      path: string;
      state: { realtimeDraft: string };
    };
    expect(current.path).toBe('/guid');
    expect(current.state.realtimeDraft).toContain('Why?');
    expect(current.state.realtimeDraft).toContain('https://news.ycombinator.com/');
  });
  it('loads original publisher paragraphs via the admitted article channel', async () => {
    setup();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Live RSS headline' }))[0]!);
    expect(
      await screen.findByText(
        'Verified text from the publisher is shown here, with no markup or arbitrary script injection.'
      )
    ).toBeTruthy();
    expect(vi.mocked(window.electronAPI!.realtimeContent!.readArticle)).toHaveBeenCalledWith({
      articleId: 'n1',
    });
  });
  it('returns to News Feed after opening a widget from an article reader', async () => {
    setup('/realtime', true);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Live RSS headline' }))[0]!);
        expect(screen.getByRole('heading', { name: 'Live RSS headline' })).toBeTruthy();
    await screen.findByText('Verified text from the publisher is shown here, with no markup or arbitrary script injection.');
    fireEvent.click(screen.getByRole('button', { name: 'news.github.title' }));
    expect(await screen.findByTestId('realtime-focus-github')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '← news.hub.back' }));
    expect(await screen.findByTestId('realtime-page')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'news.hub.discover' })).toBeTruthy();
  });
  it('routes from the widget rail to the GitHub list and selected repository in the centre', async () => {
    setup('/realtime', true);
    fireEvent.click(screen.getByRole('button', { name: 'news.github.title' }));
    expect(await screen.findByTestId('realtime-focus-github')).toBeTruthy();
    expect(screen.getAllByText('example/repo').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTestId('realtime-focus-github').querySelector('button.realtime-title-button')!);
    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain('item=example%2Frepo'));
    expect(screen.getAllByText('Live repository').length).toBeGreaterThan(0);
  });
    it('lets users remove Market and install Hugging Face persistently', async () => {
    setup('/realtime', true);
    fireEvent.click(screen.getByRole('button', { name: 'news.hub.custom.settings' }));
    const marketCard = screen.getByTestId('realtime-widget-market');
    fireEvent.click(marketCard.querySelector('button[aria-label="news.market.remove"]')!);
    expect(screen.queryByTestId('realtime-widget-market')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'news.hub.custom.add news.hub.custom.huggingface' }));
        expect(screen.getByTestId('realtime-widget-huggingface')).toBeTruthy();
    await screen.findByText('org/model');
    expect(window.localStorage.getItem('tomni.realtime.widgets.v1')).toContain('huggingface');
    expect(window.localStorage.getItem('tomni.realtime.widgets.v1')).not.toContain('"id":"market"');
  });
  it('refreshes the open Weather focus after the user changes city in the rail', async () => {
    setup('/realtime?view=weather', true);
    expect(await screen.findByTestId('realtime-focus-weather')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'news.hub.custom.settings' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'news.weather.setLocation' }), {
      target: { value: 'danang' },
    });
    await waitFor(() => {
      const requests = vi.mocked(window.electronAPI!.realtimeContent!.read).mock.calls.map(([request]) => request);
      expect(requests).toContainEqual({ source: 'weather', city: 'danang' });
    });
  });
  it('uses provider-supplied market history and lets users switch the chart range', async () => {
    setup('/realtime?view=market');
    const buttons = screen.getAllByRole('button', { name: '1W' });
    fireEvent.click(buttons[0]!);
    await waitFor(() => {
      const requests = vi.mocked(window.electronAPI!.realtimeContent!.read).mock.calls.map(([request]) => request);
      expect(requests).toContainEqual({ source: 'market', range: '1w' });
    });
  });
  it('routes Hugging Face models, datasets and spaces using independent approved Main requests', async () => {
    setup('/realtime?view=huggingface');
    fireEvent.click(screen.getByRole('tab', { name: 'news.hub.custom.datasets' }));
    await waitFor(() => {
      const requests = vi.mocked(window.electronAPI!.realtimeContent!.read).mock.calls.map(([request]) => request);
      expect(requests).toContainEqual({ source: 'huggingface', kind: 'datasets' });
    });
    fireEvent.click(screen.getByRole('tab', { name: 'news.hub.custom.spaces' }));
    await waitFor(() => {
      const requests = vi.mocked(window.electronAPI!.realtimeContent!.read).mock.calls.map(([request]) => request);
      expect(requests).toContainEqual({ source: 'huggingface', kind: 'spaces' });
    });
  });
  it('filters GitHub repository list by the language returned from Main', async () => {
    setup('/realtime?view=github');
    expect(await screen.findByTestId('realtime-focus-github')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'TypeScript' }));
    expect(screen.getByRole('button', { name: 'TypeScript' }).getAttribute('aria-pressed')).toBe('true');
  });
    it('keeps Shift+Enter for multiline follow-ups', async () => {
    setup();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Live RSS headline' }))[0]!);
    await screen.findByText('Verified text from the publisher is shown here, with no markup or arbitrary script injection.');
    const field = screen.getByRole('textbox', { name: 'news.hub.askPlaceholder' });
    fireEvent.change(field, { target: { value: 'First' } });
    fireEvent.keyDown(field, { key: 'Enter', code: 'Enter', shiftKey: true });
    expect(screen.queryByText('news.hub.continuedFrom')).toBeNull();
  });
    it('opens a verified HTTPS source in the internal Browser route', async () => {
    setup();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Live RSS headline' }))[0]!);
    await screen.findByText('Verified text from the publisher is shown here, with no markup or arbitrary script injection.');
    fireEvent.click(screen.getByRole('button', { name: /Hacker News RSS/ }));
    expect(screen.getByTestId('location').textContent).toContain('/browser');
  });
  it('renders a live empty state without any mock article or widgets in the feed', () => {
    render(<RealtimeNewsFeed articles={[]} onSelectArticle={vi.fn()} />);
    expect(screen.getByText('news.hub.custom.noLiveNews')).toBeTruthy();
    expect(screen.queryByTestId('realtime-widget-weather')).toBeNull();
  });
});
