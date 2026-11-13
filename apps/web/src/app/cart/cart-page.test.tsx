import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cart, CartItem } from '@/lib/api';
import { installTestWorkspace } from '@/test-workspace';

import CartPage from './cart-page';

const basket: CartItem = {
  id: 'cart-item-1',
  product_id: 'product-1',
  product_slug: 'woven-basket',
  variant_id: null,
  product_name: 'Woven Basket',
  variant_name: null,
  sku: 'BASKET-1',
  image_url: null,
  image_alt: 'Woven Basket',
  shop_id: 'shop-1',
  shop_name: 'First Shop',
  unit_price: '100.50',
  quantity: 1,
  available_stock: 4,
  line_total: '100.50',
};

const cart: Cart = { items: [basket], item_count: 1, subtotal: '100.50' };

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

type Handler = (
  url: string,
  init: RequestInit | undefined,
) => Response | Promise<Response> | undefined;

function mockApi(handler: Handler = () => undefined) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input: RequestInfo | URL, init?) => {
      const url = String(input);
      const handled = await handler(url, init);
      if (handled) return handled;
      if (url.endsWith('/me/cart')) return Response.json(cart);
      if (url.endsWith('/me/addresses')) return Response.json([address]);
      if (url.endsWith('/me/wishlist')) return Response.json([]);
      throw new Error(`Unexpected request: ${url} ${init?.method ?? 'GET'}`);
    });
}

function requestsTo(
  fetchMock: ReturnType<typeof mockApi>,
  suffix: string,
  method = 'GET',
) {
  return fetchMock.mock.calls.filter(
    ([input, init]) =>
      String(input).endsWith(suffix) && (init?.method ?? 'GET') === method,
  );
}

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

    expect((await screen.findAllByRole('alert'))[0]).not.toBeEmptyDOMElement();
    expect(screen.getByText('Your cart is unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Your cart is empty')).not.toBeInTheDocument();
  });

  it.each(['native', 'LAN HTTP'])(
    'submits COD checkout using %s UUID generation',
    async (mode) => {
      let orderPlaced = false;
      const fetchMock = mockApi((url) => {
        if (url.endsWith('/me/cart'))
          return Response.json(
            orderPlaced ? { items: [], item_count: 0, subtotal: '0.00' } : cart,
          );
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
      });
      vi.stubGlobal(
        'crypto',
        mode === 'native'
          ? { randomUUID: () => 'stable-checkout-idempotency-key' }
          : { getRandomValues: (bytes: Uint8Array) => bytes.fill(255) },
      );
      render(<CartPage />);

      expect(
        await screen.findByRole('link', { name: 'Woven Basket' }),
      ).toHaveAttribute('href', '/marketplace/woven-basket');
      expect(screen.getByText('NPR 200.50')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Place order' }));

      expect(
        await screen.findByText(/Order VM-20261104-ABCDE12345 placed/),
      ).toBeInTheDocument();
      const [checkoutRequest] = requestsTo(fetchMock, '/me/checkout', 'POST');
      expect(checkoutRequest).toBeDefined();
      expect(JSON.parse(String(checkoutRequest[1]?.body))).toEqual({
        address_id: 'address-1',
        payment_method: 'cash_on_delivery',
        idempotency_key:
          mode === 'native'
            ? 'stable-checkout-idempotency-key'
            : 'ffffffff-ffff-4fff-bfff-ffffffffffff',
        promotion_code: null,
      });
      expect(await screen.findByText('Your cart is empty')).toBeInTheDocument();
    },
  );

  it('shows random generation failures and re-enables checkout', async () => {
    const fetchMock = mockApi();
    vi.stubGlobal('crypto', undefined);
    render(<CartPage />);

    await screen.findByRole('link', { name: 'Woven Basket' });
    fireEvent.click(screen.getByRole('button', { name: 'Place order' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Secure random generation is unavailable',
    );
    expect(screen.getByRole('button', { name: 'Place order' })).toBeEnabled();
    expect(requestsTo(fetchMock, '/me/checkout', 'POST')).toHaveLength(0);
  });

  it('reuses the LAN HTTP idempotency key after a failed checkout', async () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => bytes.fill(255));
    vi.stubGlobal('crypto', { getRandomValues });
    const fetchMock = mockApi((url) =>
      url.endsWith('/me/checkout')
        ? Response.json(
            {
              error: { code: 'unavailable', message: 'Please retry checkout.' },
            },
            { status: 503 },
          )
        : undefined,
    );
    render(<CartPage />);

    await screen.findByRole('link', { name: 'Woven Basket' });
    fireEvent.click(screen.getByRole('button', { name: 'Place order' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Place order' }));

    await waitFor(() =>
      expect(requestsTo(fetchMock, '/me/checkout', 'POST')).toHaveLength(2),
    );
    const requests = requestsTo(fetchMock, '/me/checkout', 'POST');
    expect(requests[0][1]?.body).toBe(requests[1][1]?.body);
    expect(getRandomValues).toHaveBeenCalledOnce();
  });

  it('sends a staged promotion code with checkout without claiming a discount', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'promo-key' });
    const fetchMock = mockApi((url) =>
      url.endsWith('/me/checkout')
        ? Response.json(
            {
              error: {
                code: 'promotion_invalid',
                message: 'This promotion code is not valid.',
              },
            },
            { status: 422 },
          )
        : undefined,
    );
    render(<CartPage />);

    await screen.findByRole('link', { name: 'Woven Basket' });
    fireEvent.change(screen.getByLabelText(/promo/i), {
      target: { value: ' save10 ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByText(/Before promotion discount/)).toBeInTheDocument();
    expect(screen.getByText('NPR 200.50')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Place order' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This promotion code is not valid.',
    );
    const [request] = requestsTo(fetchMock, '/me/checkout', 'POST');
    expect(JSON.parse(String(request[1]?.body)).promotion_code).toBe('SAVE10');
  });
});

describe('cart items', () => {
  beforeEach(() => installTestWorkspace());

  it('shows product details, per-shop delivery and checkout assurances', async () => {
    mockApi((url) =>
      url.endsWith('/me/cart')
        ? Response.json({
            items: [
              { ...basket, quantity: 2, line_total: '201.00' },
              {
                ...basket,
                id: 'cart-item-2',
                product_id: 'product-2',
                product_slug: 'clay-cup',
                product_name: 'Clay Cup',
                variant_id: 'variant-1',
                variant_name: 'Blue',
                sku: 'CUP-BLUE',
                shop_id: 'shop-2',
                shop_name: 'Second Shop',
                unit_price: '50.00',
                line_total: '50.00',
              },
            ],
            item_count: 3,
            subtotal: '251.00',
          })
        : undefined,
    );
    render(<CartPage />);

    const items = await screen.findByRole('list', { name: 'Cart items' });
    expect(within(items).getAllByRole('listitem')).toHaveLength(2);
    expect(within(items).getByText('CUP-BLUE')).toBeInTheDocument();
    expect(within(items).getByText('Blue')).toBeInTheDocument();
    expect(
      screen.getByRole('list', { name: 'Shops in cart' }),
    ).toHaveTextContent(/First Shop.*Second Shop/);
    expect(screen.getByText('NPR 451.00')).toBeInTheDocument();
    expect(screen.queryByText(/free shipping/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole('list', { name: 'Checkout assurances' }),
    ).toHaveTextContent('Cash on delivery');
  });

  it('updates quantities with the stepper and validates typed values locally', async () => {
    const fetchMock = mockApi((url, init) =>
      url.endsWith('/me/cart/items/cart-item-1') && init?.method === 'PATCH'
        ? Response.json({
            items: [{ ...basket, quantity: 2, line_total: '201.00' }],
            item_count: 2,
            subtotal: '201.00',
          })
        : undefined,
    );
    render(<CartPage />);

    await screen.findByRole('link', { name: 'Woven Basket' });
    expect(
      screen.getByRole('button', { name: 'Decrease Woven Basket quantity' }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Increase Woven Basket quantity' }),
    );

    await waitFor(() =>
      expect(screen.getByLabelText('Woven Basket quantity')).toHaveValue(2),
    );
    const [patch] = requestsTo(
      fetchMock,
      '/me/cart/items/cart-item-1',
      'PATCH',
    );
    expect(JSON.parse(String(patch[1]?.body))).toEqual({ quantity: 2 });
    expect(screen.getByText('NPR 301.00')).toBeInTheDocument();

    const input = screen.getByLabelText('Woven Basket quantity');
    fireEvent.change(input, { target: { value: '9' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Choose a quantity from 1 to 4 for Woven Basket.',
    );
    expect(input).toHaveValue(2);
    expect(
      requestsTo(fetchMock, '/me/cart/items/cart-item-1', 'PATCH'),
    ).toHaveLength(1);
  });

  it('removes an item and reloads the server cart', async () => {
    let removed = false;
    const fetchMock = mockApi((url, init) => {
      if (
        url.endsWith('/me/cart/items/cart-item-1') &&
        init?.method === 'DELETE'
      ) {
        removed = true;
        return new Response(null, { status: 204 });
      }
      if (url.endsWith('/me/cart') && removed)
        return Response.json({ items: [], item_count: 0, subtotal: '0.00' });
    });
    render(<CartPage />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Remove Woven Basket' }),
    );

    expect(await screen.findByText('Your cart is empty')).toBeInTheDocument();
    expect(
      requestsTo(fetchMock, '/me/cart/items/cart-item-1', 'DELETE'),
    ).toHaveLength(1);
    expect(
      screen.getByText('Woven Basket was removed from your cart.'),
    ).toBeInTheDocument();
  });

  it('saves an item for later and lists it from the wishlist', async () => {
    let saved = false;
    const fetchMock = mockApi((url, init) => {
      if (url.endsWith('/me/wishlist/product-1') && init?.method === 'POST')
        return new Response(null, { status: 204 });
      if (
        url.endsWith('/me/cart/items/cart-item-1') &&
        init?.method === 'DELETE'
      ) {
        saved = true;
        return new Response(null, { status: 204 });
      }
      if (url.endsWith('/me/cart') && saved)
        return Response.json({ items: [], item_count: 0, subtotal: '0.00' });
      if (url.endsWith('/me/wishlist') && saved)
        return Response.json([
          {
            id: 'product-1',
            slug: 'woven-basket',
            name: 'Woven Basket',
            price: '100.50',
            available: true,
            images: [],
          },
        ]);
    });
    render(<CartPage />);

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Save for later Woven Basket',
      }),
    );

    const savedList = await screen.findByRole('region', {
      name: 'Saved for later (1)',
    });
    expect(
      within(savedList).getByRole('link', { name: /Woven Basket/ }),
    ).toHaveAttribute('href', '/marketplace/woven-basket');
    expect(
      requestsTo(fetchMock, '/me/wishlist/product-1', 'POST'),
    ).toHaveLength(1);
  });

  it('reports a partial save when the item stays in the cart', async () => {
    mockApi((url, init) => {
      if (url.endsWith('/me/wishlist/product-1') && init?.method === 'POST')
        return new Response(null, { status: 204 });
      if (
        url.endsWith('/me/cart/items/cart-item-1') &&
        init?.method === 'DELETE'
      )
        return Response.json(
          { error: { code: 'unavailable', message: 'Try again.' } },
          { status: 503 },
        );
    });
    render(<CartPage />);

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Save for later Woven Basket',
      }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Woven Basket was saved to your wishlist, but it could not be removed from your cart.',
    );
    expect(
      screen.getByRole('link', { name: 'Woven Basket' }),
    ).toBeInTheDocument();
  });

  it('blocks checkout when a quantity exceeds available stock', async () => {
    mockApi((url) =>
      url.endsWith('/me/cart')
        ? Response.json({
            ...cart,
            items: [{ ...basket, quantity: 3, available_stock: 2 }],
          })
        : undefined,
    );
    render(<CartPage />);

    await screen.findByRole('link', { name: 'Woven Basket' });
    expect(screen.getByRole('button', { name: 'Place order' })).toBeDisabled();
    expect(screen.getAllByText('Only 2 available').length).toBeGreaterThan(0);
  });
});
