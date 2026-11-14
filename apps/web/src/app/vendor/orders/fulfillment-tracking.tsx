'use client';

import { useState } from 'react';

import { type FulfillmentOrder, type FulfillmentStatusUpdate } from '@/lib/api';

const nextStatuses: Record<string, { value: string; label: string }[]> = {
  processing: [{ value: 'shipped', label: 'Shipped' }],
  shipped: [
    { value: 'picked_up', label: 'Order picked up' },
    { value: 'in_transit', label: 'In transit' },
    { value: 'out_for_delivery', label: 'Out for delivery' },
    { value: 'delivered', label: 'Delivered' },
  ],
  picked_up: [
    { value: 'in_transit', label: 'In transit' },
    { value: 'out_for_delivery', label: 'Out for delivery' },
    { value: 'delivered', label: 'Delivered' },
  ],
  in_transit: [
    { value: 'out_for_delivery', label: 'Out for delivery' },
    { value: 'delivered', label: 'Delivered' },
  ],
  out_for_delivery: [{ value: 'delivered', label: 'Delivered' }],
};

export default function FulfillmentTracking({
  order,
  busy,
  onUpdate,
}: {
  order: FulfillmentOrder;
  busy: boolean;
  onUpdate: (payload: FulfillmentStatusUpdate) => Promise<void>;
}) {
  const options = nextStatuses[order.status] ?? [];
  const [status, setStatus] = useState(options[0]?.value ?? '');
  const [trackingNumber, setTrackingNumber] = useState(
    order.tracking_number ?? '',
  );
  const [courier, setCourier] = useState(order.courier_name ?? '');
  const [phone, setPhone] = useState(order.support_phone ?? '');
  const [email, setEmail] = useState(order.support_email ?? '');
  const [location, setLocation] = useState('');
  const [note, setNote] = useState('');
  const [cashCollected, setCashCollected] = useState(false);
  const control =
    'mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal';

  if (!options.length) return null;

  return (
    <form
      aria-label={`Update tracking for ${order.fulfillment_number}`}
      className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void onUpdate({
          status,
          ...(order.status === 'processing'
            ? { tracking_number: trackingNumber.trim() }
            : {}),
          courier_name: courier.trim() || null,
          support_phone: phone.trim() || null,
          support_email: email.trim() || null,
          location: location.trim() || null,
          note: note.trim() || null,
          cash_collected: status === 'delivered' && cashCollected,
        });
      }}
    >
      <h3 className="text-sm font-semibold">Delivery tracking</h3>
      <p className="mt-1 text-xs leading-5 text-slate-600">
        Record only milestones and locations reported by your delivery partner.
        Support contact details below are shared with this customer.
      </p>
      <fieldset disabled={busy} className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="text-xs font-semibold">
          Next status
          <select
            className={control}
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold">
          Tracking number
          <input
            className={control}
            value={trackingNumber}
            onChange={(event) => setTrackingNumber(event.target.value)}
            maxLength={120}
            required={order.status === 'processing'}
            readOnly={order.status !== 'processing'}
          />
        </label>
        <label className="text-xs font-semibold">
          Courier / shipping partner
          <input
            className={control}
            value={courier}
            onChange={(event) => setCourier(event.target.value)}
            maxLength={120}
            placeholder="Partner name (optional)"
          />
        </label>
        <label className="text-xs font-semibold">
          Event location
          <input
            className={control}
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            maxLength={180}
            placeholder="Verified location (optional)"
          />
        </label>
        <label className="text-xs font-semibold">
          Vendor support phone
          <input
            type="tel"
            className={control}
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            maxLength={32}
            pattern="\+?[0-9][0-9 ()\-]{5,30}"
            placeholder="Public support phone (optional)"
          />
        </label>
        <label className="text-xs font-semibold">
          Vendor support email
          <input
            type="email"
            className={control}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            maxLength={254}
            placeholder="Public support email (optional)"
          />
        </label>
        <label className="text-xs font-semibold sm:col-span-2">
          Customer-visible note
          <textarea
            className={control}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={500}
            rows={2}
            placeholder="Optional delivery update"
          />
        </label>
        {status === 'delivered' && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={cashCollected}
              onChange={(event) => setCashCollected(event.target.checked)}
            />
            Cash collected
          </label>
        )}
        <div className="sm:col-span-2">
          <button
            type="submit"
            className="rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? 'Saving...' : 'Save delivery update'}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
