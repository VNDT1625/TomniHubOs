/** @vitest-environment jsdom */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return {
    ...actual,
    Message: {
      success: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    },
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, opts?: { defaultValue?: string }) => opts?.defaultValue || k }),
}));

import InChatSecretForm from '../../../packages/desktop/src/renderer/pages/conversation/Messages/components/InChatSecretForm';

describe('InChatSecretForm', () => {
  it('renders correctly with service name and fields', () => {
    render(<InChatSecretForm serviceName='Facebook Marketing' onSubmit={vi.fn()} />);

    expect(screen.getByText('Yêu cầu xác thực: Facebook Marketing')).toBeDefined();
    expect(screen.getByPlaceholderText('Nhập secret...')).toBeDefined();
    expect(
      screen.getByPlaceholderText('VD: Dùng cho tài khoản Facebook bán hàng, không dùng cho cá nhân')
    ).toBeDefined();
  });

  it('calls onSubmit with secretValue, purposeNote, and rememberCausalContext', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<InChatSecretForm serviceName='Facebook' onSubmit={onSubmit} />);

    const secretInput = screen.getByPlaceholderText('Nhập secret...');
    const purposeInput = screen.getByPlaceholderText(
      'VD: Dùng cho tài khoản Facebook bán hàng, không dùng cho cá nhân'
    );
    const submitBtn = screen.getByTestId('in-chat-secret-submit');

    fireEvent.change(secretInput, { target: { value: 'fb_token_12345' } });
    fireEvent.change(purposeInput, { target: { value: 'Tài khoản bán lẻ' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        secretValue: 'fb_token_12345',
        purposeNote: 'Tài khoản bán lẻ',
        rememberCausalContext: true,
      });
    });

    // Should switch to success view
    expect(screen.getByTestId('in-chat-secret-success')).toBeDefined();
  });
});
