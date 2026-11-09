import { afterEach, describe, expect, it, vi } from 'vitest';

import { createUuid } from './uuid';

afterEach(() => vi.unstubAllGlobals());

describe('createUuid', () => {
  it('uses the native UUID API when available', () => {
    const randomUUID = vi.fn(() => 'native-uuid');
    vi.stubGlobal('crypto', { randomUUID });
    expect(createUuid()).toBe('native-uuid');
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it('uses secure random bytes with UUID v4 version and variant bits on HTTP', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => bytes.fill(255));
    vi.stubGlobal('crypto', { getRandomValues });
    expect(createUuid()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    createUuid();
    expect(getRandomValues).toHaveBeenCalledTimes(2);
    expect(getRandomValues.mock.calls[0][0]).toHaveLength(16);
    expect(getRandomValues.mock.calls[0][0]).not.toBe(
      getRandomValues.mock.calls[1][0],
    );
  });

  it('fails explicitly instead of using insecure randomness', () => {
    vi.stubGlobal('crypto', undefined);
    expect(createUuid).toThrow('Secure random generation is unavailable');
  });
});
