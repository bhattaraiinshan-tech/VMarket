import { afterEach, describe, expect, it, vi } from 'vitest';

import { requestApi } from './api';
import {
  selectShop,
  selectWorkspace,
  setWorkspaceUser,
} from './workspace-state';

const user = {
  id: 'user-1',
  email: 'user@example.test',
  email_verified: true,
  account_status: 'active',
  roles: ['customer', 'vendor'],
  profile: { full_name: 'Test User', phone: null },
  vendor_profile: { business_name: 'Test Vendor' },
};

afterEach(() => {
  setWorkspaceUser(null);
  vi.unstubAllGlobals();
});

describe('requestApi operations context', () => {
  it('permits account details for Customer and Vendor without implicitly selecting a shop', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => Response.json({}));
    vi.stubGlobal('fetch', fetchMock);
    setWorkspaceUser({ ...user, roles: [...user.roles, 'admin'] });
    for (const workspace of ['customer', 'vendor'] as const) {
      selectWorkspace(workspace);
      await requestApi('/me/account-details');
      const headers = new Headers(fetchMock.mock.calls.at(-1)?.[1].headers);
      expect(headers.get('X-VMarket-Workspace')).toBe(workspace);
      expect(headers.has('X-VMarket-Shop-Id')).toBe(false);
    }
    selectWorkspace('admin');
    await expect(requestApi('/me/account-details')).rejects.toThrow(
      'Customer or Vendor',
    );
    setWorkspaceUser(null);
    await expect(
      requestApi('/me/account-details/avatar', { method: 'DELETE' }),
    ).rejects.toThrow('Customer or Vendor');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('blocks vendor applications outside Customer workspace and forwards export selectors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({}));
    vi.stubGlobal('fetch', fetchMock);
    setWorkspaceUser(user);
    selectWorkspace('vendor');
    await expect(requestApi('/vendors/applications/me')).rejects.toThrow(
      'Customer',
    );
    await expect(requestApi('/me/export')).rejects.toThrow('Select a shop');
    expect(fetchMock).not.toHaveBeenCalled();
    selectShop('shop-1', ['shop-1']);
    await requestApi('/me/export');
    const headers = new Headers(fetchMock.mock.calls[0][1].headers);
    expect(headers.get('X-VMarket-Workspace')).toBe('vendor');
    expect(headers.get('X-VMarket-Shop-Id')).toBe('shop-1');
    selectWorkspace('customer');
    await requestApi('/vendors/applications/me');
    expect(
      new Headers(fetchMock.mock.calls[1][1].headers).get(
        'X-VMarket-Workspace',
      ),
    ).toBe('customer');
  });

  it('blocks owner personal support, messages and reports without issuing requests', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    setWorkspaceUser({ ...user, roles: [...user.roles, 'admin'] });
    selectWorkspace('admin');
    for (const path of [
      '/me/support-tickets',
      '/me/conversations',
      '/me/fraud-reports',
    ]) {
      await expect(requestApi(path)).rejects.toThrow('Customer or Vendor');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('sends the explicitly selected vendor shop for promotion management', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json([]));
    vi.stubGlobal('fetch', fetchMock);
    setWorkspaceUser(user);
    selectWorkspace('vendor');
    selectShop('shop-1', ['shop-1']);

    await requestApi('/vendor/promotions');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get('X-VMarket-Workspace')).toBe('vendor');
    expect(headers.get('X-VMarket-Shop-Id')).toBe('shop-1');
  });

  it('keeps customer fraud reports in the selected customer workspace', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ id: 'report-1' }));
    vi.stubGlobal('fetch', fetchMock);
    setWorkspaceUser(user);
    selectWorkspace('customer');

    await requestApi('/me/fraud-reports', {
      method: 'POST',
      body: JSON.stringify({
        target_type: 'product',
        target_id: 'product-1',
        reason: 'Suspicious listing',
      }),
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get('X-VMarket-Workspace')).toBe('customer');
  });
});
