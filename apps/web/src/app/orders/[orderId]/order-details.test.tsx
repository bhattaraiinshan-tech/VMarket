import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';

import { type Order } from '@/lib/api';
import { installTestWorkspace } from '@/test-workspace';
import { selectWorkspace, setWorkspaceUser } from '@/lib/workspace-state';
import OrderDetails from './order-details';

const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const source: Order = {
  id: 'order-1',
  order_number: 'VM-1001',
  invoice_number: 'INV-1001',
  status: 'completed',
  payment_method: 'cash_on_delivery',
  shipping_address: {
    recipient_name: 'Test Customer',
    phone: '+977 9800000000',
    street_address: 'Test Market Road',
    area: 'Ward 1',
    city: 'Lalitpur',
    province: 'Bagmati',
    postal_code: '44600',
  },
  subtotal: '1000.00',
  shipping_total: '100.00',
  discount_total: '0.00',
  promotion_code: null,
  total: '1100.00',
  created_at: '2026-02-20T08:00:00Z',
  updated_at: '2026-02-24T08:00:00Z',
  fulfillments: [
    {
      id: 'shipment-1',
      order_id: 'order-1',
      fulfillment_number: 'SHIP-1001',
      shop_id: 'shop-1',
      shop_name: 'Local Crafts',
      status: 'delivered',
      subtotal: '1000.00',
      shipping_fee: '100.00',
      discount_total: '0.00',
      commission_rate_bps: 300,
      commission_amount: '30.00',
      tracking_number: 'NP-1001',
      courier_name: 'Nepal Delivery',
      support_phone: '+977 9810000000',
      support_email: 'support@example.com',
      can_request_return: true,
      return_deadline: '2026-03-03T08:00:00Z',
      delivery_feedback: null,
      shipping_address: {},
      created_at: '2026-02-20T08:00:00Z',
      updated_at: '2026-02-24T08:00:00Z',
      items: [
        {
          id: 'item-1',
          product_id: 'product-1',
          variant_id: null,
          product_name: 'Woven Basket',
          variant_name: 'Large',
          sku: 'BASKET-1',
          quantity: 2,
          unit_price: '500.00',
          line_total: '1000.00',
        },
      ],
      events: [
        'pending',
        'picked_up',
        'in_transit',
        'out_for_delivery',
        'delivered',
      ].map((status, index) => ({
        id: `event-${index}`,
        from_status: null,
        to_status: status,
        created_at: `2026-02-${20 + index}T08:00:00Z`,
        location: index === 4 ? 'Lalitpur' : 'Kathmandu hub',
        note: index === 4 ? 'Handed to recipient.' : null,
      })),
      transactions: [],
    },
  ],
};

let stored: Order;
let failRating = false;
let failAction = false;
let fetchMock: MockInstance<typeof fetch>;

beforeEach(() => {
  installTestWorkspace();
  stored = structuredClone(source);
  failRating = false;
  failAction = false;
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
  fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input, options) => {
      const url = String(input);
      if (url.endsWith('/delivery-feedback')) {
        if (failRating)
          return Response.json(
            { error: { message: 'Rating unavailable' } },
            { status: 503 },
          );
        const { rating } = JSON.parse(String(options?.body));
        stored.fulfillments[0].delivery_feedback = {
          rating,
          created_at: '2026-02-25T08:00:00Z',
          updated_at: '2026-02-25T08:00:00Z',
        };
        return Response.json(stored.fulfillments[0].delivery_feedback);
      }
      if (url.endsWith('/returns') || url.endsWith('/cancel')) {
        if (failAction)
          return Response.json(
            { error: { message: 'Return window expired' } },
            { status: 409 },
          );
        stored.fulfillments[0].status = url.endsWith('/returns')
          ? 'return_requested'
          : 'cancelled';
        stored.fulfillments[0].can_request_return = false;
        return Response.json(stored);
      }
      if (url.endsWith('/me/reviews'))
        return Response.json({ id: 'review-1' }, { status: 201 });
      if (url.endsWith('/me/conversations'))
        return Response.json({ id: 'conversation-1' }, { status: 201 });
      if (url.endsWith('/invoice'))
        return Response.json({ ...stored, issued_at: stored.created_at });
      if (url.endsWith('/me/orders/order-1')) return Response.json(stored);
      throw new Error(`Unexpected request: ${url}`);
    });
});

afterEach(() => {
  cleanup();
  setWorkspaceUser(null);
  vi.restoreAllMocks();
  push.mockReset();
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
});

describe('customer shipment tracking', () => {
  it('maps real customer, vendor, courier and location data into a newest-first timeline', async () => {
    render(<OrderDetails orderId="order-1" />);
    await screen.findByRole('heading', { name: 'Local Crafts' });
    expect(screen.getByText('Test Customer')).toBeInTheDocument();
    expect(
      screen.getByText(/Test Market Road, Ward 1, Lalitpur, Bagmati, 44600/),
    ).toBeInTheDocument();
    expect(screen.getByText('#NP-1001')).toBeInTheDocument();
    expect(screen.getByText('Nepal Delivery')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'support@example.com' }),
    ).toHaveAttribute('href', 'mailto:support@example.com');
    expect(
      screen.getByRole('link', { name: '+977 9810000000' }),
    ).toHaveAttribute('href', 'tel:+977 9810000000');
    const events = within(
      screen.getByRole('list', { name: 'Fulfillment history' }),
    ).getAllByRole('listitem');
    expect(events.map((event) => event.textContent)).toEqual([
      expect.stringContaining('Delivered'),
      expect.stringContaining('Out for delivery'),
      expect.stringContaining('In transit'),
      expect.stringContaining('Order picked up'),
      expect.stringContaining('Order received'),
    ]);
    expect(events[0]).toHaveAttribute('aria-current', 'step');
    expect(events[0]).toHaveTextContent('At Lalitpur');
    expect(events[0]).toHaveTextContent('Handed to recipient.');
    expect(
      screen.getByRole('button', { name: 'Exchange Item' }),
    ).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Contact Us' })).toHaveAttribute(
      'href',
      '/support?orderId=order-1',
    );
  });

  it('persists delivery feedback separately from product reviews, reads it back and permits updates', async () => {
    const first = render(<OrderDetails orderId="order-1" />);
    await screen.findByText('#NP-1001');
    fireEvent.click(screen.getByRole('radio', { name: 'Best, 5 out of 5' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Save delivery rating' }),
    );
    await screen.findByText('Thank you. Your delivery rating has been saved.');
    expect(screen.getByText(/Saved rating: 5 \/ 5/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/me/fulfillment-orders/shipment-1/delivery-feedback',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ rating: 5 }),
      }),
    );
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes('/me/reviews'),
      ),
    ).toBe(false);
    first.unmount();
    render(<OrderDetails orderId="order-1" />);
    await screen.findByText('#NP-1001');
    expect(
      screen.getByRole('radio', { name: 'Best, 5 out of 5' }),
    ).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Good, 4 out of 5' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Update delivery rating' }),
    );
    await screen.findByText(/Saved rating: 4 \/ 5/);
  });

  it('surfaces feedback failures without pretending the selection was saved', async () => {
    failRating = true;
    render(<OrderDetails orderId="order-1" />);
    await screen.findByText('#NP-1001');
    fireEvent.click(screen.getByRole('radio', { name: 'Avg, 3 out of 5' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Save delivery rating' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Rating unavailable',
    );
    expect(screen.queryByText(/Saved rating:/)).not.toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: 'Avg, 3 out of 5' }),
    ).toBeChecked();
  });

  it('does not fabricate missing courier contacts, milestones or location events', async () => {
    const shipment = stored.fulfillments[0];
    shipment.status = 'shipped';
    shipment.courier_name = null;
    shipment.tracking_number = null;
    shipment.support_phone = null;
    shipment.support_email = null;
    shipment.events = [];
    shipment.can_request_return = false;
    render(<OrderDetails orderId="order-1" />);
    await screen.findByText('No tracking events have been recorded yet.');
    expect(screen.getByText('Not assigned yet')).toBeInTheDocument();
    expect(screen.getByText('Phone not provided')).toBeInTheDocument();
    expect(screen.getByText('Email not provided')).toBeInTheDocument();
    expect(screen.queryByText('Out for delivery')).not.toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: 'Good, 4 out of 5' }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Return Order' })).toBeDisabled();
  });

  it('confirms a return for this shipment and reflects server state', async () => {
    render(<OrderDetails orderId="order-1" />);
    await screen.findByText('#NP-1001');
    fireEvent.click(screen.getByRole('button', { name: 'Return Order' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep order' }));
    expect(screen.getByRole('button', { name: 'Return Order' })).toHaveFocus();
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).endsWith('/returns'),
      ),
    ).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Return Order' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm return request' }),
    );
    await screen.findByText('Your return request has been sent to the shop.');
    expect(
      screen.getByRole('heading', { name: 'Return requested' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Return Order' })).toBeDisabled();
  });

  it('shows return errors without changing the displayed delivery state', async () => {
    failAction = true;
    render(<OrderDetails orderId="order-1" />);
    await screen.findByText('#NP-1001');
    fireEvent.click(screen.getByRole('button', { name: 'Return Order' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm return request' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Return window expired',
    );
    expect(
      screen.getByRole('heading', { name: 'Delivered' }),
    ).toBeInTheDocument();
  });

  it('preserves verified product reviews and order-scoped vendor messaging', async () => {
    render(<OrderDetails orderId="order-1" />);
    await screen.findByText('#NP-1001');
    fireEvent.click(
      screen.getByRole('button', { name: 'Write a verified-purchase review' }),
    );
    fireEvent.change(screen.getByLabelText('Review title'), {
      target: { value: 'Well made' },
    });
    fireEvent.change(screen.getByLabelText('Review'), {
      target: { value: 'Good quality basket.' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Submit verified review' }),
    );
    await screen.findByText(
      'Thank you. Your verified-purchase review is awaiting moderation.',
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/me/reviews',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          order_item_id: 'item-1',
          rating: 5,
          title: 'Well made',
          body: 'Good quality basket.',
        }),
      }),
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Message this vendor about the order',
      }),
    );
    await screen.findByRole('button', {
      name: 'Message this vendor about the order',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/me/conversations',
      expect.objectContaining({
        body: JSON.stringify({ shop_id: 'shop-1', order_id: 'order-1' }),
      }),
    );
    expect(push).toHaveBeenCalledWith('/messages/conversation-1');
  });

  it('discards late order responses when switching workspaces', async () => {
    let resolve: (response: Response) => void = () => {};
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    render(<OrderDetails orderId="order-1" />);
    act(() => selectWorkspace('vendor'));
    await screen.findByRole('alert');
    await act(async () => resolve(Response.json(source)));
    expect(screen.queryByText('#NP-1001')).not.toBeInTheDocument();
  });

  it('keeps multiple shop shipments separate', async () => {
    stored.fulfillments.push({
      ...structuredClone(stored.fulfillments[0]),
      id: 'shipment-2',
      shop_id: 'shop-2',
      shop_name: 'Other Shop',
      fulfillment_number: 'SHIP-1002',
      status: 'processing',
      events: [],
      can_request_return: false,
      tracking_number: null,
    });
    render(<OrderDetails orderId="order-1" />);
    await screen.findByRole('article', { name: 'Shipment from Other Shop' });
    const first = within(
      screen.getByRole('article', { name: 'Shipment from Local Crafts' }),
    );
    const second = within(
      screen.getByRole('article', { name: 'Shipment from Other Shop' }),
    );
    expect(first.getByRole('button', { name: 'Return Order' })).toBeEnabled();
    expect(second.getByRole('button', { name: 'Return Order' })).toBeDisabled();
    expect(second.getByRole('button', { name: 'Cancel Order' })).toBeEnabled();
    expect(second.getByText('Not assigned yet')).toBeInTheDocument();
  });
});
