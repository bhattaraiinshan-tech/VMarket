import { afterEach, describe, expect, it, vi } from 'vitest';

import { requestApi } from './api';
import {
  getWorkspaceSnapshot,
  selectWorkspace,
  setWorkspaceUser,
  selectShop,
} from './workspace-state';

const user = {
  id: 'user-1',
  email: 'customer@example.com',
  email_verified: true,
  account_status: 'active',
  roles: ['customer', 'vendor'],
  profile: { full_name: 'Customer', phone: null },
  vendor_profile: { business_name: 'Business' },
};

afterEach(() => {
  setWorkspaceUser(null);
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('workspace requests', () => {
  it('rejects missing mode and shop before fetching protected data', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    await expect(requestApi('/me/cart')).rejects.toThrow('Customer');
    await expect(
      requestApi('/me/fulfillment-orders/order-1/cancel', { method: 'POST' }),
    ).rejects.toThrow('Customer');
    setWorkspaceUser(user);
    selectWorkspace('vendor');
    await expect(requestApi('/vendor/products')).rejects.toThrow(
      'Select a shop',
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sets authoritative headers for JSON and uploads, ignoring forged selectors', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({}));
    setWorkspaceUser(user);
    selectWorkspace('vendor');
    selectShop('shop-1', ['shop-1']);
    await requestApi('/vendor/shop/logo', {
      method: 'POST',
      body: new FormData(),
      headers: {
        'x-vmarket-workspace': 'admin',
        'X-VMarket-Shop-Id': 'forged',
      },
    });
    const headers = new Headers(fetch.mock.calls[0][1]?.headers);
    expect(headers.get('X-VMarket-Workspace')).toBe('vendor');
    expect(headers.get('X-VMarket-Shop-Id')).toBe('shop-1');
    expect(headers.has('Content-Type')).toBe(false);
  });

  it('keeps public and neutral endpoints context-free', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({}));
    await requestApi('/catalog/products', {
      headers: {
        'X-VMarket-Workspace': 'admin',
        'X-VMarket-Shop-Id': 'forged',
      },
    });

    expect(
      new Headers(fetch.mock.calls[0][1]?.headers).has('X-VMarket-Workspace'),
    ).toBe(false);
  });

  it('omits stale shop selectors in Customer and Admin workspaces', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json([]));
    setWorkspaceUser({ ...user, roles: [...user.roles, 'admin'] });
    selectWorkspace('vendor');
    selectShop('shop-1', ['shop-1']);
    selectWorkspace('customer');
    await requestApi('/me/notifications', {
      headers: { 'X-VMarket-Shop-Id': 'shop-1' },
    });
    selectWorkspace('admin');
    await requestApi('/admin/users', {
      headers: { 'X-VMarket-Shop-Id': 'shop-1' },
    });
    expect(
      new Headers(fetch.mock.calls[0][1]?.headers).get('X-VMarket-Workspace'),
    ).toBe('customer');
    expect(
      new Headers(fetch.mock.calls[1][1]?.headers).get('X-VMarket-Workspace'),
    ).toBe('admin');
    for (const [, init] of fetch.mock.calls) {
      expect(new Headers(init?.headers).has('X-VMarket-Shop-Id')).toBe(false);
    }
  });

  it('does not grant a profile based on role labels or forged caller headers', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    setWorkspaceUser({ ...user, vendor_profile: null });
    expect(() => selectWorkspace('vendor')).toThrow('not available');
    await expect(
      requestApi('/vendor/products', {
        headers: {
          'X-VMarket-Workspace': 'vendor',
          'X-VMarket-Shop-Id': 'shop-1',
        },
      }),
    ).rejects.toThrow('Vendor');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('discards late mutation responses without moving a follow-up action into the new shop', async () => {
    let resolve!: (response: Response) => void;
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    setWorkspaceUser(user);
    selectWorkspace('vendor');
    selectShop('shop-1', ['shop-1', 'shop-2']);
    const mutation = requestApi('/vendor/products', {
      method: 'POST',
      body: '{}',
    }).then(() =>
      requestApi('/vendor/products/product-1/images', {
        method: 'POST',
        body: new FormData(),
      }),
    );
    selectShop('shop-2', ['shop-1', 'shop-2']);
    resolve(Response.json({ id: 'product-1' }));
    await expect(mutation).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      new Headers(fetch.mock.calls[0][1]?.headers).get('X-VMarket-Shop-Id'),
    ).toBe('shop-1');
  });
  it('aborts obsolete requests and rejects late responses after switching', async () => {
    let resolve!: (response: Response) => void;
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    setWorkspaceUser(user);
    const pending = requestApi('/me/cart');
    const signal = fetch.mock.calls[0][1]?.signal;
    selectWorkspace('vendor');
    expect(signal?.aborted).toBe(true);
    resolve(Response.json({ items: ['private'] }));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('binds tab storage to identity, never chooses a shop, and clears on logout', () => {
    setWorkspaceUser(user);
    selectWorkspace('vendor');
    expect(getWorkspaceSnapshot().shopId).toBeNull();
    selectShop('shop-1', ['shop-1']);
    expect(localStorage.length).toBe(0);
    setWorkspaceUser({ ...user, id: 'user-2' });
    expect(getWorkspaceSnapshot().workspace).toBe('customer');
    expect(getWorkspaceSnapshot().shopId).toBeNull();
    setWorkspaceUser(null);
    expect(sessionStorage.getItem('vmarket.workspace')).toBeNull();
  });
});
