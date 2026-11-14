import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import IdentityPortal from './identity-portal';
import ProductDetails from './marketplace/[slug]/product-details';
import SupportPage from './support/support-page';
import WorkspaceSwitcher from './workspace-switcher';
import VendorPromotionsPage from './vendor/promotions/page';
import {
  selectShop,
  selectWorkspace,
  setWorkspaceUser,
  type Workspace,
} from '@/lib/workspace-state';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const account = {
  id: 'user-1',
  email: 'user@example.com',
  email_verified: true,
  account_status: 'active',
  roles: ['customer', 'vendor', 'admin'],
  profile: { full_name: 'Test User', phone: null },
  vendor_profile: { business_name: 'Test Vendor' },
  owned_shop_ids: ['owned-shop', 'second-shop'],
};
const product = {
  id: 'product-1',
  shop_id: 'owned-shop',
  shop_name: 'My Shop',
  shop_slug: 'my-shop',
  category_id: 'category-1',
  category_name: 'Food',
  name: 'Rice',
  slug: 'rice',
  description: 'Rice',
  sku: 'RICE',
  price: '100',
  stock: 5,
  available: true,
  attributes: {},
  status: 'approved',
  moderation_notes: null,
  images: [],
  variants: [],
};

function select(workspace: Workspace) {
  setWorkspaceUser(account);
  selectWorkspace(workspace);
  if (workspace === 'vendor') selectShop('owned-shop', account.owned_shop_ids);
}

afterEach(() => {
  cleanup();
  setWorkspaceUser(null);
  vi.restoreAllMocks();
});

describe('workspace-specific screens', () => {
  it('connects the account header search and customer links to real routes', () => {
    select('customer');
    render(<WorkspaceSwitcher accountHeader />);
    const search = screen.getByRole('search');
    expect(search).toHaveAttribute('action', '/marketplace');
    expect(screen.getByLabelText('Search products')).toHaveAttribute(
      'name',
      'q',
    );
    const quickLinks = within(
      screen.getByRole('navigation', { name: 'Quick links' }),
    );
    expect(quickLinks.getByRole('link', { name: 'Messages' })).toHaveAttribute(
      'href',
      '/messages',
    );
    expect(
      quickLinks.getByRole('button', { name: /^Notifications,/ }),
    ).toHaveAttribute('aria-expanded', 'false');
    expect(quickLinks.getByRole('link', { name: 'Cart' })).toHaveAttribute(
      'href',
      '/cart',
    );
    fireEvent.click(screen.getByText('Your account'));
    const selector = screen.getByLabelText('Workspace');
    expect(selector).toHaveValue('customer');
    expect(screen.getByRole('option', { name: 'Vendor' })).toBeInTheDocument();
    fireEvent.change(selector, { target: { value: 'vendor' } });
    expect(screen.getByLabelText('Shop')).toHaveValue('');
  });
  it.each(['customer', 'vendor', 'admin'] as const)(
    'shows only %s navigation',
    (workspace) => {
      select(workspace);
      render(<WorkspaceSwitcher />);
      const nav = screen.getByRole('navigation', {
        name: `${workspace} navigation`,
      });
      expect(nav.querySelector('a[href="/cart"]') !== null).toBe(
        workspace === 'customer',
      );
      expect(nav.querySelector('a[href="/vendor/trade"]') !== null).toBe(
        workspace === 'vendor',
      );
      expect(nav.querySelector('a[href="/admin/accounts"]') !== null).toBe(
        workspace === 'admin',
      );
      if (workspace === 'vendor')
        expect(
          screen.getByRole('button', { name: 'Create shop' }),
        ).toBeEnabled();
    },
  );

  it('routes owners to platform support without fetching personal tickets', () => {
    select('admin');
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    render(<SupportPage orderId="" initialKind="support" />);
    expect(
      screen.getByRole('link', {
        name: 'Open platform support and moderation queue',
      }),
    ).toHaveAttribute('href', '/admin/communications');
    expect(
      screen.queryByRole('button', { name: 'Send request' }),
    ).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['vendor', 'admin'] as const)(
    'hides Customer purchase controls in %s workspace',
    async (workspace) => {
      select(workspace);
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const path = String(input);
        if (path.endsWith('/catalog/products/rice'))
          return Response.json(product);
        if (path.includes('/catalog/products?'))
          return Response.json({ items: [] });
        return Response.json([]);
      });
      render(<ProductDetails slug="rice" />);
      await screen.findByRole('heading', { name: 'Rice' });
      expect(
        screen.queryByRole('button', { name: 'Add to cart' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Message vendor' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /Add to wishlist/ }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByText(
          'Select Customer workspace above to shop, save products or contact vendors.',
        ),
      ).toBeInTheDocument();
    },
  );

  it('blocks purchases from any owned shop in Customer workspace', async () => {
    select('customer');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).endsWith('/catalog/products/rice'))
        return Response.json(product);
      if (String(input).includes('/catalog/products?'))
        return Response.json({ items: [] });
      return Response.json([]);
    });
    render(<ProductDetails slug="rice" />);
    expect(
      await screen.findByRole('button', { name: 'Add to cart' }),
    ).toBeDisabled();
    expect(
      screen.getByText(/You cannot buy from your own shops/),
    ).toBeInTheDocument();
  });

  it('does not request or render applicant and customer data for a dedicated owner screen', async () => {
    select('admin');
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) =>
        String(input).endsWith('/me')
          ? Response.json(account)
          : Response.json([]),
      );
    render(<IdentityPortal adminOnly />);
    await screen.findByRole('heading', { name: 'Administrator review queue' });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(
      fetchMock.mock.calls.some(([input]) =>
        /\/vendors\/applications|\/me\/addresses/.test(String(input)),
      ),
    ).toBe(false);
    expect(
      screen.queryByRole('heading', { name: 'Vendor workspace access' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Profile' }),
    ).not.toBeInTheDocument();
  });

  it.each(['vendor', 'admin'] as const)(
    'does not show Customer profile data in %s workspace',
    async (workspace) => {
      select(workspace);
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (input) =>
          Response.json(
            String(input).endsWith('/me/account-details')
              ? {
                  workspace: 'vendor',
                  first_name: 'Vendor',
                  last_name: 'User',
                  email: 'vendor@example.test',
                  email_verified: true,
                  phone: null,
                  avatar_url: null,
                  preferred_categories: [],
                  communication_email: false,
                  communication_sms: false,
                  business_name: 'Vendor business',
                  business_category: null,
                  registration_number: null,
                  payout_preference: null,
                  business_description: null,
                }
              : [],
          ),
        );
      render(<IdentityPortal />);

      if (workspace === 'vendor') {
        expect(
          await screen.findByLabelText('Registered business name'),
        ).toHaveValue('Vendor business');
      } else {
        expect(
          screen.queryByRole('heading', { name: 'Profile' }),
        ).not.toBeInTheDocument();
      }
      expect(
        screen.queryByLabelText('Preferred shopping categories'),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { name: 'Delivery addresses' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { name: 'Vendor workspace access' }),
      ).not.toBeInTheDocument();
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(
        fetchMock.mock.calls.some(([input]) =>
          /\/vendors\/applications|\/me\/addresses/.test(String(input)),
        ),
      ).toBe(false);
    },
  );

  it('recovers a committed registration after an email-delivery failure by resending verification', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const path = String(input);
        if (path.endsWith('/auth/register'))
          return Response.json(
            {
              error: {
                code: 'email_delivery_unavailable',
                message: 'Email delivery is temporarily unavailable.',
              },
            },
            { status: 503 },
          );
        if (path.endsWith('/auth/resend-verification'))
          return Response.json({ message: 'Verification email sent.' });
        return Response.json(
          { error: { message: 'Sign in required.' } },
          { status: 401 },
        );
      });
    render(<IdentityPortal />);
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    fireEvent.change(screen.getByLabelText('Full name'), {
      target: { value: 'Test Customer' },
    });
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'new@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^Password/), {
      target: { value: 'a-secure-password' },
    });
    const form = screen.getByLabelText('Email').closest('form');
    if (!form) throw new Error('Registration form was not rendered.');
    fireEvent.submit(form);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your account was created',
    );
    expect(
      screen.getByRole('heading', { name: 'Welcome back' }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Resend verification email' }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Verification email sent.',
    );
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).endsWith('/auth/register'),
      ),
    ).toHaveLength(1);
  });

  it('allows a vendor to disable a selected-shop promotion', async () => {
    select('vendor');
    const promotion = {
      id: 'promotion-1',
      code: 'SHOP10',
      title: 'Discount',
      discount_type: 'percent',
      discount_value: '10',
      redemption_count: 0,
      is_active: true,
    };
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (_, init) =>
        init?.method === 'PATCH'
          ? Response.json({ ...promotion, is_active: false })
          : Response.json([promotion]),
      );
    render(<VendorPromotionsPage />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Disable SHOP10' }),
    );
    expect(
      await screen.findByRole('button', { name: 'Enable SHOP10' }),
    ).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/vendor/promotions/promotion-1'),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ is_active: false }),
      }),
    );
  });
});
