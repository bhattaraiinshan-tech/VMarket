import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installTestWorkspace, testUser } from '@/test-workspace';
import {
  selectShop,
  selectWorkspace,
  setWorkspaceUser,
} from '@/lib/workspace-state';

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

  function installOwnedTransferMock(showOwnedListing = false) {
    setWorkspaceUser({
      ...testUser,
      owned_shop_ids: ['buyer-shop', 'second-shop'],
    });
    selectWorkspace('vendor');
    selectShop('buyer-shop', ['buyer-shop', 'second-shop']);
    return vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.endsWith('/vendor/shop')) return Response.json(shop);
        if (url.includes('/vendor/products?'))
          return Response.json({
            items: [
              {
                id: 'source-product',
                name: 'Source rice',
                stock: 10,
                category_id: 'grains',
                status: 'approved',
              },
            ],
          });
        if (url.endsWith('/vendor/trade/transfer-destinations'))
          return Response.json([
            {
              shop_id: 'second-shop',
              shop_name: 'Second shop',
              product_id: 'receiving-product',
              product_name: 'Receiving rice',
              category_id: 'grains',
            },
          ]);
        if (url.endsWith('/trade/listings') && !url.includes('/vendor/'))
          return Response.json(
            showOwnedListing
              ? [{ ...supplierListing, shop_id: 'second-shop' }]
              : [],
          );
        if (url.endsWith('/trade/transfers') && init?.method === 'POST')
          return Response.json({ id: 'transfer-1' }, { status: 201 });
        return Response.json([]);
      });
  }

  it('transfers to an owned-shop product that has no wholesale listing', async () => {
    const fetchMock = installOwnedTransferMock();
    render(<TradeWorkspace />);
    fireEvent.change(    await screen.findByLabelText('Your approved product'), {
      target: { value: 'source-product' },
    });
    fireEvent.change(
      screen.getByLabelText('Destination shop and matching product'),
      { target: { value: 'receiving-product' } },
    );
    fireEvent.change(screen.getByLabelText('Transfer quantity'), {
      target: { value: '4' },
    });
    fireEvent.change(screen.getByLabelText('Transfer delivery terms'), {
      target: { value: 'Collect from own shop' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Request transfer' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/trade/transfers'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            destination_shop_id: 'second-shop',
            source_product_id: 'source-product',
            destination_product_id: 'receiving-product',
            quantity: 4,
            delivery_terms: 'Collect from own shop',
          }),
        }),
      ),
    );
  });

  it('does not offer an RFQ for any owned shop, not only the selected shop', async () => {
    installOwnedTransferMock(true);
    render(<TradeWorkspace />);
    await screen.findByRole('heading', { name: 'Basmati rice' });
    expect(
      screen.queryByRole('button', { name: 'Request quote' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/You cannot purchase from your own shops/),
    ).toBeInTheDocument();
  });
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
            url.endsWith('/trade/suppliers') ||
            url.endsWith('/vendor/trade/transfer-destinations')
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
