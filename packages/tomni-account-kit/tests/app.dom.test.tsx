// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConfigProvider } from '@arco-design/web-react';
import { MemoryAccountStorage, MockAccountClient } from '../src/core';
import { AccountPrototypeApp } from '../src/ui';

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
});

describe('account prototype app', () => {
  it('renders the isolated sign-in experience without a Tomni app host', () => {
    const client = new MockAccountClient(new MemoryAccountStorage());
    render(
      <ConfigProvider>
        <AccountPrototypeApp client={client} />
      </ConfigProvider>
    );

    expect(screen.getByText('Một danh tính cho mọi bề mặt Tomni')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mở tài khoản mẫu' })).toBeInTheDocument();
  });
});
