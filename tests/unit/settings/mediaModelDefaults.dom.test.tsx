import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), catalog: vi.fn() }));
vi.mock('@/common/adapter/ipcBridge', () => ({
  systemSettings: {
    getClientConfig: { invoke: mocks.read },
    setClientConfig: { invoke: mocks.write },
  },
}));
vi.mock('@/common/adapter/httpBridge', () => ({ getBaseUrl: () => '' }));
vi.mock('@/renderer/hooks/agent/useModelProviderList', () => ({ useProvidersQuery: mocks.catalog }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, options: { defaultValue: string }) => options.defaultValue }),
}));
import { configService } from '@/common/config/configService';
import MediaModelDefaults from '@/renderer/pages/settings/components/media/MediaModelDefaults';
import { parseMediaDefaults } from '@/renderer/pages/settings/components/media/mediaDefaultsContract';

describe('media model defaults', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    configService.reset();
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: {} });
    mocks.read.mockResolvedValue({});
    mocks.write.mockResolvedValue(undefined);
    mocks.catalog.mockReturnValue({
      data: [
        { id: 'a', name: 'A', models: ['shared'] },
        { id: 'b', name: 'B', models: ['shared'] },
      ],
      mutate: vi.fn().mockResolvedValue(undefined),
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  });

  it('persists independent modalities, reloads them and clears only the selected modality', async () => {
    let saved: unknown;
    mocks.write.mockImplementation(async ({ key, value }: { key: string; value: unknown }) => {
      expect(key).toBe('ai.mediaModelDefaults');
      saved = value;
      mocks.read.mockResolvedValue({ 'ai.mediaModelDefaults': value });
    });
    const view = render(<MediaModelDefaults />);
    const image = screen.getByLabelText('Image');
    await waitFor(() => expect(image).not.toBeDisabled());
    fireEvent.change(image, { target: { value: '["a","shared"]' } });
    await screen.findByText('Model defaults saved.');
    fireEvent.change(screen.getByLabelText('Text to speech (TTS)'), { target: { value: '["b","shared"]' } });
    await waitFor(() =>
      expect(saved).toEqual({
        image: { providerId: 'a', modelId: 'shared' },
        tts: { providerId: 'b', modelId: 'shared' },
      })
    );
    view.unmount();
    configService.reset();
    render(<MediaModelDefaults />);
    await waitFor(() => expect(screen.getByLabelText('Image')).toHaveValue('["a","shared"]'));
    expect(screen.getAllByRole('combobox')).toHaveLength(5);
    fireEvent.change(screen.getByLabelText('Image'), { target: { value: '' } });
    await waitFor(() => expect(saved).toEqual({ tts: { providerId: 'b', modelId: 'shared' } }));
  });

  it('retains acknowledged UI and cache after both native and fallback persistence fail', async () => {
    const previous = { stt: { providerId: 'a', modelId: 'shared' } };
    mocks.read.mockResolvedValue({ 'ai.mediaModelDefaults': previous });
    mocks.write.mockRejectedValue(new Error('save failed'));
    render(<MediaModelDefaults />);
    await waitFor(() => expect(screen.getByLabelText('Speech to text (STT)')).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText('Speech to text (STT)'), { target: { value: '["b","shared"]' } });
    await screen.findByRole('alert');
    expect(screen.getByLabelText('Speech to text (STT)')).toHaveValue('["a","shared"]');
    expect(configService.get('ai.mediaModelDefaults')).toEqual(previous);
  });

  it('keeps missing saved references visible without inventing catalog options', async () => {
    mocks.read.mockResolvedValue({ 'ai.mediaModelDefaults': { video: { providerId: 'gone', modelId: 'old' } } });
    render(<MediaModelDefaults />);
    await screen.findByText('Saved model unavailable — choose another or clear');
    expect(screen.getByLabelText('Video')).toHaveValue('["gone","old"]');
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it('fails closed for malformed or credential-bearing persisted references', async () => {
    for (const value of [
      null,
      [],
      { image: { providerId: '', modelId: 'm' } },
      { tts: { providerId: 'a', modelId: 42 } },
      { stt: { providerId: 'a', modelId: 'm', api_key: 'secret' } },
      { unknown: {} },
    ]) {
      expect(() => parseMediaDefaults(value)).toThrow();
    }
    mocks.read.mockResolvedValue({ 'ai.mediaModelDefaults': { image: { providerId: 'a' } } });
    render(<MediaModelDefaults />);
    await screen.findByRole('alert');
    expect(screen.getByLabelText('Image')).toBeDisabled();
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
