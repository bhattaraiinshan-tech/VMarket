import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import IdentityPortal from './identity-portal';
import WorkspaceSwitcher from './workspace-switcher';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('identity account controls', () => {
  it('updates an owned address and revokes another active session', async () => {
    let address = {
      id: 'address-1',
      label: 'Home',
      recipient_name: 'Test Customer',
      phone: '+9779800000000',
      province: 'Bagmati',
      city: 'Kathmandu',
      area: null,
      street_address: 'Ward 1',
      postal_code: null,
      is_default: true,
    };
    let sessions = [
      {
        id: 'session-2',
        created_at: '2026-01-01T00:00:00Z',
        last_seen_at: '2026-01-02T00:00:00Z',
        expires_at: '2026-01-08T00:00:00Z',
        user_agent: 'Other browser',
        current: false,
      },
    ];
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input, init) => {
        const path = new URL(String(input)).pathname.replace('/api/v1', '');
        let payload: unknown;

        if (path === '/me') {
          payload = {
            id: 'user-1',
            email: 'customer@example.com',
            email_verified: true,
            account_status: 'active',
            roles: ['customer'],
            vendor_profile: null,
            profile: { full_name: 'Test Customer', phone: null },
          };
        } else if (
          path.startsWith('/me/addresses/') &&
          init?.method === 'PUT'
        ) {
          address = { ...address, ...JSON.parse(String(init.body)) };
          payload = address;
        } else if (path === '/me/addresses') {
          payload = [address];
        } else if (path === '/vendors/applications/me') {
          payload = [];
        } else if (
          path.startsWith('/auth/sessions/') &&
          init?.method === 'DELETE'
        ) {
          sessions = [];
          payload = { message: 'The session has been revoked.' };
        } else if (path === '/auth/sessions') {
          payload = sessions;
        } else {
          throw new Error(`Unexpected API request: ${path}`);
        }

        return new Response(JSON.stringify(payload), {
          headers: { 'Content-Type': 'application/json' },
        });
      });

    render(<IdentityPortal />);

    await screen.findByRole('heading', { name: 'Signed-in sessions' });
    expect(await screen.findByText('Other browser')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Label' }), {
      target: { value: 'Work' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save address' }));

    expect(await screen.findByText('Work - Default')).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT'),
    ).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Revoke session' }));
    await waitFor(() => {
      expect(
        screen.getByText('No active sessions were found.'),
      ).toBeInTheDocument();
    });
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE'),
    ).toBe(true);
  });

  it('lets administrators suspend accounts and review the audit trail', async () => {
    let accountStatus = 'active';
    let auditEvents: unknown[] = [];
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input, init) => {
        const path = new URL(String(input)).pathname.replace('/api/v1', '');
        let payload: unknown;

        if (path === '/me') {
          payload = {
            id: 'admin-1',
            email: 'admin@example.com',
            email_verified: true,
            account_status: 'active',
            roles: ['admin'],
            vendor_profile: null,
            profile: { full_name: 'Platform Admin', phone: null },
          };
        } else if (path === '/me/addresses') {
          payload = [];
        } else if (path === '/vendors/applications/me') {
          payload = [];
        } else if (path === '/auth/sessions') {
          payload = [];
        } else if (path === '/admin/vendor-applications') {
          payload = [];
        } else if (path === '/admin/users') {
          payload = [
            {
              id: 'customer-1',
              email: 'customer@example.com',
              account_status: accountStatus,
              roles: ['customer'],
              created_at: '2026-01-01T00:00:00Z',
            },
          ];
        } else if (path === '/admin/audit-logs') {
          payload = auditEvents;
        } else if (
          path === '/admin/users/customer-1/suspension' &&
          init?.method === 'POST'
        ) {
          const decision = JSON.parse(String(init.body)) as {
            suspended: boolean;
            reason: string;
          };
          accountStatus = decision.suspended ? 'suspended' : 'active';
          auditEvents = [
            {
              id: 'audit-1',
              actor_id: 'admin-1',
              action: 'account_suspended',
              target_type: 'user',
              target_id: 'customer-1',
              details: decision.reason,
              created_at: '2026-01-02T00:00:00Z',
            },
          ];
          payload = { message: 'The account has been suspended.' };
        } else {
          throw new Error(`Unexpected API request: ${path}`);
        }

        return new Response(JSON.stringify(payload), {
          headers: { 'Content-Type': 'application/json' },
        });
      });

    render(
      <>
        <WorkspaceSwitcher />
        <IdentityPortal />
      </>,
    );

    await screen.findByLabelText('Workspace');
    fireEvent.change(screen.getByLabelText('Workspace'), {
      target: { value: 'admin' },
    });
    await screen.findByRole('heading', { name: 'Account access controls' });
    fireEvent.change(screen.getByLabelText('Reason for suspension'), {
      target: { value: 'Confirmed policy violation.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Suspend' }));

    expect(await screen.findByText('account_suspended')).toBeInTheDocument();
    expect(screen.getByText('customer@example.com')).toBeInTheDocument();
    expect(screen.getByText(/customer\s+\|\s+suspended/i)).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([, init]) =>
          init?.method === 'POST' &&
          init.body ===
            JSON.stringify({
              suspended: true,
              reason: 'Confirmed policy violation.',
            }),
      ),
    ).toBe(true);
  });
});
