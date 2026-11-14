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

import { type Order, type FulfillmentOrder, requestApi } from '@/lib/api';
import { installTestWorkspace } from '@/test-workspace';
import { selectWorkspace, setWorkspaceUser } from '@/lib/workspace-state';
import CustomerOrders from './orders';
import OrderDetails from './[orderId]/order-details';

const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/lib/api', () => ({ requestApi: vi.fn() }));

function shipment(
  id: string,
  status: string,
  name = 'Woven Basket',
): FulfillmentOrder {
  return {
    id,
    order_id: 'order-1',
    fulfillment_number: `SHIP-${id}`,
    shop_id: id,
    shop_name: `Shop ${id}`,
    status,
    subtotal: '100.25',
    shipping_fee: '100.00',
    discount_total: '0.00',
    commission_rate_bps: 300,
    commission_amount: '3.01',
    tracking_number: status === 'shipped' ? 'NP-1234' : null,
    shipping_address: {},
    created_at: '2026-01-26T10:00:00Z',
    updated_at: '2026-01-26T10:00:00Z',
    items: [
      {
        id: `item-${id}`,
        product_id: `product-${id}`,
        variant_id: null,
        product_name: name,
        variant_name: 'Black / Large',
        sku: `SKU-${id}`,
        quantity: 2,
        unit_price: '50.125',
        line_total: '100.25',
        image_url:
          id === 'first' ? 'http://localhost:9000/products/basket.jpg' : null,
        image_alt: 'Basket front',
      },
    ],
    events: [],
    transactions: [],
  };
}

function order(
  id: string,
  shipments: FulfillmentOrder[],
  date = '2026-01-26T10:00:00Z',
): Order {
  return {
    id,
    order_number: `VM-${id}`,
    invoice_number: `INV-${id}`,
    status: 'in_progress',
    payment_method: 'cash_on_delivery',
    shipping_address: {},
    subtotal: '100.25',
    shipping_total: '100.00',
    discount_total: '0.00',
    promotion_code: null,
    total: '200.25',
    created_at: date,
    updated_at: date,
    fulfillments: shipments,
  };
}

const mixed = order('order-1', [
  shipment('first', 'processing'),
  shipment('second', 'shipped', 'Clay Cup'),
]);
const delivered = order(
  'order-2',
  [shipment('third', 'delivered', 'Table Lamp')],
  '2026-02-20T10:00:00Z',
);
const canceled = order('order-3', [
  shipment('fourth', 'cancelled', 'Walking Shoes'),
]);

beforeEach(() => {
  installTestWorkspace();
  vi.mocked(requestApi).mockResolvedValue([mixed, delivered, canceled]);
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
});

afterEach(() => {
  cleanup();
  setWorkspaceUser(null);
  vi.restoreAllMocks();
  vi.resetAllMocks();
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
});

describe('customer My Orders dashboard', () => {
  it('renders real purchase details, images, shipment statuses and supported links', async () => {
    render(<CustomerOrders />);
    expect(screen.getByText('Loading orders...')).toBeInTheDocument();
    await screen.findByText('Woven Basket');
    expect(
      screen.getByRole('heading', { name: 'My Orders' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My Orders' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Wishlist' })).toHaveAttribute(
      'href',
      '/wishlist',
    );
    const card = within(
      screen.getByRole('article', { name: 'Order VM-order-1' }),
    );
    expect(card.getByRole('img', { name: 'Basket front' })).toHaveStyle({
      backgroundImage: 'url("/storage/products/basket.jpg")',
    });
    expect(card.getByText('Tracking: NP-1234')).toBeInTheDocument();
    expect(card.getAllByText('Quantity: 2', { exact: false })).toHaveLength(2);
    expect(card.getAllByText('Cash on delivery')).toHaveLength(2);
    expect(card.getAllByText('NPR 100.25')).toHaveLength(2);
    expect(
      card.getAllByRole('link', { name: 'Track Order' })[0],
    ).toHaveAttribute('href', '/orders/order-1');
    expect(card.getByRole('link', { name: 'View Invoice' })).toHaveAttribute(
      'href',
      '/orders/order-1?invoice=1',
    );
    expect(card.getAllByRole('button', { name: 'Cancel Order' })).toHaveLength(
      1,
    );
    expect(
      screen.queryByText(/Estimated Delivery|Credit card/),
    ).not.toBeInTheDocument();
  });

  it('counts orders once per filter and filters by individual shipment status', async () => {
    render(<CustomerOrders />);
    await screen.findByText('Woven Basket');
    expect(
      screen.getByRole('button', { name: 'All orders 3' }),
    ).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Shipped 1' }));
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText('Woven Basket')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delivered 1' }));
    expect(screen.getByText('Table Lamp')).toBeInTheDocument();
    expect(screen.queryByText('Woven Basket')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Canceled 1' }));
    expect(screen.getByText('Walking Shoes')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Cancel Order' }),
    ).not.toBeInTheDocument();
  });

  it('searches names, order IDs and statuses and sorts and combines advanced filters', async () => {
    render(<CustomerOrders />);
    await screen.findByText('Woven Basket');
    const search = screen.getByRole('searchbox', { name: 'Search orders' });
    for (const text of ['Clay Cup', 'VM-order-1', 'shipped']) {
      fireEvent.change(search, { target: { value: text } });
      expect(screen.getAllByRole('article')).toHaveLength(1);
      expect(screen.getByText('Woven Basket')).toBeInTheDocument();
    }
    fireEvent.change(search, { target: { value: '' } });
    expect(screen.getAllByRole('article')[0]).toHaveAccessibleName(
      'Order VM-order-2',
    );
    fireEvent.change(screen.getByLabelText('Sort orders'), {
      target: { value: 'oldest' },
    });
    expect(screen.getAllByRole('article')[0]).toHaveAccessibleName(
      'Order VM-order-1',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
    fireEvent.change(screen.getByLabelText('From date'), {
      target: { value: '2026-02-01' },
    });
    expect(screen.getAllByRole('article')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Shop'), {
      target: { value: 'Shop first' },
    });
    expect(screen.getByText('No matching orders')).toBeInTheDocument();
    fireEvent.click(
      within(
        screen.getByRole('region', { name: 'Advanced order filters' }),
      ).getByRole('button', { name: 'Clear filters' }),
    );
    expect(screen.getAllByRole('article')).toHaveLength(3);
    fireEvent.change(screen.getByLabelText('From date'), {
      target: { value: '2026-02-01' },
    });
    fireEvent.change(screen.getByLabelText('To date'), {
      target: { value: '2026-01-01' },
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'From date must be on or before To date.',
    );
    expect(screen.queryByText('No matching orders')).not.toBeInTheDocument();
  });

  it('confirms and cancels only the selected shop shipment and updates from the server', async () => {
    render(<CustomerOrders />);
    await screen.findByText('Woven Basket');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Order' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(
      dialog.getByText(/Other shop shipments will not be changed/),
    ).toBeInTheDocument();
    expect(requestApi).toHaveBeenCalledTimes(1);
    vi.mocked(requestApi).mockResolvedValue({
      ...mixed,
      status: 'partially_cancelled',
      fulfillments: [
        { ...mixed.fulfillments[0], status: 'cancelled' },
        mixed.fulfillments[1],
      ],
    });
    fireEvent.click(
      dialog.getByRole('button', { name: 'Confirm cancellation' }),
    );
    await screen.findByText('Shipment from Shop first canceled.');
    expect(requestApi).toHaveBeenLastCalledWith(
      '/me/fulfillment-orders/first/cancel',
      { method: 'POST' },
    );
    expect(screen.getByText('Tracking: NP-1234')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Cancel Order' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Processing 0' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps data on cancellation failure and does not send a request when keeping the order', async () => {
    render(<CustomerOrders />);
    await screen.findByText('Woven Basket');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Order' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep order' }));
    expect(screen.getByRole('button', { name: 'Cancel Order' })).toHaveFocus();
    expect(requestApi).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Order' }));
    vi.mocked(requestApi).mockRejectedValue(new Error('Already dispatched'));
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm cancellation' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Already dispatched',
    );
    expect(
      screen.getByRole('button', { name: 'Cancel Order' }),
    ).toBeInTheDocument();
  });

  it('distinguishes failed, empty and no-match states and supports retry', async () => {
    vi.mocked(requestApi)
      .mockRejectedValueOnce(new Error('Network unavailable'))
      .mockResolvedValueOnce([]);
    render(<CustomerOrders />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Network unavailable',
    );
    expect(screen.queryByText('No orders yet')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No orders yet')).toBeInTheDocument();
  });

  it('ignores a late order history response after workspace switching', async () => {
    let resolve: (value: Order[]) => void = () => {};
    vi.mocked(requestApi)
      .mockReturnValueOnce(
        new Promise<Order[]>((done) => {
          resolve = done;
        }),
      )
      .mockRejectedValue(new Error('Customer workspace is required.'));
    render(<CustomerOrders />);
    act(() => selectWorkspace('vendor'));
    await screen.findByRole('alert');
    await act(async () => resolve([mixed]));
    expect(screen.queryByText('Woven Basket')).not.toBeInTheDocument();
  });

  it('connects logout and surfaces failures', async () => {
    render(<CustomerOrders />);
    await screen.findByText('Woven Basket');
    vi.mocked(requestApi).mockRejectedValueOnce(
      new Error('Logout unavailable'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Logout' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Logout unavailable',
    );
    expect(push).not.toHaveBeenCalled();
    vi.mocked(requestApi).mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Logout' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/'));
    expect(requestApi).toHaveBeenLastCalledWith('/auth/logout', {
      method: 'POST',
    });
  });

  it('opens a real invoice without automatically printing when requested', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    vi.mocked(requestApi).mockImplementation((path) =>
      Promise.resolve(
        path.endsWith('/invoice')
          ? {
              invoice_number: 'INV-order-1',
              order_number: mixed.order_number,
              issued_at: mixed.created_at,
              payment_method: 'cash_on_delivery',
              status: mixed.status,
              shipping_address: {},
              subtotal: mixed.subtotal,
              shipping_total: mixed.shipping_total,
              discount_total: mixed.discount_total,
              total: mixed.total,
            }
          : mixed,
      ),
    );
    render(<OrderDetails orderId="order-1" showInvoice />);
    expect(
      await screen.findByRole('heading', { name: 'Invoice INV-order-1' }),
    ).toBeInTheDocument();
    expect(requestApi).toHaveBeenCalledWith(
      '/me/orders/order-1/invoice',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(print).not.toHaveBeenCalled();
  });

  it('keeps the invoice loading state until the invoice request finishes', async () => {
    let resolveInvoice: (value: unknown) => void = () => {};
    const pendingInvoice = new Promise((resolve) => {
      resolveInvoice = resolve;
    });
    vi.mocked(requestApi).mockImplementation((path) =>
      path.endsWith('/invoice') ? pendingInvoice : Promise.resolve(mixed),
    );
    render(<OrderDetails orderId="order-1" showInvoice />);
    await screen.findByRole('heading', { name: mixed.order_number });
    expect(screen.getByText('Loading invoice...')).toBeInTheDocument();
    await act(async () =>
      resolveInvoice({
        invoice_number: 'INV-order-1',
        order_number: mixed.order_number,
        issued_at: mixed.created_at,
        payment_method: 'cash_on_delivery',
        status: mixed.status,
        shipping_address: {},
        subtotal: mixed.subtotal,
        shipping_total: mixed.shipping_total,
        discount_total: mixed.discount_total,
        total: mixed.total,
      }),
    );
    expect(
      screen.getByRole('heading', { name: 'Invoice INV-order-1' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Loading invoice...')).not.toBeInTheDocument();
  });
});
