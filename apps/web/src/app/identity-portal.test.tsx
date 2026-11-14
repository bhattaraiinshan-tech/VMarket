import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';

import IdentityPortal from './identity-portal';
import WorkspaceSwitcher from './workspace-switcher';
import { selectWorkspace, setWorkspaceUser } from '@/lib/workspace-state';

const accountDetails = {
  workspace: 'customer',
  first_name: 'Test',
  last_name: 'Customer',
  phone: null,
  email: 'customer@example.com',
  email_verified: true,
  avatar_url: null,
  preferred_categories: [],
  communication_email: false,
  communication_sms: false,
  business_name: null,
  business_category: null,
  registration_number: null,
  payout_preference: null,
  business_description: null,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
  setWorkspaceUser(null);
});

describe('identity account controls', () => {
  it('keeps customer application data out of the administrator workspace', async () => {
    setWorkspaceUser({
      id: 'admin-user',
      email: 'admin@example.com',
      email_verified: true,
      account_status: 'active',
      roles: ['customer', 'admin'],
      vendor_profile: null,
      profile: { full_name: 'Platform Admin', phone: null },
    });
    selectWorkspace('admin');
    const paths: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const path = new URL(String(input), 'http://localhost:3000').pathname;
      paths.push(path);
      if (path.endsWith('/me')) {
        return Response.json({
          id: 'admin-user',
          email: 'admin@example.com',
          email_verified: true,
          account_status: 'active',
          roles: ['customer', 'admin'],
          vendor_profile: null,
          profile: { full_name: 'Platform Admin', phone: null },
        });
      }
      if (path.endsWith('/auth/sessions')) return Response.json([]);
      return Response.json([]);
    });

    render(<IdentityPortal />);

    expect(
      await screen.findByText('There are no pending vendor applications.'),
    ).toBeInTheDocument();
    expect(
      paths.some((path) => path.endsWith('/vendors/applications/me')),
    ).toBe(false);
    expect(
      screen.queryByRole('heading', { name: 'Vendor workspace access' }),
    ).not.toBeInTheDocument();
  });

  it('opens and submits the reset form from a reset link in strict mode', async () => {
    window.history.replaceState(null, '', '/#reset=test-token');
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const path = new URL(String(input), 'http://localhost:3000').pathname;
        if (path.endsWith('/auth/password/reset')) {
          return Response.json({
            message:
              'Your password has been reset. Sign in with your new password.',
          });
        }
        return Response.json(
          { error: { message: 'Not signed in' } },
          { status: 401 },
        );
      });

    render(
      <StrictMode>
        <IdentityPortal />
      </StrictMode>,
    );

    const password = await screen.findByLabelText('New password');
    expect(window.location.hash).toBe('');
    fireEvent.change(password, { target: { value: 'new-password-123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));
    expect(
      await screen.findByText(
        'Your password has been reset. Sign in with your new password.',
      ),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input).endsWith('/auth/password/reset') &&
          init?.body ===
            JSON.stringify({
              token: 'test-token',
              password: 'new-password-123',
            }),
      ),
    ).toBe(true);
    expect(
      screen.getByRole('heading', { name: 'Welcome back' }),
    ).toBeInTheDocument();
  });

  it('shows the reset form even when already signed in', async () => {
    setWorkspaceUser({
      id: 'user-1',
      email: 'customer@example.com',
      email_verified: true,
      account_status: 'active',
      roles: ['customer'],
      vendor_profile: null,
      profile: { full_name: 'Test Customer', phone: null },
    });
    window.history.replaceState(null, '', '/#reset=test-token');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const path = new URL(String(input), 'http://localhost:3000').pathname;
      if (path.endsWith('/auth/password/reset')) {
        return Response.json({ message: 'Password reset complete.' });
      }
      if (path.endsWith('/me/account-details'))
        return Response.json(accountDetails);
      return Response.json([]);
    });

    render(<IdentityPortal />);

    fireEvent.change(await screen.findByLabelText('New password'), {
      target: { value: 'new-password-123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));
    expect(
      await screen.findByText('Password reset complete.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Welcome back' }),
    ).toBeInTheDocument();
  });

  it('handles a reset link opened on the already mounted page and shows reset errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const path = new URL(String(input), 'http://localhost:3000').pathname;
      if (path.endsWith('/auth/password/reset')) {
        return Response.json(
          {
            error: {
              message: 'The password reset link is invalid or expired.',
            },
          },
          { status: 400 },
        );
      }
      return Response.json(
        { error: { message: 'Not signed in' } },
        { status: 401 },
      );
    });
    render(<IdentityPortal />);
    window.history.replaceState(null, '', '/?source=email#reset=expired-token');
    window.dispatchEvent(new HashChangeEvent('hashchange'));

    fireEvent.change(await screen.findByLabelText('New password'), {
      target: { value: 'new-password-123' },
    });
    expect(window.location.search).toBe('?source=email');
    expect(window.location.hash).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The password reset link is invalid or expired.',
    );
    expect(screen.getByLabelText('New password')).toBeInTheDocument();
  });

  it('updates an owned address and revokes another active session', async () => {
    let profile = { full_name: 'Test Customer', phone: null as string | null };
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
        const path = new URL(
          String(input),
          'http://localhost:3000',
        ).pathname.replace('/api/v1', '');
        let payload: unknown;

        if (path === '/me') {
          if (init?.method === 'PATCH') {
            profile = JSON.parse(String(init.body)) as typeof profile;
          }
          payload = {
            id: 'user-1',
            email: 'customer@example.com',
            email_verified: true,
            account_status: 'active',
            roles: ['customer'],
            vendor_profile: null,
            profile,
          };
        } else if (path === '/me/account-details') {
          const updated =
            init?.method === 'PATCH'
              ? JSON.parse(String(init.body))
              : accountDetails;
          if (init?.method === 'PATCH')
            profile = {
              full_name: `${updated.first_name} ${updated.last_name}`,
              phone: updated.phone,
            };
          payload = { ...accountDetails, ...updated };
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
    expect(
      screen.getByRole('heading', { name: 'Profile' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Delivery addresses' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Security and actions' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Download my personal data' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Other browser')).toBeInTheDocument();

    fireEvent.change(await screen.findByLabelText('First name'), {
      target: { value: 'Updated' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      await screen.findByText('Your profile has been updated.'),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([, init]) =>
          init?.method === 'PATCH' &&
          String(init.body).includes('"first_name":"Updated"'),
      ),
    ).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Add new address' }));
    expect(
      screen.getByRole('button', { name: 'Add address' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Label' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(
      screen.queryByRole('button', { name: 'Add address' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Add new address' }),
    ).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Edit Home address' }));
    expect(screen.getByRole('textbox', { name: 'Label' })).toHaveFocus();
    fireEvent.change(screen.getByRole('textbox', { name: 'Label' }), {
      target: { value: 'Work' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save address' }));

    expect(await screen.findByText('Work - Default')).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT'),
    ).toBe(true);

    fireEvent.click(
      screen.getByRole('button', { name: 'Revoke session: Other browser' }),
    );
    await waitFor(() => {
      expect(
        screen.getByText('No active sessions were found.'),
      ).toBeInTheDocument();
    });
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE'),
    ).toBe(true);
  });

  it('does not present failed account data as empty addresses or sessions', async () => {
    setWorkspaceUser({
      id: 'user-1',
      email: 'customer@example.com',
      email_verified: true,
      account_status: 'active',
      roles: ['customer'],
      vendor_profile: null,
      profile: { full_name: 'Test Customer', phone: null },
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const path = new URL(String(input), 'http://localhost:3000').pathname;
      if (path.endsWith('/me')) {
        return Response.json({
          id: 'user-1',
          email: 'customer@example.com',
          email_verified: true,
          account_status: 'active',
          roles: ['customer'],
          vendor_profile: null,
          profile: { full_name: 'Test Customer', phone: null },
        });
      }
      if (path.endsWith('/auth/sessions')) {
        return Response.json(
          { error: { message: 'Sessions unavailable' } },
          { status: 503 },
        );
      }
      if (path.endsWith('/me/account-details'))
        return Response.json(accountDetails);
      return Response.json([]);
    });

    render(<IdentityPortal />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Sessions unavailable',
    );
    expect(
      screen.getByText('Addresses could not be loaded.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Sessions could not be loaded.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('No active sessions were found.'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('Add an address to make future checkout faster.'),
    ).not.toBeInTheDocument();
  });

  it('lets administrators suspend accounts and review the audit trail', async () => {
    let accountStatus = 'active';
    let auditEvents: unknown[] = [];
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input, init) => {
        const path = new URL(
          String(input),
          'http://localhost:3000',
        ).pathname.replace('/api/v1', '');
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
