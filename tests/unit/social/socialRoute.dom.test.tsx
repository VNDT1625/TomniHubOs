import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { SocialHubHeader } from '@/renderer/pages/social/SocialHubHeader';

describe('SocialHubHeader Component', () => {
  it('renders all 4 tabs: Bảng tin, Reels, Tin nhắn, Cài đặt', () => {
    const onTabChange = vi.fn();
    const onRefresh = vi.fn();

    render(
      <SocialHubHeader
        activeTab="feed"
        onTabChange={onTabChange}
        onRefresh={onRefresh}
        accounts={[]}
        selectedAccountId={null}
        onSelectAccount={vi.fn()}
      />
    );

    expect(screen.getByText('Bảng tin')).toBeDefined();
    expect(screen.getByText('Reels')).toBeDefined();
    expect(screen.getByText('Tin nhắn')).toBeDefined();
    expect(screen.getByText('Cài đặt')).toBeDefined();
  });

  it('triggers onRefresh when double-clicking on active tab', () => {
    const onTabChange = vi.fn();
    const onRefresh = vi.fn();

    render(
      <SocialHubHeader
        activeTab="feed"
        onTabChange={onTabChange}
        onRefresh={onRefresh}
        accounts={[]}
        selectedAccountId={null}
        onSelectAccount={vi.fn()}
      />
    );

    const feedTab = screen.getByText('Bảng tin');
    fireEvent.doubleClick(feedTab);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
