import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import Marketplace from './marketplace';

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
      name: 'Add Handwoven Basket to wishlist',
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'Add Handwoven Basket to wishlist' }),
    );
    expect(
      await screen.findByRole('button', {
        name: 'Remove Handwoven Basket from wishlist',
      }),
    ).toHaveTextContent('Saved');
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
});
