import { describe, expect, it, vi } from 'vitest';
import { API_BASE_URL, requestApi } from './api';
import { browserStorageUrl, conversationSocketUrl } from './network';

describe('desktop and mobile network URLs', () => {
  it('uses the same-origin API proxy by default', () => {
    expect(API_BASE_URL).toBe('/api/v1');
  });

  it('sends authenticated requests to a relative URL', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ items: [] }));
    try {
      await expect(requestApi('/catalog/products')).resolves.toEqual({
        items: [],
      });
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/catalog/products',
        expect.objectContaining({ credentials: 'include' }),
      );
    } finally {
      fetchMock.mockRestore();
    }
  });

  it.each(['http://localhost:3000', 'http://192.168.1.72:3000'])(
    'connects messages through the current origin at %s',
    (origin) => {
      const url = conversationSocketUrl('conversation-1', origin, '/api/v1');
      expect(url.href).toBe(
        `${origin.replace('http:', 'ws:')}/api/v1/communications/ws/conversation-1`,
      );
    },
  );

  it('supports HTTPS and an explicitly configured remote API', () => {
    expect(
      conversationSocketUrl(
        'conversation-1',
        'https://market.example',
        '/api/v1',
      ).protocol,
    ).toBe('wss:');
    expect(
      conversationSocketUrl(
        'conversation-1',
        'https://market.example',
        'https://api.example/api/v1',
      ).host,
    ).toBe('api.example');
  });

  it('proxies local media without altering signed paths or queries', () => {
    expect(
      browserStorageUrl(
        'http://localhost:9000/vendor-documents/file.pdf?X-Amz-Signature=abc',
      ),
    ).toBe('/storage/vendor-documents/file.pdf?X-Amz-Signature=abc');
    expect(
      browserStorageUrl('http://127.0.0.1:9000/product-media/photo.jpg'),
    ).toBe('/storage/product-media/photo.jpg');
  });

  it('preserves external storage URLs and already-relative URLs', () => {
    expect(browserStorageUrl('https://media.example/photo.jpg')).toBe(
      'https://media.example/photo.jpg',
    );
    expect(browserStorageUrl('/storage/product-media/photo.jpg')).toBe(
      '/storage/product-media/photo.jpg',
    );
  });
});
