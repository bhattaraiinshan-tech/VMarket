import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installTestWorkspace } from '@/test-workspace';

import Marketplace from './marketplace';
import MarketplacePage from './page';
import { setWorkspaceUser } from '@/lib/workspace-state';
import { testUser } from '@/test-workspace';
import { WorkspaceProvider } from '@/lib/workspace-context';
import { categoryPath } from './catalog-presentation';

vi.mock('next/navigation', () => ({ usePathname: () => '/marketplace' }));

const product = {
  id: 'product-1',
  shop_id: 'shop-1',
  shop_name: 'Kathmandu Home Store',
  shop_slug: 'kathmandu-home-store',
  category_id: 'category-1',
  category_name: 'Home & Living',
  brand_id: null,
  brand_name: null,
  name: 'Handwoven Basket',
  slug: 'handwoven-basket',
  description: 'A basket made in Nepal.',
  sku: 'BASKET-1',
  price: '1200.50',
  stock: 5,
  available: true,
  attributes: { material: 'bamboo' },
  status: 'approved',
  moderation_notes: null,
  images: [],
  variants: [],
  created_at: '2026-11-04T00:00:00Z',
};

const categories = [
  {
    id: 'category-1',
    parent_id: null,
    name: 'Home & Living',
    slug: 'home-living',
    attributes: [],
  },
  {
    id: 'category-2',
    parent_id: 'category-1',
    name: 'Baskets',
    slug: 'baskets',
    attributes: [],
  },
  {
    id: 'category-3',
    parent_id: 'category-2',
    name: 'Woven',
    slug: 'woven',
    attributes: [],
  },
];

function installFetchMock() {
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/me')) return Response.json(testUser);
      if (url.endsWith('/me/cart'))
        return Response.json({ items: [], item_count: 3, subtotal: '1000' });
      if (url.endsWith('/vendor/shops')) return Response.json([]);
      if (url.includes('/catalog/categories')) {
        return Response.json(categories);
      }
      if (url.includes('/catalog/brands')) {
        return Response.json([
          { id: 'brand-1', name: 'Nepal Craft', slug: 'nepal-craft' },
        ]);
      }
      if (url.includes('/me/wishlist')) return Response.json([]);
      if (url.includes('/shops?')) {
        return Response.json([
          {
            id: 'shop-1',
            name: 'Kathmandu Home Store',
            slug: 'kathmandu-home-store',
            description: null,
            address: null,
            city: 'Kathmandu',
            province: 'Bagmati',
            latitude: '27.717200',
            longitude: '85.324000',
            logo_url: null,
            distance_km: 0,
            created_at: '2026-11-04T00:00:00Z',
          },
        ]);
      }
      if (url.includes('/me/wishlist/')) {
        return new Response(null, { status: 204 });
      }
      return Response.json({
        items: [product],
        total: 1,
        page: 1,
        page_size: 24,
      });
    });
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('marketplace', () => {
  beforeEach(() => installTestWorkspace());
  it('keeps marketplace content and shop discovery without a shortcut rail', async () => {
    installFetchMock();
    render(<Marketplace />);
    expect(await screen.findByText('Handwoven Basket')).toBeInTheDocument();
    expect(
      screen.queryByRole('navigation', { name: 'Marketplace shortcuts' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Find shops near you' }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('banner')).getByRole('link', {
        name: "Vendor's Market",
      }),
    ).toHaveAttribute('href', '/');
  });
  it('applies a search submitted from the account header', async () => {
    const fetchMock = installFetchMock();
    render(
      await MarketplacePage({
        searchParams: Promise.resolve({ q: 'woven basket' }),
      }),
    );
    expect(await screen.findByDisplayValue('woven basket')).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(
          '/catalog/products?page=1&page_size=24&sort=newest&q=woven+basket',
        ),
        expect.anything(),
      ),
    );
  });
  it.each(['customer', 'vendor', 'admin'] as const)(
    'shows only valid %s header actions',
    async (workspace) => {
      installTestWorkspace(workspace);
      installFetchMock();
      render(<Marketplace />);
      await screen.findByText('Handwoven Basket');
      expect(
        screen.queryByRole('button', { name: /^View cart/ }) !== null,
      ).toBe(workspace === 'customer');
      if (workspace === 'customer') {
        fireEvent.click(screen.getByText('Account'));
        expect(
          screen.getByRole('link', { name: 'Customer orders' }),
        ).toHaveAttribute('href', '/orders');
      }
      expect(
        screen.queryByRole('link', { name: 'Vendor workspace' }) !== null,
      ).toBe(workspace === 'vendor');
      expect(
        screen.queryByRole('button', {
          name: 'Add to wishlist: Handwoven Basket',
        }) !== null,
      ).toBe(workspace === 'customer');
    },
  );
  it('searches and filters published products and supports wishlists', async () => {
    const fetchMock = installFetchMock();
    render(<Marketplace />);

    expect(await screen.findByText('Handwoven Basket')).toBeInTheDocument();
    fireEvent.change(
      screen.getByPlaceholderText('Products, descriptions, or SKU'),
      {
        target: { value: 'basket' },
      },
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Nepal Craft' }));
    fireEvent.change(screen.getByLabelText('Minimum price (NPR)'), {
      target: { value: '100' },
    });
    fireEvent.click(screen.getByLabelText('In stock only'));
    fireEvent.click(screen.getByRole('button', { name: 'Search products' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(
          '/catalog/products?page=1&page_size=24&sort=newest&q=basket&brand_id=brand-1&min_price=100&in_stock=true',
        ),
        expect.objectContaining({ credentials: 'include' }),
      ),
    );
    await screen.findByRole('button', {
      name: 'Add to wishlist: Handwoven Basket',
    });
    expect(
      screen.getByRole('button', { name: 'Add to wishlist: Handwoven Basket' }),
    ).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(
      screen.getByRole('button', { name: 'Add to wishlist: Handwoven Basket' }),
    );
    expect(
      await screen.findByRole('button', {
        name: 'Saved: Handwoven Basket',
      }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows real result counts and sorts without applying unsubmitted filters', async () => {
    const fetchMock = installFetchMock();
    render(<Marketplace />);
    expect(
      await screen.findByText('Showing 1–1 of 1 products'),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('City'), {
      target: { value: 'Pokhara' },
    });
    fireEvent.change(screen.getByLabelText('Sort by'), {
      target: { value: 'price_asc' },
    });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(
          '/catalog/products?page=1&page_size=24&sort=price_asc',
        ),
        expect.anything(),
      ),
    );
    const calls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/catalog/products?'),
    );
    expect(String(calls[calls.length - 1][0])).not.toContain('city=');
  });

  it('keeps results visible when unchanged filters are submitted', async () => {
    installFetchMock();
    render(<Marketplace />);
    await screen.findByText('Handwoven Basket');
    fireEvent.click(screen.getByRole('button', { name: 'Search products' }));
    expect(screen.getByText('Handwoven Basket')).toBeInTheDocument();
    expect(screen.queryByText('Loading products…')).not.toBeInTheDocument();
  });

  it('collapses and reopens filters without losing the draft or blocking sorting', async () => {
    const fetchMock = installFetchMock();
    render(<Marketplace />);
    await screen.findByText('Handwoven Basket');
    const filters = screen.getByText('Filters');
    const search = screen.getByRole('searchbox', { name: 'Search' });
    const city = screen.getByLabelText('City');
    fireEvent.change(search, { target: { value: 'basket' } });
    fireEvent.change(city, { target: { value: 'Pokhara' } });

    fireEvent.click(filters);
    expect(city).not.toBeVisible();
    expect(search).toBeVisible();
    expect(screen.getByText('Handwoven Basket')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Sort by'), {
      target: { value: 'price_asc' },
    });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('sort=price_asc'),
        expect.anything(),
      ),
    );

    fireEvent.click(filters);
    expect(city).toHaveValue('Pokhara');
    expect(search).toBeVisible();
    expect(search).toHaveValue('basket');
  });

  it('discovers nearby shops using coordinates', async () => {
    const fetchMock = installFetchMock();
    render(<Marketplace />);

    await screen.findByText('Handwoven Basket');
    fireEvent.change(screen.getByLabelText('Latitude'), {
      target: { value: '27.7172' },
    });
    fireEvent.change(screen.getByLabelText('Longitude'), {
      target: { value: '85.3240' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Find shops' }));

    expect(await screen.findByText('Kathmandu Home Store')).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(
          '/shops?page_size=12&latitude=27.7172&longitude=85.3240',
        ),
        expect.anything(),
      ),
    );
  });

  it('does not present a failed product request as an empty result', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('Network failed'),
    );
    render(<Marketplace />);

    await screen.findByRole('alert');
    await waitFor(() =>
      expect(screen.queryByText('Loading products…')).not.toBeInTheDocument(),
    );
    expect(screen.queryByText('No products found')).not.toBeInTheDocument();
  });

  it('explains when a shop search has no results', async () => {
    const fetchMock = installFetchMock();
    const original = fetchMock.getMockImplementation();
    fetchMock.mockImplementation((input, init) => {
      if (String(input).includes('/shops?'))
        return Promise.resolve(Response.json([]));
      return original!(input, init);
    });
    render(<Marketplace />);

    await screen.findByText('Handwoven Basket');
    fireEvent.click(screen.getByRole('button', { name: 'Find shops' }));
    expect(
      await screen.findByText(
        'No shops found. Try a different location or a larger radius.',
      ),
    ).toHaveAttribute('role', 'status');
  });

  it('uses category URL selection for real breadcrumbs and subcategory links', async () => {
    const fetchMock = installFetchMock();
    render(
      await MarketplacePage({
        searchParams: Promise.resolve({ category_id: 'category-2' }),
      }),
    );
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Baskets' }),
    ).toBeVisible();
    const breadcrumb = within(
      screen.getByRole('navigation', { name: 'Breadcrumb' }),
    );
    expect(
      breadcrumb.getByRole('link', { name: 'Home & Living' }),
    ).toHaveAttribute('href', '/marketplace?category_id=category-1');
    expect(breadcrumb.getByRole('link', { name: 'Baskets' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      within(
        screen.getByRole('navigation', { name: 'Subcategories' }),
      ).getByRole('link', { name: 'Woven' }),
    ).toHaveAttribute('href', '/marketplace?category_id=category-3');
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes('category_id=category-2'),
      ),
    ).toBe(true);
  });

  it('keeps unsent category and price drafts out of sorting, then applies them together', async () => {
    const fetchMock = installFetchMock();
    render(<Marketplace />);
    await screen.findByText('Handwoven Basket');
    fireEvent.change(screen.getByLabelText('Category'), {
      target: { value: 'category-2' },
    });
    fireEvent.change(screen.getByLabelText('Maximum price (NPR)'), {
      target: { value: '2000.50' },
    });
    fireEvent.change(screen.getByLabelText('Sort by'), {
      target: { value: 'price_desc' },
    });
    await waitFor(() => {
      const last = fetchMock.mock.calls
        .filter(([url]) => String(url).includes('/catalog/products?'))
        .at(-1);
      expect(String(last?.[0])).toContain('sort=price_desc');
      expect(String(last?.[0])).not.toContain('category_id=');
      expect(String(last?.[0])).not.toContain('max_price=');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).includes('category_id=category-2&max_price=2000.50'),
        ),
      ).toBe(true),
    );
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Baskets' }),
    ).toBeVisible();
  });

  it('rejects reversed decimal prices without requesting products and accepts a zero minimum', async () => {
    const fetchMock = installFetchMock();
    render(<Marketplace />);
    await screen.findByText('Handwoven Basket');
    fireEvent.change(screen.getByLabelText('Minimum price (NPR)'), {
      target: { value: '9999999999.99' },
    });
    fireEvent.change(screen.getByLabelText('Maximum price (NPR)'), {
      target: { value: '9999999999.98' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Minimum price cannot exceed maximum price.',
    );
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).includes('/catalog/products?'),
      ),
    ).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Minimum price (NPR)'), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).includes('min_price=0&max_price=9999999999.98'),
        ),
      ).toBe(true),
    );
  });

  it('clears all filter drafts and the applied query', async () => {
    const fetchMock = installFetchMock();
    render(<Marketplace initialSearch="basket" initialCategory="category-2" />);
    await screen.findByText('Handwoven Basket');
    fireEvent.click(screen.getByRole('radio', { name: 'Nepal Craft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveValue('');
    expect(screen.getByLabelText('Category')).toHaveValue('');
    expect(screen.getByRole('radio', { name: 'All brands' })).toBeChecked();
    await waitFor(() => {
      const last = fetchMock.mock.calls
        .filter(([url]) => String(url).includes('/catalog/products?'))
        .at(-1);
      expect(String(last?.[0])).toMatch(/page=1&page_size=24&sort=newest$/);
    });
  });

  it('paginates using server totals and resets pagination when filters change', async () => {
    const fetchMock = installFetchMock();
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input, init) => {
      if (String(input).includes('/catalog/products?')) {
        const page = Number(
          new URL(String(input), 'http://localhost').searchParams.get('page'),
        );
        return Promise.resolve(
          Response.json({ items: [product], page, total: 25, page_size: 24 }),
        );
      }
      return original(input, init);
    });
    render(<Marketplace />);
    await screen.findByText('Handwoven Basket');
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Showing 25–25 of 25 products');
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'In stock only' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    await screen.findByText('Showing 1–1 of 25 products');
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes('page=1&page_size=24&sort=newest&in_stock=true'),
      ),
    ).toBe(true);
  });

  it('shows explicit unsupported newsletter, currency, and rating states without invented offers', async () => {
    installFetchMock();
    render(<Marketplace />);
    await screen.findByText('Handwoven Basket');
    expect(screen.getByLabelText('Email address')).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Subscribe (unavailable)' }),
    ).toBeDisabled();
    expect(
      screen.getByText('Newsletter signup is not available yet.'),
    ).toBeVisible();
    expect(screen.getByRole('combobox', { name: /Currency/ })).toBeDisabled();
    fireEvent.click(screen.getByText('Rating'));
    expect(screen.getByText(/Rating filters are not available/)).toBeVisible();
    expect(
      screen.queryByText(/Free shipping|On sale|50% off/i),
    ).not.toBeInTheDocument();
    expect(screen.getByText('NPR 1200.50')).toBeVisible();
  });

  it('does not request protected cart data or show wishlist controls for guests', async () => {
    setWorkspaceUser(null);
    const fetchMock = installFetchMock();
    render(<Marketplace />);
    await screen.findByText('Handwoven Basket');
    expect(
      screen.queryByRole('button', { name: /^View cart/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Add to wishlist/ }),
    ).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('/me/')),
    ).toBe(false);
  });

  it('retains the compact workspace selector and restores vendor shop controls', async () => {
    installFetchMock();
    render(
      <WorkspaceProvider>
        <Marketplace />
      </WorkspaceProvider>,
    );
    await screen.findByText('Handwoven Basket');
    expect(screen.getAllByRole('banner')).toHaveLength(1);
    const trigger = await screen.findByRole('button', {
      name: 'View cart (3)',
    });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    trigger.focus();
    fireEvent.click(trigger);
    const drawer = await screen.findByRole('dialog', {
      name: 'Your cart (3)',
    });
    expect(screen.getByRole('button', { name: 'Close cart' })).toHaveFocus();
    fireEvent.keyDown(drawer, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    fireEvent.click(screen.getByText('Account'));
    fireEvent.change(screen.getByLabelText('Workspace'), {
      target: { value: 'vendor' },
    });
    expect(await screen.findByLabelText('Shop')).toHaveValue('');
    expect(
      screen.getByRole('navigation', { name: 'vendor navigation' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /^View cart/ }),
    ).not.toBeInTheDocument();
  });

  it('ignores a stale product request after filters change', async () => {
    const fetchMock = installFetchMock();
    const original = fetchMock.getMockImplementation()!;
    let resolveOld: (value: Response) => void = () => {
      throw new Error('Request not started');
    };
    fetchMock.mockImplementation((input, init) => {
      if (
        String(input).includes('/catalog/products?') &&
        !String(input).includes('&q=')
      ) {
        return new Promise<Response>((resolve) => {
          resolveOld = resolve;
        });
      }
      return original(input, init);
    });
    render(<Marketplace />);
    await screen.findByRole('radio', { name: 'Nepal Craft' });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search' }), {
      target: { value: 'basket' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search products' }));
    await screen.findByText('Handwoven Basket');
    await act(async () => {
      resolveOld(
        Response.json({ items: [], total: 0, page: 1, page_size: 24 }),
      );
    });
    expect(screen.getByText('Handwoven Basket')).toBeVisible();
    expect(screen.queryByText('No products found')).not.toBeInTheDocument();
  });

  it('allows retrying a failed product query without changing the filters', async () => {
    const fetchMock = installFetchMock();
    const original = fetchMock.getMockImplementation()!;
    let fail = true;
    fetchMock.mockImplementation((input, init) => {
      if (String(input).includes('/catalog/products?') && fail) {
        fail = false;
        return Promise.reject(new Error('Products unavailable'));
      }
      return original(input, init);
    });
    render(<Marketplace />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Products unavailable',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Search products' }));
    expect(await screen.findByText('Handwoven Basket')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('terminates breadcrumbs safely for malformed historical category cycles', () => {
    expect(
      categoryPath(
        [{ ...categories[0], parent_id: 'category-2' }, categories[1]],
        'category-2',
      ),
    ).toHaveLength(2);
  });
});
