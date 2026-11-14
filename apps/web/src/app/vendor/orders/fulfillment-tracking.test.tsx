import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type FulfillmentOrder } from '@/lib/api';
import FulfillmentTracking from './fulfillment-tracking';

const shipment: FulfillmentOrder = {
  id: 'shipment-1',
  order_id: 'order-1',
  fulfillment_number: 'SHIP-1001',
  shop_id: 'shop-1',
  shop_name: 'Shop',
  status: 'processing',
  subtotal: '1000.00',
  shipping_fee: '100.00',
  discount_total: '0.00',
  commission_rate_bps: 300,
  commission_amount: '30.00',
  tracking_number: null,
  shipping_address: {},
  items: [],
  events: [],
  transactions: [],
  created_at: '2026-02-20T08:00:00Z',
  updated_at: '2026-02-20T08:00:00Z',
};

afterEach(cleanup);

describe('vendor delivery tracking controls', () => {
  it('sends explicit customer-visible courier, contact and location data', () => {
    const update = vi.fn().mockResolvedValue(undefined);
    render(
      <FulfillmentTracking order={shipment} busy={false} onUpdate={update} />,
    );
    fireEvent.change(screen.getByLabelText('Tracking number'), {
      target: { value: 'NP-1001' },
    });
    fireEvent.change(screen.getByLabelText('Courier / shipping partner'), {
      target: { value: ' Nepal Delivery ' },
    });
    fireEvent.change(screen.getByLabelText('Vendor support phone'), {
      target: { value: '+977 9800000000' },
    });
    fireEvent.change(screen.getByLabelText('Vendor support email'), {
      target: { value: 'support@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Event location'), {
      target: { value: ' Kathmandu hub ' },
    });
    fireEvent.change(screen.getByLabelText('Customer-visible note'), {
      target: { value: 'Handed to courier.' },
    });
    fireEvent.submit(screen.getByRole('form'));
    expect(update).toHaveBeenCalledWith({
      status: 'shipped',
      tracking_number: 'NP-1001',
      courier_name: 'Nepal Delivery',
      support_phone: '+977 9800000000',
      support_email: 'support@example.com',
      location: 'Kathmandu hub',
      note: 'Handed to courier.',
      cash_collected: false,
    });
  });

  it('allows forward milestones and explicit cash collection without requiring fabricated intermediate steps', () => {
    const update = vi.fn().mockResolvedValue(undefined);
    render(
      <FulfillmentTracking
        order={{
          ...shipment,
          status: 'in_transit',
          tracking_number: 'NP-1001',
          courier_name: 'Nepal Delivery',
        }}
        busy={false}
        onUpdate={update}
      />,
    );
    expect(
      screen.getByRole('option', { name: 'Out for delivery' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: 'Order picked up' }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('Tracking number')).toHaveAttribute(
      'readonly',
    );
    fireEvent.change(screen.getByLabelText('Next status'), {
      target: { value: 'delivered' },
    });
    fireEvent.click(screen.getByLabelText('Cash collected'));
    fireEvent.submit(screen.getByRole('form'));
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'delivered',
        cash_collected: true,
        courier_name: 'Nepal Delivery',
      }),
    );
    expect(update.mock.calls[0][0]).not.toHaveProperty('tracking_number');
  });

  it('prevents duplicate submissions while saving and has no tracking form after delivery', () => {
    const update = vi.fn();
    const result = render(
      <FulfillmentTracking order={shipment} busy onUpdate={update} />,
    );
    expect(screen.getByLabelText('Next status')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();
    result.rerender(
      <FulfillmentTracking
        order={{ ...shipment, status: 'delivered' }}
        busy={false}
        onUpdate={update}
      />,
    );
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });
});
