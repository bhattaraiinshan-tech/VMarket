import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installTestWorkspace } from '@/test-workspace';

import TradeWorkspace from './trade-workspace';

const supplierListing = {
  id: 'listing-1',
  shop_id: 'supplier-shop',
  shop_name: 'Supplier Market',
  shop_slug: 'supplier-market',
  city: 'Kathmandu',
  province: 'Bagmati',
  product_id: 'supplier-product',
  product_name: 'Basmati rice',
  product_description: 'Wholesale rice.',
  product_sku: 'RICE-1',
  minimum_order_quantity: 10,
  available_quantity: 100,
  unit_label: 'sack',
  is_active: true,
  price_tiers: [{ id: 'tier-1', minimum_quantity: 10, unit_price: '80.00' }],
  created_at: '2026-11-05T00:00:00Z',
};

const shop = {
  id: 'buyer-shop',
  name: 'Buyer Market',
  slug: 'buyer-market',
  description: null,
  address: null,
  city: 'Kathmandu',
  province: 'Bagmati',
  latitude: null,
  longitude: null,
  logo_url: null,
  distance_km: null,
  created_at: '2026-11-05T00:00:00Z',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('vendor trade workspace', () => {
  beforeEach(() => installTestWorkspace('vendor'));
  it('finds suppliers and sends an RFQ for a wholesale listing', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          if (url.endsWith('/vendor/shop')) return Response.json(shop);
          if (url.includes('/vendor/products')) {
            return Response.json({
              items: [],
              total: 0,
              page: 1,
              page_size: 100,
            });
          }
          if (url.endsWith('/trade/rfqs') && init?.method === 'POST') {
            return Response.json({ id: 'rfq-1' }, { status: 201 });
          }
          if (url.endsWith('/vendor/trade/listings')) return Response.json([]);
          if (url.endsWith('/trade/listings')) {
            return Response.json([supplierListing]);
          }
          if (
            url.endsWith('/vendor/trade/listings') ||
            url.endsWith('/trade/rfqs') ||
            url.endsWith('/trade/orders') ||
            url.endsWith('/trade/transfers') ||
            url.endsWith('/trade/suppliers')
          ) {
            return Response.json([]);
          }
          return Response.json(
            { error: { message: 'Unexpected request.' } },
            { status: 404 },
          );
        },
      );

    render(<TradeWorkspace />);

    expect(await screen.findByText('Basmati rice')).toBeInTheDocument();
    const listing = screen
      .getByRole('heading', { name: 'Basmati rice' })
      .closest('li');
    expect(listing).not.toBeNull();
    if (!listing) throw new Error('Supplier listing was not rendered.');
    fireEvent.change(within(listing).getByPlaceholderText('Delivery terms'), {
      target: { value: 'Deliver to our warehouse.' },
    });
    fireEvent.change(
      within(listing).getByPlaceholderText('Message to supplier'),
      {
        target: { value: 'Please quote 20 sacks.' },
      },
    );
    fireEvent.change(within(listing).getByLabelText('Quantity'), {
      target: { value: '20' },
    });
    fireEvent.click(
      within(listing).getByRole('button', { name: 'Request quote' }),
    );

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Request for quotation sent to the supplier.',
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/trade/rfqs'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            listing_id: 'listing-1',
            quantity: 20,
            delivery_terms: 'Deliver to our warehouse.',
            message: 'Please quote 20 sacks.',
          }),
        }),
      ),
    );
  });
});
