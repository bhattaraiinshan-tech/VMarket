import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installTestWorkspace } from '@/test-workspace';

import Marketplace from './marketplace';
import MarketplacePage from './page';

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

function installFetchMock() {
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/catalog/categories')) {
        return Response.json([
          {
            id: 'category-1',
            parent_id: null,
            name: 'Home & Living',
            slug: 'home-living',
            attributes: [],
          },
        ]);
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
      screen.getByRole('link', { name: "Vendor's Market" }),
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
      expect(screen.queryByRole('link', { name: 'Cart' }) !== null).toBe(
        workspace === 'customer',
      );
      expect(screen.queryByRole('link', { name: 'Orders' }) !== null).toBe(
        workspace === 'customer',
      );
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
    fireEvent.change(screen.getByLabelText('Brand'), {
      target: { value: 'brand-1' },
    });
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
    const search = screen.getByRole('textbox', { name: 'Search' });
    fireEvent.change(search, { target: { value: 'basket' } });

    fireEvent.click(filters);
    expect(search).not.toBeVisible();
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
});
