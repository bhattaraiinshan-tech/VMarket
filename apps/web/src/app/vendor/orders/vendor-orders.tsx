'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { FulfillmentOrder, requestApi } from '@/lib/api';

export default function VendorOrders() {
  const [orders, setOrders] = useState<FulfillmentOrder[]>([]);
  const [trackingNumbers, setTrackingNumbers] = useState<
    Record<string, string>
  >({});
  const [cashCollected, setCashCollected] = useState<Record<string, boolean>>(
    {},
  );
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [loading, setLoading] = useState(true);

  async function loadOrders() {
    setError('');
    try {
      const response = await requestApi<{
        items: FulfillmentOrder[];
        total: number;
      }>('/vendor/orders');
      setOrders(response.items);
    } catch (cause: unknown) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Vendor orders could not be loaded.',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadOrders();
  }, []);

  async function updateStatus(
    order: FulfillmentOrder,
    status: string,
    extra: { tracking_number?: string; cash_collected?: boolean } = {},
  ) {
    setError('');
    setBusyId(order.id);
    try {
      const updated = await requestApi<FulfillmentOrder>(
        `/vendor/fulfillment-orders/${order.id}/status`,
        {
          method: 'PATCH',
          body: JSON.stringify({ status, ...extra }),
        },
      );
      setOrders((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (cause: unknown) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The fulfillment could not be updated.',
      );
    } finally {
      setBusyId('');
    }
  }

  async function recordRefund(order: FulfillmentOrder) {
    setError('');
    setBusyId(order.id);
    try {
      const updated = await requestApi<FulfillmentOrder>(
        `/vendor/fulfillment-orders/${order.id}/refund`,
        { method: 'POST' },
      );
      setOrders((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (cause: unknown) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The cash refund could not be recorded.',
      );
    } finally {
      setBusyId('');
    }
  }

  function button(
    order: FulfillmentOrder,
    label: string,
    status: string,
    extra: { tracking_number?: string; cash_collected?: boolean } = {},
    danger = false,
  ) {
    return (
      <button
        className={`rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50 ${danger ? 'border border-red-200 text-red-700' : 'bg-emerald-800 text-white'}`}
        disabled={busyId === order.id}
        key={status}
        onClick={() => void updateStatus(order, status, extra)}
        type="button"
      >
        {label}
      </button>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-5 py-8 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <Link className="text-sm font-bold text-emerald-800" href="/vendor">
            ← Vendor workspace
          </Link>
          <h1 className="mt-2 text-3xl font-bold text-slate-950">
            Fulfillment orders
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Orders are visible only to the shop that must fulfill them.
          </p>
        </div>
        <Link
          className="text-sm font-semibold text-emerald-800"
          href="/notifications"
        >
          Notifications
        </Link>
      </header>
      {error && (
        <p
          className="mt-5 rounded-lg bg-red-50 p-4 text-sm text-red-800"
          role="alert"
        >
          {error}
          {error.toLowerCase().includes('sign in') && (
            <Link className="ml-2 font-semibold underline" href="/">
              Sign in
            </Link>
          )}
        </p>
      )}
      {loading ? (
        <p className="py-12 text-center text-slate-600" role="status">
          Loading vendor orders…
        </p>
      ) : orders.length === 0 ? (
        <p className="mt-7 rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-600">
          No orders are waiting for your shop.
        </p>
      ) : (
        <section
          aria-label="Vendor fulfillment orders"
          className="mt-7 space-y-4"
        >
          {orders.map((order) => {
            const refundDue = order.transactions.some(
              (transaction) =>
                transaction.transaction_type === 'refund' &&
                transaction.status === 'refund_due',
            );
            return (
              <article
                className="rounded-xl border border-slate-200 bg-white p-5"
                key={order.id}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-slate-950">
                      {order.fulfillment_number}
                    </h2>
                    <p className="mt-1 text-sm text-slate-600">
                      {order.shop_name} · Subtotal NPR {order.subtotal} ·
                      Delivery NPR {order.shipping_fee}
                    </p>
                  </div>
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold capitalize text-emerald-900">
                    {order.status.replaceAll('_', ' ')}
                  </span>
                </div>
                <ul className="mt-4 space-y-2 border-t border-slate-100 pt-4">
                  {order.items.map((item) => (
                    <li
                      className="flex justify-between gap-4 text-sm"
                      key={item.id}
                    >
                      <span>
                        {item.product_name}{' '}
                        {item.variant_name ? `· ${item.variant_name}` : ''} ×{' '}
                        {item.quantity}
                        <span className="ml-2 text-slate-500">
                          SKU {item.sku}
                        </span>
                      </span>
                      <span>NPR {item.line_total}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 flex flex-wrap items-end gap-3">
                  {order.status === 'pending' && (
                    <>
                      {button(order, 'Confirm order', 'confirmed')}
                      {button(order, 'Cancel order', 'cancelled', {}, true)}
                    </>
                  )}
                  {order.status === 'confirmed' && (
                    <>
                      {button(order, 'Start processing', 'processing')}
                      {button(order, 'Cancel order', 'cancelled', {}, true)}
                    </>
                  )}
                  {order.status === 'processing' && (
                    <>
                      <label className="text-sm font-medium text-slate-700">
                        Tracking number
                        <input
                          className="mt-1 block rounded-lg border border-slate-300 px-3 py-2"
                          onChange={(event) =>
                            setTrackingNumbers((current) => ({
                              ...current,
                              [order.id]: event.target.value,
                            }))
                          }
                          value={trackingNumbers[order.id] ?? ''}
                        />
                      </label>
                      {button(order, 'Mark shipped', 'shipped', {
                        tracking_number: trackingNumbers[order.id],
                      })}
                      {button(order, 'Cancel order', 'cancelled', {}, true)}
                    </>
                  )}
                  {order.status === 'shipped' && (
                    <>
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          checked={cashCollected[order.id] ?? false}
                          onChange={(event) =>
                            setCashCollected((current) => ({
                              ...current,
                              [order.id]: event.target.checked,
                            }))
                          }
                          type="checkbox"
                        />
                        Cash collected
                      </label>
                      {button(order, 'Mark delivered', 'delivered', {
                        cash_collected: cashCollected[order.id] ?? false,
                      })}
                    </>
                  )}
                  {order.status === 'return_requested' && (
                    <>
                      {button(order, 'Accept return', 'returned')}
                      {button(
                        order,
                        'Reject return',
                        'return_rejected',
                        {},
                        true,
                      )}
                    </>
                  )}
                  {order.status === 'returned' && refundDue && (
                    <button
                      className="rounded-lg bg-emerald-800 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      disabled={busyId === order.id}
                      onClick={() => void recordRefund(order)}
                      type="button"
                    >
                      Record cash refund
                    </button>
                  )}
                  {order.status === 'shipped' && order.tracking_number && (
                    <p className="text-sm text-slate-600">
                      Tracking:{' '}
                      <span className="font-semibold">
                        {order.tracking_number}
                      </span>
                    </p>
                  )}
                </div>
                <ol
                  aria-label="Order status history"
                  className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-slate-100 pt-3"
                >
                  {order.events.map((event) => (
                    <li className="text-xs text-slate-500" key={event.id}>
                      <span className="font-semibold capitalize text-slate-700">
                        {event.to_status.replaceAll('_', ' ')}
                      </span>
                      {' · '}
                      {new Date(event.created_at).toLocaleString()}
                    </li>
                  ))}
                </ol>
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}
