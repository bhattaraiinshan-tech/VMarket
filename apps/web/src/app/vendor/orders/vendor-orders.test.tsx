import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestApi, type FulfillmentOrder } from '@/lib/api';
import { selectShop, setWorkspaceUser } from '@/lib/workspace-state';
import { installTestWorkspace } from '@/test-workspace';
import VendorOrders from './vendor-orders';

vi.mock('@/lib/api', () => ({ requestApi: vi.fn() }));
const source: FulfillmentOrder = {
  id: 'shipment-1',
  order_id: 'order-1',
  fulfillment_number: 'SHIP-1001',
  shop_id: 'buyer-shop',
  shop_name: 'Craft House',
  status: 'processing',
  subtotal: '1000.00',
  shipping_fee: '100.00',
  discount_total: '0.00',
  commission_rate_bps: 300,
  commission_amount: '30.00',
  tracking_number: null,
  shipping_address: {},
  created_at: '2026-02-20T08:00:00Z',
  updated_at: '2026-02-20T08:00:00Z',
  events: [],
  transactions: [],
  items: [
    {
      id: 'item-1',
      product_id: 'product-1',
      variant_id: null,
      product_name: 'Basket',
      variant_name: 'Black / Large',
      sku: 'BASKET',
      quantity: 2,
      unit_price: '500.00',
      line_total: '1000.00',
      image_url: '/storage/products/basket.jpg',
    },
  ],
};
beforeEach(() => {
  installTestWorkspace('vendor');
  vi.mocked(requestApi).mockResolvedValue({ items: [source], total: 1 });
});
afterEach(() => {
  cleanup();
  setWorkspaceUser(null);
  vi.resetAllMocks();
});

describe('vendor order history', () => {
  it('uses the account sidebar, real items and fulfillment IDs rather than customer APIs', async () => {
    render(<VendorOrders />);
    await screen.findByText('Basket');
    expect(requestApi).toHaveBeenCalledWith(
      '/vendor/orders?offset=0',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(screen.getByRole('link', { name: 'Shop orders' })).toHaveAttribute(
      'aria-current',
      'location',
    );
    expect(screen.getByRole('link', { name: 'My details' })).toHaveAttribute(
      'href',
      '/vendor/profile#my-details',
    );
    expect(screen.getByRole('link', { name: 'Track Order' })).toHaveAttribute(
      'href',
      '/vendor/orders/shipment-1',
    );
    expect(
      screen.getByText('Variant: Black / Large', { exact: false }),
    ).toHaveTextContent('Quantity: 2');
    expect(screen.getByRole('img', { name: 'Basket' })).toBeInTheDocument();
    expect(screen.getByText('Cash on delivery')).toBeInTheDocument();
  });
  it('filters status, searches variant metadata, sorts and validates date ranges', async () => {
    vi.mocked(requestApi).mockResolvedValue({
      items: [
        source,
        {
          ...source,
          id: 'shipment-2',
          fulfillment_number: 'SHIP-1002',
          status: 'delivered',
          created_at: '2026-03-20T08:00:00Z',
          items: [
            {
              ...source.items[0],
              id: 'item-2',
              product_name: 'Lamp',
              variant_name: 'White',
            },
          ],
        },
      ],
      total: 2,
    });
    render(<VendorOrders />);
    await screen.findByText('Basket');
    const history = screen.getByRole('region', {
      name: 'Vendor fulfillment orders',
    });
    expect(within(history).getAllByRole('article')[0]).toHaveAccessibleName(
      'Order SHIP-1002',
    );
    fireEvent.change(screen.getByLabelText('Sort orders'), {
      target: { value: 'oldest' },
    });
    expect(within(history).getAllByRole('article')[0]).toHaveAccessibleName(
      'Order SHIP-1001',
    );
    fireEvent.click(screen.getByRole('button', { name: /^Delivered/ }));
    expect(screen.queryByText('Basket')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^All orders/ }));
    fireEvent.change(screen.getByLabelText('Search orders'), {
      target: { value: 'black' },
    });
    expect(screen.queryByText('Lamp')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
    fireEvent.change(screen.getByLabelText('From date'), {
      target: { value: '2026-04-01' },
    });
    fireEvent.change(screen.getByLabelText('To date'), {
      target: { value: '2026-03-01' },
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'From date must be on or before To date.',
    );
  });
  it('loads history beyond the initial page', async () => {
    vi.mocked(requestApi)
      .mockResolvedValueOnce({ items: [source], total: 2 })
      .mockResolvedValueOnce({
        items: [{ ...source, id: 'older', fulfillment_number: 'SHIP-OLDER' }],
        total: 2,
      });
    render(<VendorOrders />);
    await screen.findByRole('article', { name: 'Order SHIP-OLDER' });
    expect(requestApi).toHaveBeenLastCalledWith(
      '/vendor/orders?offset=1',
      expect.anything(),
    );
  });
  it('distinguishes failure from empty history and retries', async () => {
    vi.mocked(requestApi)
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockResolvedValueOnce({ items: [], total: 0 });
    render(<VendorOrders />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Unavailable');
    expect(screen.queryByText('No orders yet')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('No orders yet');
  });
  it('aborts and ignores stale history when the selected shop changes', async () => {
    let resolve!: (value: { items: FulfillmentOrder[]; total: number }) => void;
    vi.mocked(requestApi)
      .mockReturnValueOnce(
        new Promise((done) => {
          resolve = done;
        }),
      )
      .mockResolvedValueOnce({ items: [], total: 0 });
    render(<VendorOrders />);
    const signal = vi.mocked(requestApi).mock.calls[0][1]?.signal;
    act(() => selectShop('new-shop', ['buyer-shop', 'new-shop']));
    await screen.findByText('No orders yet');
    expect(signal?.aborted).toBe(true);
    await act(async () => resolve({ items: [source], total: 1 }));
    expect(screen.queryByText('Basket')).not.toBeInTheDocument();
  });
});
