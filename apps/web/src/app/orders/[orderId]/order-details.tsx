'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Order, requestApi } from '@/lib/api';

type Invoice = {
  invoice_number: string;
  order_number: string;
  issued_at: string;
  payment_method: string;
  status: string;
  shipping_address: Record<string, string | null>;
  subtotal: string;
  shipping_total: string;
  discount_total: string;
  total: string;
};

export default function OrderDetails({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [order, setOrder] = useState<Order | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [reviewItemId, setReviewItemId] = useState('');
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewTitle, setReviewTitle] = useState('');
  const [reviewBody, setReviewBody] = useState('');
  const [reviewedItemIds, setReviewedItemIds] = useState<string[]>([]);
  const [reviewMessage, setReviewMessage] = useState('');

  useEffect(() => {
    void requestApi<Order>(`/me/orders/${encodeURIComponent(orderId)}`)
      .then(setOrder)
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error
            ? cause.message
            : 'Order details could not be loaded.',
        ),
      );
  }, [orderId]);

  async function runAction(
    fulfillmentId: string,
    action: 'cancel' | 'returns',
  ) {
    setBusyId(fulfillmentId);
    setError('');
    try {
      setOrder(
        await requestApi<Order>(
          `/me/fulfillment-orders/${fulfillmentId}/${action}`,
          {
            method: 'POST',
          },
        ),
      );
    } catch (cause: unknown) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The order could not be updated.',
      );
    } finally {
      setBusyId('');
    }
  }

  async function loadInvoice() {
    setError('');
    try {
      const response = await requestApi<Invoice>(
        `/me/orders/${orderId}/invoice`,
      );
      setInvoice(response);
      window.setTimeout(() => window.print(), 100);
    } catch (cause: unknown) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The invoice could not be loaded.',
      );
    }
  }

  async function submitReview(itemId: string) {
    setError('');
    setReviewMessage('');
    try {
      await requestApi('/me/reviews', {
        method: 'POST',
        body: JSON.stringify({
          order_item_id: itemId,
          rating: reviewRating,
          title: reviewTitle,
          body: reviewBody,
        }),
      });
      setReviewedItemIds((current) => [...current, itemId]);
      setReviewItemId('');
      setReviewTitle('');
      setReviewBody('');
      setReviewMessage(
        'Thank you. Your verified-purchase review is awaiting moderation.',
      );
    } catch (cause: unknown) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The review could not be submitted.',
      );
    }
  }

  async function messageVendor(shopId: string) {
    if (!order) return;
    setError('');
    try {
      const conversation = await requestApi<{ id: string }>(
        '/me/conversations',
        {
          method: 'POST',
          body: JSON.stringify({ shop_id: shopId, order_id: order.id }),
        },
      );
      router.push(`/messages/${conversation.id}`);
    } catch (cause: unknown) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The vendor conversation could not be opened.',
      );
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-5 py-8 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5 print:hidden">
        <div>
          <Link className="text-sm font-bold text-emerald-800" href="/orders">
            ← Order history
          </Link>
          <h1 className="mt-2 text-3xl font-bold text-slate-950">
            Order tracking
          </h1>
        </div>
        {order && (
          <button
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold"
            onClick={() => void loadInvoice()}
            type="button"
          >
            Print / save invoice
          </button>
        )}
      </header>
      {error && (
        <p
          className="mt-5 rounded-lg bg-red-50 p-4 text-sm text-red-800"
          role="alert"
        >
          {error}
        </p>
      )}
      {!order ? (
        <p className="py-12 text-center text-slate-600" role="status">
          Loading order…
        </p>
      ) : (
        <>
          {invoice && (
            <section className="mt-6 border border-slate-300 bg-white p-6 print:border-0">
              <p className="text-sm font-semibold text-emerald-800">
                Vendor&apos;s Market · Nepal
              </p>
              <h2 className="mt-2 text-2xl font-bold">
                Invoice {invoice.invoice_number}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {invoice.order_number}
              </p>
              <div className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
                <div>
                  <p className="font-semibold">Ship to</p>
                  <p>{invoice.shipping_address.recipient_name}</p>
                  <p>{invoice.shipping_address.street_address}</p>
                  <p>
                    {invoice.shipping_address.city},{' '}
                    {invoice.shipping_address.province}
                  </p>
                  <p>{invoice.shipping_address.phone}</p>
                </div>
                <div>
                  <p>Issued {new Date(invoice.issued_at).toLocaleString()}</p>
                  <p>Payment: Cash on delivery</p>
                  <p>Status: {invoice.status.replaceAll('_', ' ')}</p>
                </div>
              </div>
              {order.fulfillments.map((fulfillment) => (
                <div
                  className="mt-5 border-t border-slate-200 pt-4"
                  key={fulfillment.id}
                >
                  <h3 className="font-semibold">{fulfillment.shop_name}</h3>
                  {fulfillment.items.map((item) => (
                    <p
                      className="mt-2 flex justify-between gap-4 text-sm"
                      key={item.id}
                    >
                      <span>
                        {item.product_name}{' '}
                        {item.variant_name ? `(${item.variant_name})` : ''} ×{' '}
                        {item.quantity}
                      </span>
                      <span>NPR {item.line_total}</span>
                    </p>
                  ))}
                  <p className="mt-2 flex justify-between border-t border-slate-100 pt-2 text-sm">
                    <span>Delivery</span>
                    <span>NPR {fulfillment.shipping_fee}</span>
                  </p>
                </div>
              ))}
              <div className="mt-5 space-y-1 border-t border-slate-300 pt-3 text-right text-sm">
                <p>Subtotal: NPR {invoice.subtotal}</p>
                <p>Delivery: NPR {invoice.shipping_total}</p>
                {invoice.discount_total !== '0.00' && (
                  <p>Promotion discount: − NPR {invoice.discount_total}</p>
                )}
                <p className="text-lg font-bold">
                  Total due: NPR {invoice.total}
                </p>
              </div>
            </section>
          )}

          <section className="mt-6 print:hidden">
            <div className="flex flex-wrap justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-slate-950">
                  {order.order_number}
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  {order.status.replaceAll('_', ' ')} · COD · Total NPR{' '}
                  {order.total}
                </p>
              </div>
              <Link
                className="text-sm font-semibold text-emerald-800 underline"
                href="/notifications"
              >
                Notifications
              </Link>
              <Link
                className="text-sm font-semibold text-emerald-800 underline"
                href={`/support?kind=dispute&orderId=${encodeURIComponent(order.id)}`}
              >
                Get help with this order
              </Link>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
                <h3 className="font-semibold">Delivery address</h3>
                <p className="mt-2">{order.shipping_address.recipient_name}</p>
                <p>{order.shipping_address.street_address}</p>
                <p>
                  {order.shipping_address.city},{' '}
                  {order.shipping_address.province}
                </p>
                <p>{order.shipping_address.phone}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
                <h3 className="font-semibold">Order totals</h3>
                <p className="mt-2">Subtotal: NPR {order.subtotal}</p>
                <p>Delivery: NPR {order.shipping_total}</p>
                {order.discount_total !== '0.00' && (
                  <p>
                    Promotion {order.promotion_code}: − NPR{' '}
                    {order.discount_total}
                  </p>
                )}
                <p className="font-semibold">Total due: NPR {order.total}</p>
              </div>
            </div>
            <div className="mt-5 space-y-4">
              {order.fulfillments.map((fulfillment) => (
                <article
                  className="rounded-xl border border-slate-200 bg-white p-5"
                  key={fulfillment.id}
                >
                  <div className="flex flex-wrap justify-between gap-2">
                    <div>
                      <h3 className="font-semibold">{fulfillment.shop_name}</h3>
                      <p className="text-xs text-slate-500">
                        {fulfillment.fulfillment_number}
                      </p>
                    </div>
                    <span className="text-sm font-semibold capitalize text-emerald-900">
                      {fulfillment.status.replaceAll('_', ' ')}
                    </span>
                  </div>
                  {fulfillment.tracking_number && (
                    <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
                      Tracking:{' '}
                      <span className="font-semibold">
                        {fulfillment.tracking_number}
                      </span>
                    </p>
                  )}
                  {fulfillment.shop_id && (
                    <button
                      className="mt-3 text-sm font-semibold text-emerald-800 underline"
                      onClick={() => {
                        if (fulfillment.shop_id) {
                          void messageVendor(fulfillment.shop_id);
                        }
                      }}
                      type="button"
                    >
                      Message this vendor about the order
                    </button>
                  )}
                  <ul className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                    {fulfillment.items.map((item) => (
                      <li
                        className="rounded-lg border-b border-slate-100 pb-3 text-sm last:border-0"
                        key={item.id}
                      >
                        <div className="flex justify-between gap-4">
                          <span>
                            {item.product_name}
                            {item.variant_name
                              ? ` · ${item.variant_name}`
                              : ''}{' '}
                            × {item.quantity}
                          </span>
                          <span>NPR {item.line_total}</span>
                        </div>
                        {fulfillment.status === 'delivered' &&
                          item.product_id &&
                          !reviewedItemIds.includes(item.id) && (
                            <div className="mt-2">
                              {reviewItemId === item.id ? (
                                <form
                                  className="grid gap-2 rounded-lg bg-slate-50 p-3"
                                  onSubmit={(event) => {
                                    event.preventDefault();
                                    void submitReview(item.id);
                                  }}
                                >
                                  <label className="text-xs font-semibold">
                                    Rating
                                    <select
                                      className="ml-2 rounded border border-slate-300 p-1"
                                      onChange={(event) =>
                                        setReviewRating(
                                          Number(event.target.value),
                                        )
                                      }
                                      value={reviewRating}
                                    >
                                      {[5, 4, 3, 2, 1].map((rating) => (
                                        <option key={rating} value={rating}>
                                          {rating} / 5
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                  <input
                                    aria-label="Review title"
                                    className="rounded border border-slate-300 p-2"
                                    maxLength={120}
                                    onChange={(event) =>
                                      setReviewTitle(event.target.value)
                                    }
                                    placeholder="Review title"
                                    required
                                    value={reviewTitle}
                                  />
                                  <textarea
                                    aria-label="Review"
                                    className="rounded border border-slate-300 p-2"
                                    maxLength={3000}
                                    onChange={(event) =>
                                      setReviewBody(event.target.value)
                                    }
                                    placeholder="Share your experience"
                                    required
                                    rows={3}
                                    value={reviewBody}
                                  />
                                  <div className="flex gap-3">
                                    <button
                                      className="font-semibold text-emerald-800 underline"
                                      type="submit"
                                    >
                                      Submit verified review
                                    </button>
                                    <button
                                      className="text-slate-600 underline"
                                      onClick={() => setReviewItemId('')}
                                      type="button"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </form>
                              ) : (
                                <button
                                  className="text-xs font-semibold text-emerald-800 underline"
                                  onClick={() => setReviewItemId(item.id)}
                                  type="button"
                                >
                                  Write a verified-purchase review
                                </button>
                              )}
                            </div>
                          )}
                      </li>
                    ))}
                  </ul>
                  {reviewMessage && (
                    <p className="mt-3 text-sm text-emerald-800" role="status">
                      {reviewMessage}
                    </p>
                  )}
                  <ol
                    aria-label="Fulfillment history"
                    className="mt-4 space-y-3 border-l-2 border-emerald-200 pl-4"
                  >
                    {fulfillment.events.map((event) => (
                      <li className="text-sm" key={event.id}>
                        <p className="font-semibold capitalize">
                          {event.to_status.replaceAll('_', ' ')}
                        </p>
                        <p className="text-xs text-slate-500">
                          {new Date(event.created_at).toLocaleString()}
                        </p>
                        {event.note && (
                          <p className="text-slate-600">{event.note}</p>
                        )}
                      </li>
                    ))}
                  </ol>
                  <div className="mt-4 flex flex-wrap gap-3">
                    {['pending', 'confirmed', 'processing'].includes(
                      fulfillment.status,
                    ) && (
                      <button
                        className="text-sm font-semibold text-red-700 underline disabled:opacity-50"
                        disabled={busyId === fulfillment.id}
                        onClick={() => void runAction(fulfillment.id, 'cancel')}
                        type="button"
                      >
                        Cancel fulfillment
                      </button>
                    )}
                    {fulfillment.status === 'delivered' && (
                      <button
                        className="text-sm font-semibold text-emerald-800 underline disabled:opacity-50"
                        disabled={busyId === fulfillment.id}
                        onClick={() =>
                          void runAction(fulfillment.id, 'returns')
                        }
                        type="button"
                      >
                        Request return (within 7 days)
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
