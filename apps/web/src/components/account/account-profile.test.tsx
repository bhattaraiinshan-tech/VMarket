import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AccountProfile,
  AccountSecurity,
  ShopProfile,
  type AccountDetails,
} from './account-profile';
import { AccountShell } from './account-shell';
import {
  selectShop,
  selectWorkspace,
  setWorkspaceUser,
} from '@/lib/workspace-state';

const shopContext = vi.hoisted(() => ({
  shops: [] as { id: string; name: string; description: string | null }[],
  loading: false,
  error: '',
  refresh: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/workspace-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/workspace-context')>()),
  useWorkspaceShops: () => shopContext,
}));

const user = {
  id: 'account-user',
  email: 'account@example.test',
  email_verified: true,
  account_status: 'active',
  roles: ['customer', 'vendor', 'admin'],
  profile: { full_name: 'Test Customer', phone: '+9779800000000' },
  vendor_profile: { business_name: 'Craft House' },
};
const details: AccountDetails = {
  workspace: 'customer',
  first_name: 'Test',
  last_name: 'Customer',
  email: user.email,
  email_verified: true,
  phone: user.profile.phone,
  avatar_url: null,
  preferred_categories: ['Crafts'],
  communication_email: false,
  communication_sms: false,
  business_name: null,
  business_category: null,
  registration_number: null,
  payout_preference: null,
  business_description: null,
};

function setup(workspace: 'customer' | 'vendor' = 'customer') {
  setWorkspaceUser(user);
  selectWorkspace(workspace);
  let saved: AccountDetails = {
    ...details,
    workspace,
    business_name: workspace === 'vendor' ? 'Craft House' : null,
  };
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input, init) => {
      const path = String(input).replace('/api/v1', '');
      if (path === '/me/account-details') {
        if (init?.method === 'PATCH')
          saved = { ...saved, ...JSON.parse(String(init.body)) };
        return Response.json(saved);
      }
      if (path === '/me/account-details/avatar') {
        saved = {
          ...saved,
          avatar_url:
            init?.method === 'DELETE'
              ? null
              : '/api/v1/me/account-details/avatar/content',
        };
        return Response.json(saved);
      }
      if (path === '/me') return Response.json(user);
      if (path === '/auth/password/forgot')
        return Response.json({ message: 'Check your email for a reset link.' });
      if (path === '/vendor/shop') return Response.json({ id: 'shop-2' });
      throw new Error(`Unexpected request: ${path}`);
    });
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setWorkspaceUser(null);
  shopContext.shops = [];
  shopContext.error = '';
  shopContext.loading = false;
  shopContext.refresh.mockClear();
  window.history.replaceState(null, '', '/');
});

describe('role-aware account settings', () => {
  it('saves customer names and preferences, and reads them back without vendor fields', async () => {
    const fetchMock = setup();
    const view = render(<AccountProfile workspace="customer" />);
    fireEvent.change(await screen.findByLabelText('First name'), {
      target: { value: 'Updated' },
    });
    fireEvent.change(screen.getByLabelText('Last name'), {
      target: { value: 'Person' },
    });
    fireEvent.change(screen.getByLabelText('Preferred shopping categories'), {
      target: { value: 'Crafts, Clothing' },
    });
    fireEvent.click(screen.getByLabelText('Optional email updates'));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      await screen.findByText('Your profile has been updated.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toHaveAttribute('readonly');
    expect(
      screen.queryByLabelText('Business registration / Tax ID'),
    ).not.toBeInTheDocument();
    const patch = fetchMock.mock.calls.find(
      ([, init]) => init?.method === 'PATCH',
    );
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({
      first_name: 'Updated',
      last_name: 'Person',
      phone: user.profile.phone,
      preferred_categories: ['Crafts', 'Clothing'],
      communication_email: true,
      communication_sms: false,
    });
    view.unmount();
    render(<AccountProfile workspace="customer" />);
    expect(await screen.findByLabelText('First name')).toHaveValue('Updated');
    expect(screen.getByLabelText('Preferred shopping categories')).toHaveValue(
      'Crafts, Clothing',
    );
    expect(screen.getByLabelText('Optional email updates')).toBeChecked();
  });

  it('renders and saves vendor metadata without customer preferences', async () => {
    const fetchMock = setup('vendor');
    render(<AccountProfile workspace="vendor" />);
    expect(
      await screen.findByLabelText('Registered business name'),
    ).toHaveValue('Craft House');
    expect(
      screen.queryByLabelText('Preferred shopping categories'),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Business / vendor category'), {
      target: { value: 'Handicrafts' },
    });
    fireEvent.change(screen.getByLabelText('Business registration / Tax ID'), {
      target: { value: 'PAN-123' },
    });
    fireEvent.change(screen.getByLabelText('Payout preference'), {
      target: { value: 'bank_transfer' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Your profile has been updated.');
    const patch = fetchMock.mock.calls.find(
      ([, init]) => init?.method === 'PATCH',
    );
    const body = JSON.parse(String(patch?.[1]?.body));
    expect(body.business_category).toBe('Handicrafts');
    expect(body.registration_number).toBe('PAN-123');
    expect(body.payout_preference).toBe('bank_transfer');
    expect(body).not.toHaveProperty('preferred_categories');
    const headers = new Headers(patch?.[1]?.headers);
    expect(headers.get('X-VMarket-Workspace')).toBe('vendor');
    expect(headers.has('X-VMarket-Shop-Id')).toBe(false);
  });

  it('uploads and removes a photo without discarding unsaved edits', async () => {
    const fetchMock = setup();
    render(<AccountProfile workspace="customer" />);
    fireEvent.change(await screen.findByLabelText('First name'), {
      target: { value: 'Unsaved' },
    });
    fireEvent.change(screen.getByLabelText('Change photo'), {
      target: {
        files: [new File(['png'], 'photo.png', { type: 'image/png' })],
      },
    });
    expect(await screen.findByAltText('Your profile photo')).toHaveAttribute(
      'src',
      '/api/v1/me/account-details/avatar/content?photo=1',
    );
    expect(screen.getByLabelText('First name')).toHaveValue('Unsaved');
    const upload = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith('/avatar'),
    );
    expect(upload?.[1]?.body).toBeInstanceOf(FormData);
    expect(new Headers(upload?.[1]?.headers).has('Content-Type')).toBe(false);
    fireEvent.change(screen.getByLabelText('Change photo'), {
      target: {
        files: [new File(['replacement'], 'new.png', { type: 'image/png' })],
      },
    });
    await waitFor(() =>
      expect(screen.getByAltText('Your profile photo')).toHaveAttribute(
        'src',
        '/api/v1/me/account-details/avatar/content?photo=2',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove photo' }));
    await screen.findByText('Profile photo removed.');
    expect(screen.queryByAltText('Your profile photo')).not.toBeInTheDocument();
  });

  it('rejects unsupported and oversized photos before uploading', async () => {
    const fetchMock = setup();
    render(<AccountProfile workspace="customer" />);
    const photo = await screen.findByLabelText('Change photo');
    for (const file of [
      new File(['svg'], 'photo.svg', { type: 'image/svg+xml' }),
      new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'large.png', {
        type: 'image/png',
      }),
    ]) {
      fireEvent.change(photo, { target: { files: [file] } });
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'no larger than 2 MB',
      );
    }
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).endsWith('/avatar')),
    ).toBe(false);
  });

  it('rejects combined names exceeding the persisted full-name limit', async () => {
    const fetchMock = setup();
    render(<AccountProfile workspace="customer" />);
    fireEvent.change(await screen.findByLabelText('First name'), {
      target: { value: 'A'.repeat(120) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '120 characters or fewer',
    );
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH'),
    ).toBe(false);
  });

  it('shows load failures, retries, and preserves edits when saving fails', async () => {
    const fetchMock = setup();
    fetchMock.mockResolvedValueOnce(
      Response.json(
        { error: { message: 'Temporarily unavailable' } },
        { status: 503 },
      ),
    );
    render(<AccountProfile workspace="customer" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Temporarily unavailable',
    );
    expect(
      screen.queryByRole('button', { name: 'Save changes' }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Retry loading details' }),
    );
    fireEvent.change(await screen.findByLabelText('First name'), {
      target: { value: 'Keep this' },
    });
    fetchMock.mockResolvedValueOnce(
      Response.json(
        { error: { message: 'Phone already used' } },
        { status: 409 },
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Phone already used',
    );
    expect(screen.getByLabelText('First name')).toHaveValue('Keep this');
  });

  it('does not render a stale customer response after switching to vendor', async () => {
    const fetchMock = setup();
    let resolve: (value: Response) => void = () => {};
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const view = render(<AccountProfile key="customer" workspace="customer" />);
    selectWorkspace('vendor');
    view.rerender(<AccountProfile key="vendor" workspace="vendor" />);
    await screen.findByLabelText('Registered business name');
    resolve(Response.json({ ...details, first_name: 'Obsolete customer' }));
    await waitFor(() =>
      expect(screen.getByLabelText('First name')).toHaveValue('Test'),
    );
    expect(
      screen.queryByDisplayValue('Obsolete customer'),
    ).not.toBeInTheDocument();
  });

  it('requires explicit shop selection and saves only the selected shop', async () => {
    const fetchMock = setup('vendor');
    shopContext.shops = [
      { id: 'shop-1', name: 'First shop', description: null },
      { id: 'shop-2', name: 'Second shop', description: 'Crafts' },
    ];
    const view = render(<ShopProfile />);
    expect(
      screen.getByText(/No shop is selected automatically/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Shop name')).not.toBeInTheDocument();
    selectShop('shop-2', ['shop-1', 'shop-2']);
    view.rerender(<ShopProfile />);
    fireEvent.change(await screen.findByLabelText('Shop name'), {
      target: { value: 'Updated second shop' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save shop details' }));
    await screen.findByText('Shop details updated.');
    const patch = fetchMock.mock.calls.find(
      ([, init]) => init?.method === 'PATCH',
    );
    expect(new Headers(patch?.[1]?.headers).get('X-VMarket-Shop-Id')).toBe(
      'shop-2',
    );
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({
      name: 'Updated second shop',
      description: 'Crafts',
    });
    expect(shopContext.refresh).toHaveBeenCalledOnce();
  });

  it('uses the real password reset endpoint and does not offer unsupported card storage', async () => {
    const fetchMock = setup();
    render(<AccountSecurity email={user.email} workspace="customer" />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Send password reset link' }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Check your email',
    );
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/auth/password/forgot');
    expect(
      screen.getByText(/Cash on delivery is currently the only supported/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Add.*card/i }),
    ).not.toBeInTheDocument();
  });

  it('provides accessible sidebar selection and functional sign out', () => {
    setup();
    const signOut = vi.fn();
    render(
      <AccountShell
        busy={false}
        onSignOut={signOut}
        user={user}
        workspace="customer"
      >
        <h1>Profile settings</h1>
      </AccountShell>,
    );
    expect(screen.getByRole('link', { name: 'My details' })).toHaveAttribute(
      'aria-current',
      'location',
    );
    fireEvent.click(screen.getByRole('link', { name: 'Address book' }));
    expect(screen.getByRole('link', { name: 'Address book' })).toHaveAttribute(
      'aria-current',
      'location',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(signOut).toHaveBeenCalledOnce();
  });
});
