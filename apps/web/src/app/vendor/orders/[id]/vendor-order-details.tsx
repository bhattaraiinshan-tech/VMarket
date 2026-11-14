'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  type FulfillmentOrder,
  type FulfillmentStatusUpdate,
  requestApi,
} from '@/lib/api';
import { useWorkspace } from '@/lib/workspace-context';
import {
  OrderLineItem,
  OrderStatusBadge,
  OrderTrackingHistory,
  orderControl,
  orderDateLabel,
} from '@/components/orders/order-presentation';
import VendorShell, { VendorPageHeader } from '../../vendor-shell';
import FulfillmentTracking from '../fulfillment-tracking';

export default function VendorOrderDetails({ orderId }: { orderId: string }) {
  const { user, workspace, shopId } = useWorkspace();
  return (
    <OrderContent
      key={`${user?.id}:${workspace}:${shopId}:${orderId}`}
      orderId={orderId}
    />
  );
}

function OrderContent({ orderId }: { orderId: string }) {
  const [order, setOrder] = useState<FulfillmentOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const alive = useRef(true);
  const mutation = useRef<AbortController | null>(null);
  const confirmation = useRef<HTMLDialogElement>(null);
  const cancelTrigger = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    void requestApi<FulfillmentOrder>(
      `/vendor/orders/${encodeURIComponent(orderId)}`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (!controller.signal.aborted) setOrder(result);
      })
      .catch((cause: unknown) => {
        if (
          !controller.signal.aborted &&
          !(cause instanceof DOMException && cause.name === 'AbortError')
        )
          setError(
            cause instanceof Error
              ? cause.message
              : 'Order details could not be loaded.',
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      alive.current = false;
      controller.abort();
      mutation.current?.abort();
    };
  }, [orderId, retry]);

  async function update(payload: FulfillmentStatusUpdate | 'refund') {
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    const controller = new AbortController();
    mutation.current = controller;
    try {
      const result = await requestApi<FulfillmentOrder>(
        `/vendor/fulfillment-orders/${encodeURIComponent(orderId)}/${payload === 'refund' ? 'refund' : 'status'}`,
        {
          method: payload === 'refund' ? 'POST' : 'PATCH',
          signal: controller.signal,
          ...(payload === 'refund' ? {} : { body: JSON.stringify(payload) }),
        },
      );
      if (alive.current && !controller.signal.aborted) {
        setOrder(result);
        setMessage(
          payload === 'refund'
            ? 'Cash refund recorded.'
            : 'Fulfillment updated.',
        );
      }
    } catch (cause: unknown) {
      if (
        alive.current &&
        !controller.signal.aborted &&
        !(cause instanceof DOMException && cause.name === 'AbortError')
      )
        setError(
          cause instanceof Error
            ? cause.message
            : 'The fulfillment could not be updated.',
        );
    } finally {
      if (alive.current && !controller.signal.aborted) setBusy(false);
    }
  }

  const address = order?.shipping_address;
  const addressText =
    address &&
    [
      address.street_address,
      address.area,
      address.city,
      address.province,
      address.postal_code,
    ]
      .filter(Boolean)
      .join(', ');
  const action = (label: string, status: string) => (
    <button
      type="button"
      disabled={busy}
      className={`${orderControl} font-semibold disabled:opacity-50`}
      onClick={() => void update({ status })}
    >
      {label}
    </button>
  );

  return (
    <VendorShell active="tracking">
      <div className="print:hidden">
        <Link
          href="/vendor/orders"
          className="text-sm font-semibold text-blue-700 hover:underline"
        >
          &larr; Order history
        </Link>
      </div>
      <VendorPageHeader
        title="Order tracking"
        description="Delivery details, verified milestones and shop fulfillment actions."
      />
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 print:hidden"
        >
          {error}
          {!order && (
            <button
              type="button"
              className="ml-3 underline"
              onClick={() => {
                setError('');
                setLoading(true);
                setRetry((value) => value + 1);
              }}
            >
              Try again
            </button>
          )}
        </p>
      )}
      {message && (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800 print:hidden"
        >
          {message}
        </p>
      )}
      {loading ? (
        <p role="status" className="py-12 text-center text-gray-500">
          Loading order...
        </p>
      ) : (
        order && (
          <>
            <section
              id="order-tracking"
              className="overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-sm print:hidden"
            >
              <div className="grid lg:grid-cols-[250px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)]">
                <aside
                  aria-label="Delivery details"
                  className="border-b border-gray-200 px-6 py-7 lg:border-b-0 lg:border-r lg:px-7"
                >
                  <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">
                    Vendor&apos;s Market
                  </p>
                  <h2 className="mt-2 text-xl font-bold tracking-tight">
                    {order.shop_name}
                  </h2>
                  <p className="mt-2 break-all text-xs text-gray-500">
                    {order.fulfillment_number}
                  </p>
                  <dl className="mt-6 space-y-5 border-t border-gray-200 pt-6 text-sm">
                    <div>
                      <dt className="text-xs font-semibold text-gray-500">
                        Customer name
                      </dt>
                      <dd className="mt-2">
                        {address?.recipient_name || 'Not provided'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold text-gray-500">
                        Customer contact
                      </dt>
                      <dd className="mt-2">
                        {address?.phone || 'Not provided'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold text-gray-500">
                        Delivery address
                      </dt>
                      <dd className="mt-2">
                        <address className="not-italic leading-6 text-gray-700">
                          {addressText || 'Not provided'}
                        </address>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold text-gray-500">
                        Date of Order
                      </dt>
                      <dd className="mt-2">
                        <time dateTime={order.created_at}>
                          {orderDateLabel(order.created_at)}
                        </time>
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-6 space-y-3 border-t border-gray-200 pt-6">
                    <button
                      type="button"
                      className={`${orderControl} w-full font-semibold`}
                      onClick={() => window.print()}
                    >
                      Print delivery label
                    </button>
                    <a
                      className="block text-sm font-semibold text-blue-700 underline"
                      href="#payment-details"
                    >
                      View payment / invoice details
                    </a>
                    <Link
                      className="block text-sm font-semibold text-blue-700 underline"
                      href={`/support?kind=dispute&orderId=${encodeURIComponent(order.order_id)}`}
                    >
                      Escalate an order dispute
                    </Link>
                  </div>
                </aside>
                <div className="min-w-0 px-5 py-7 sm:px-7 lg:px-8">
                  <header className="flex flex-wrap justify-between gap-4 border-b border-gray-200 pb-6">
                    <div>
                      <p className="text-xs font-medium text-gray-500">
                        Tracking No.
                      </p>
                      <p className="mt-2 break-all text-lg font-bold">
                        {order.tracking_number || 'Not assigned yet'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Shipping partner</p>
                      <p className="mt-2 text-sm font-bold">
                        {order.courier_name || 'Not provided'}
                      </p>
                    </div>
                  </header>
                  <div className="py-7">
                    <p className="text-xs font-medium text-gray-500">
                      Your shipment is
                    </p>
                    <h3 className="mt-2 text-3xl font-bold capitalize">
                      {order.status
                        .replaceAll('_', ' ')
                        .replace('cancelled', 'canceled')}
                    </h3>
                    <div className="mt-3">
                      <OrderStatusBadge status={order.status} />
                    </div>
                    <p className="mt-2 text-sm text-gray-500">
                      Last updated{' '}
                      <time dateTime={order.updated_at}>
                        {new Date(order.updated_at).toLocaleString()}
                      </time>
                    </p>
                  </div>
                  <section
                    id="fulfillment-actions"
                    aria-label="Fulfillment actions"
                    className="border-y border-gray-200 py-5"
                  >
                    <h3 className="text-sm font-semibold">
                      Manage fulfillment
                    </h3>
                    <div className="mt-3 flex flex-wrap gap-3">
                      {order.status === 'pending' &&
                        action('Confirm order', 'confirmed')}
                      {order.status === 'confirmed' &&
                        action('Start processing', 'processing')}
                      {['pending', 'confirmed', 'processing'].includes(
                        order.status,
                      ) && (
                        <button
                          type="button"
                          disabled={busy}
                          className={`${orderControl} font-semibold text-red-700`}
                          onClick={(event) => {
                            cancelTrigger.current = event.currentTarget;
                            confirmation.current?.showModal();
                          }}
                        >
                          Cancel order
                        </button>
                      )}
                      {order.status === 'return_requested' && (
                        <>
                          {action('Accept return', 'returned')}
                          {action('Reject return', 'return_rejected')}
                        </>
                      )}
                      {order.status === 'returned' &&
                        order.transactions.some(
                          (transaction) =>
                            transaction.transaction_type === 'refund' &&
                            transaction.status === 'refund_due',
                        ) && (
                          <button
                            type="button"
                            className={orderControl}
                            disabled={busy}
                            onClick={() => void update('refund')}
                          >
                            Record cash refund
                          </button>
                        )}
                    </div>
                    <FulfillmentTracking
                      key={`${order.id}:${order.status}`}
                      order={order}
                      busy={busy}
                      onUpdate={update}
                    />
                  </section>
                  <OrderTrackingHistory
                    events={order.events}
                    status={order.status}
                  />
                  <section
                    aria-label="Items in this shipment"
                    className="mt-3 border-t border-gray-200 pt-5"
                  >
                    <h3 className="text-sm font-semibold">
                      Items in this shipment
                    </h3>
                    <ul className="mt-4 space-y-5">
                      {order.items.map((item) => (
                        <OrderLineItem key={item.id} item={item} />
                      ))}
                    </ul>
                  </section>
                  <section
                    id="payment-details"
                    aria-label="Payment details"
                    className="mt-6 border-t border-gray-200 pt-5"
                  >
                    <h3 className="text-sm font-semibold">
                      Shop payment details
                    </h3>
                    <p className="mt-2 text-xs leading-5 text-gray-500">
                      These are this shop&apos;s fulfillment records, not a
                      customer invoice. Customer invoices include all shop
                      shipments and are available only in Customer workspace.
                    </p>
                    <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <dt>Subtotal</dt>
                      <dd>NPR {order.subtotal}</dd>
                      <dt>Delivery</dt>
                      <dd>NPR {order.shipping_fee}</dd>
                      <dt>Discount</dt>
                      <dd>NPR {order.discount_total}</dd>
                      <dt>Commission</dt>
                      <dd>NPR {order.commission_amount}</dd>
                      <dt>Payment method</dt>
                      <dd>Cash on delivery</dd>
                    </dl>
                    {!order.transactions.length ? (
                      <p className="mt-3 text-sm text-gray-500">
                        No payment transactions recorded.
                      </p>
                    ) : (
                      <ul className="mt-4 space-y-2">
                        {order.transactions.map((transaction) => (
                          <li
                            key={transaction.id}
                            className="text-sm capitalize"
                          >
                            {transaction.transaction_type}: NPR{' '}
                            {transaction.amount} ·{' '}
                            {transaction.status.replaceAll('_', ' ')}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </div>
              </div>
            </section>
            <section
              aria-label="Delivery label"
              className="hidden border border-gray-300 bg-white p-8 print:block"
            >
              <h2 className="text-xl font-bold">{order.shop_name}</h2>
              <p>{order.fulfillment_number}</p>
              <p className="mt-4">Deliver to: {address?.recipient_name}</p>
              <address className="not-italic">{addressText}</address>
              <p>{address?.phone}</p>
              <p className="mt-4">
                Tracking: {order.tracking_number || 'Not assigned yet'}
              </p>
              <p>Courier: {order.courier_name || 'Not provided'}</p>
              <p className="mt-4 text-sm">
                Delivery address label only; not a prepaid courier label or
                invoice.
              </p>
            </section>
          </>
        )
      )}
      <dialog
        ref={confirmation}
        aria-labelledby="cancel-title"
        className="w-full max-w-md rounded-xl border border-gray-200 p-6 backdrop:bg-black/40"
        onClose={() => cancelTrigger.current?.focus()}
      >
        <h2 id="cancel-title" className="text-lg font-bold">
          Cancel this order?
        </h2>
        <p className="mt-2 text-sm text-gray-600">
          This cancels the selected shop shipment and releases its stock
          reservation.
        </p>
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            className={orderControl}
            onClick={() => confirmation.current?.close()}
          >
            Keep order
          </button>
          <button
            type="button"
            className={`${orderControl} font-semibold text-red-700`}
            onClick={() => {
              confirmation.current?.close();
              void update({ status: 'cancelled' });
            }}
          >
            Confirm cancellation
          </button>
        </div>
      </dialog>
    </VendorShell>
  );
}
