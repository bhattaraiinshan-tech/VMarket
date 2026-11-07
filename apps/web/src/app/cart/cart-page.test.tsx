import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installTestWorkspace } from '@/test-workspace';

import CartPage from './cart-page';

const cart = {
  items: [
    {
      id: 'cart-item-1',
      product_id: 'product-1',
      variant_id: null,
      product_name: 'Woven Basket',
      variant_name: null,
      shop_id: 'shop-1',
      shop_name: 'First Shop',
      unit_price: '100.50',
      quantity: 1,
      available_stock: 4,
      line_total: '100.50',
    },
  ],
  item_count: 1,
  subtotal: '100.50',
};

const address = {
  id: 'address-1',
  label: 'Home',
  recipient_name: 'A Customer',
  phone: '+977 9800000000',
  province: 'Bagmati',
  city: 'Kathmandu',
  area: 'Ward 1',
  street_address: '1 Market Road',
  postal_code: '44600',
  is_default: true,
  created_at: '2026-11-04T00:00:00Z',
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('cart checkout', () => {
  beforeEach(() => installTestWorkspace());
  it('shows cart load failures instead of presenting them as an empty cart', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        { error: { code: 'not_found', message: 'Not Found' } },
        { status: 404 },
      ),
    );
    render(<CartPage />);

    expect(await screen.findByRole('alert')).not.toBeEmptyDOMElement();
    expect(screen.getByText('Your cart is unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Your cart is empty')).not.toBeInTheDocument();
  });

  it('updates the cart and submits COD checkout using a saved address', async () => {
    let orderPlaced = false;
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          if (url.endsWith('/me/cart')) {
            return Response.json(
              orderPlaced
                ? { items: [], item_count: 0, subtotal: '0.00' }
                : cart,
            );
          }
          if (url.endsWith('/me/addresses')) return Response.json([address]);
          if (url.endsWith('/me/checkout')) {
            orderPlaced = true;
            return Response.json({
              id: 'order-1',
              order_number: 'VM-20261104-ABCDE12345',
              invoice_number: 'INV-VM-20261104-ABCDE12345',
              status: 'pending',
              payment_method: 'cash_on_delivery',
              shipping_address: {
                recipient_name: 'A Customer',
                street_address: '1 Market Road',
                city: 'Kathmandu',
                province: 'Bagmati',
              },
              subtotal: '100.50',
              shipping_total: '100.00',
              total: '200.50',
              created_at: '2026-11-04T00:00:00Z',
              updated_at: '2026-11-04T00:00:00Z',
              fulfillments: [],
            });
          }
          if (url.endsWith('/me/cart/items/cart-item-1'))
            return Response.json(cart);
          throw new Error(
            `Unexpected request: ${url} ${init?.method ?? 'GET'}`,
          );
        },
      );
    vi.stubGlobal('crypto', {
      randomUUID: () => 'stable-checkout-idempotency-key',
    });
    render(<CartPage />);

    expect(await screen.findByText('Woven Basket')).toBeInTheDocument();
    expect(screen.getByText('NPR 200.50')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Place order' }));

    expect(
      await screen.findByText(/Order VM-20261104-ABCDE12345 placed/),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/me/checkout'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"payment_method":"cash_on_delivery"'),
        }),
      ),
    );
    const checkoutRequest = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith('/me/checkout'),
    );
    expect(checkoutRequest).toBeDefined();
    expect(JSON.parse(String(checkoutRequest?.[1]?.body))).toEqual({
      address_id: 'address-1',
      payment_method: 'cash_on_delivery',
      idempotency_key: 'stable-checkout-idempotency-key',
      promotion_code: null,
    });
  });
});
