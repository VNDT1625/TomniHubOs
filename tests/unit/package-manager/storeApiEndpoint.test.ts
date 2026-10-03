import { describe, expect, it } from 'vitest';
import { readStoreApiBaseUrl } from '@/process/services/storeApiSessionClient';

describe('Store API endpoint configuration', () => {
  it('accepts local development and HTTPS deployment URLs', () => {
    expect(readStoreApiBaseUrl({ TOMNI_STORE_API_URL: 'http://127.0.0.1:8787' })).toBe('http://127.0.0.1:8787/');
    expect(readStoreApiBaseUrl({ TOMNI_STORE_API_URL: 'https://store.example.test' })).toBe(
      'https://store.example.test/'
    );
    expect(readStoreApiBaseUrl({})).toBeUndefined();
  });
  it('rejects insecure non-local endpoints', () => {
    expect(() => readStoreApiBaseUrl({ TOMNI_STORE_API_URL: 'http://store.example.test' })).toThrow(
      'STORE_API_BASE_URL_INVALID'
    );
  });
});
