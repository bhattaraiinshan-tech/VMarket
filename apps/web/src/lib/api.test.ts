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
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ id: 'report-1' }));
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