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
import VendorOrderDetails from './vendor-order-details';

vi.mock('@/lib/api', () => ({ requestApi: vi.fn() }));
const shipment: FulfillmentOrder = {
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
  courier_name: 'Courier',
  shipping_address: {
    recipient_name: 'Customer',
    phone: '9800000000',
    street_address: 'Market Road',
    city: 'Kathmandu',
  },
  created_at: '2026-02-20T08:00:00Z',
  updated_at: '2026-02-20T08:00:00Z',
  items: [],
  transactions: [],
  events: [
    {
      id: 'event-1',
      from_status: 'pending',
      to_status: 'processing',
      created_at: '2026-02-20T08:00:00Z',
      note: 'Preparing items',
      location: 'Shop',
    },
  ],
};
beforeEach(() => {
  installTestWorkspace('vendor');
  vi.mocked(requestApi).mockResolvedValue(shipment);
  vi.spyOn(window, 'print').mockImplementation(() => {});
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    },
  });
});
afterEach(() => {
  cleanup();
  setWorkspaceUser(null);
  vi.restoreAllMocks();
  vi.resetAllMocks();
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});

describe('vendor shipment details', () => {
  it('shows scoped delivery information, real tracking history and payment limitations', async () => {
    render(<VendorOrderDetails orderId="shipment-1" />);
    await screen.findByText('Customer');
    expect(requestApi).toHaveBeenCalledWith(
      '/vendor/orders/shipment-1',
      expect.anything(),
    );
    expect(
      within(
        screen.getByRole('complementary', { name: 'Delivery details' }),
      ).getByText('Market Road, Kathmandu'),
    ).toBeInTheDocument();
    expect(screen.getByText('Preparing items')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Order tracking' }),
    ).toHaveAttribute('aria-current', 'location');
    expect(screen.getByText(/not a customer invoice/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Return Order' }),
    ).not.toBeInTheDocument();
  });
  it('submits verified milestone updates and refreshes the tracking controls', async () => {
    vi.mocked(requestApi)
      .mockResolvedValueOnce(shipment)
      .mockResolvedValueOnce({
        ...shipment,
        status: 'shipped',
        tracking_number: 'NP-1',
      });
    render(<VendorOrderDetails orderId="shipment-1" />);
    await screen.findByText('Customer');
    fireEvent.change(screen.getByLabelText('Tracking number'), {
      target: { value: 'NP-1' },
    });
    fireEvent.submit(screen.getByRole('form'));
    await screen.findByText('Fulfillment updated.');
    expect(requestApi).toHaveBeenLastCalledWith(
      '/vendor/fulfillment-orders/shipment-1/status',
      expect.objectContaining({
        method: 'PATCH',
        body: expect.stringContaining('"tracking_number":"NP-1"'),
      }),
    );
    expect(screen.getByLabelText('Tracking number')).toHaveAttribute(
      'readonly',
    );
  });
  it('prints only a clearly identified delivery address label', async () => {
    render(<VendorOrderDetails orderId="shipment-1" />);
    await screen.findByText('Customer');
    fireEvent.click(
      screen.getByRole('button', { name: 'Print delivery label' }),
    );
    expect(window.print).toHaveBeenCalledOnce();
  });
  it.each([
    ['pending', 'Confirm order', 'confirmed', 'status'],
    ['confirmed', 'Start processing', 'processing', 'status'],
    ['return_requested', 'Accept return', 'returned', 'status'],
    ['return_requested', 'Reject return', 'return_rejected', 'status'],
    ['returned', 'Record cash refund', 'returned', 'refund'],
  ])(
    'preserves the %s fulfillment action: %s',
    async (status, label, next, endpoint) => {
      vi.mocked(requestApi)
        .mockResolvedValueOnce({
          ...shipment,
          status,
          transactions: [
            {
              id: 'refund',
              transaction_type: 'refund',
              method: 'cash_on_delivery',
              status: 'refund_due',
              amount: '1000.00',
              created_at: shipment.created_at,
              updated_at: shipment.updated_at,
            },
          ],
        })
        .mockResolvedValueOnce({ ...shipment, status: next });
      render(<VendorOrderDetails orderId="shipment-1" />);
      fireEvent.click(await screen.findByRole('button', { name: label }));
      await screen.findByText(
        endpoint === 'refund'
          ? 'Cash refund recorded.'
          : 'Fulfillment updated.',
      );
      expect(requestApi).toHaveBeenLastCalledWith(
        `/vendor/fulfillment-orders/shipment-1/${endpoint}`,
        expect.objectContaining({
          method: endpoint === 'refund' ? 'POST' : 'PATCH',
          ...(endpoint === 'refund'
            ? {}
            : { body: JSON.stringify({ status: next }) }),
        }),
      );
    },
  );
  it('requires confirmation before cancelling a shipment and returns focus', async () => {
    render(<VendorOrderDetails orderId="shipment-1" />);
    const trigger = await screen.findByRole('button', { name: 'Cancel order' });
    fireEvent.click(trigger);
    expect(
      screen.getByRole('dialog', { name: 'Cancel this order?' }),
    ).toBeInTheDocument();
    expect(requestApi).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Keep order' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    vi.mocked(requestApi).mockResolvedValueOnce({
      ...shipment,
      status: 'cancelled',
    });
    fireEvent.click(trigger);
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm cancellation' }),
    );
    await screen.findByText('Fulfillment updated.');
    expect(requestApi).toHaveBeenLastCalledWith(
      '/vendor/fulfillment-orders/shipment-1/status',
      expect.objectContaining({ body: '{"status":"cancelled"}' }),
    );
  });
  it('surfaces failed mutations without discarding the tracking draft', async () => {
    vi.mocked(requestApi)
      .mockResolvedValueOnce(shipment)
      .mockRejectedValueOnce(new Error('Update failed'));
    render(<VendorOrderDetails orderId="shipment-1" />);
    await screen.findByText('Customer');
    fireEvent.change(screen.getByLabelText('Tracking number'), {
      target: { value: 'NP-DRAFT' },
    });
    fireEvent.submit(screen.getByRole('form'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Update failed');
    expect(screen.getByLabelText('Tracking number')).toHaveValue('NP-DRAFT');
    expect(screen.queryByText('Fulfillment updated.')).not.toBeInTheDocument();
  });
  it('discards a late mutation response after shop switching', async () => {
    let resolve!: (value: FulfillmentOrder) => void;
    vi.mocked(requestApi)
      .mockResolvedValueOnce({ ...shipment, status: 'pending' })
      .mockReturnValueOnce(
        new Promise((done) => {
          resolve = done;
        }),
      )
      .mockRejectedValueOnce(new Error('Not found in selected shop'));
    render(<VendorOrderDetails orderId="shipment-1" />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Confirm order' }),
    );
    const signal = vi.mocked(requestApi).mock.calls[1][1]?.signal;
    act(() => selectShop('new-shop', ['buyer-shop', 'new-shop']));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Not found in selected shop',
    );
    expect(signal?.aborted).toBe(true);
    await act(async () => resolve({ ...shipment, status: 'confirmed' }));
    expect(screen.queryByText('Fulfillment updated.')).not.toBeInTheDocument();
    expect(screen.queryByText('Customer')).not.toBeInTheDocument();
  });
});
