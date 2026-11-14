'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import {
  type DeliveryFeedback,
  type FulfillmentOrder,
  type Order,
  requestApi,
} from '@/lib/api';
import { browserStorageUrl } from '@/lib/network';
import { DashboardIcon } from '../../customer-dashboard-shell';

const labels: Record<string, string> = {
  pending: 'Order received',
  confirmed: 'Order confirmed',
  processing: 'Preparing your order',
  shipped: 'Shipped',
  picked_up: 'Order picked up',
  in_transit: 'In transit',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Canceled',
  return_requested: 'Return requested',
  returned: 'Returned',
  return_rejected: 'Return declined',
};
const label = (status: string) => labels[status] ?? status.replaceAll('_', ' ');
const date = (value: string) =>
  new Date(value).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    weekday: 'long',
  });
const time = (value: string) =>
  new Date(value).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
const moods = [
  { value: 1, label: 'Bad', mouth: 'M8 16q4-5 8 0' },
  { value: 2, label: 'Ok', mouth: 'M8 15q4-2 8 0' },
  { value: 3, label: 'Avg', mouth: 'M8 15h8' },
  { value: 4, label: 'Good', mouth: 'M8 14q4 5 8 0' },
  { value: 5, label: 'Best', mouth: 'M7 13h10q0 7-5 7t-5-7Z' },
];

export default function ShipmentTrackingCard({
  order,
  shipment,
  onOrderUpdate,
  onFeedbackUpdate,
}: {
  order: Order;
  shipment: FulfillmentOrder;
  onOrderUpdate: (order: Order) => void;
  onFeedbackUpdate: (id: string, feedback: DeliveryFeedback) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [rating, setRating] = useState(shipment.delivery_feedback?.rating ?? 0);
  const [confirmation, setConfirmation] = useState<'cancel' | 'returns' | null>(
    null,
  );
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [reviewItemId, setReviewItemId] = useState('');
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewTitle, setReviewTitle] = useState('');
  const [reviewBody, setReviewBody] = useState('');
  const [reviewedIds, setReviewedIds] = useState<string[]>([]);
  const history = [...shipment.events].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  const statusEvent = history.find(
    (event) =>
      event.to_status === shipment.status ||
      (shipment.status === 'delivered' &&
        event.to_status === 'return_rejected'),
  );
  const completedDelivery = history.some(
    (event) => event.to_status === 'delivered',
  );
  const canCancel = ['pending', 'confirmed', 'processing'].includes(
    shipment.status,
  );
  const canReturn = !!shipment.can_request_return;
  const control =
    'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50';
  const supportLink = `/support?orderId=${encodeURIComponent(order.id)}`;

  useEffect(() => {
    if (confirmation) {
      if (!dialog.current?.open) dialog.current?.showModal();
    } else if (!busy && trigger.current) {
      if (trigger.current.isConnected) trigger.current.focus();
      else heading.current?.focus();
      trigger.current = null;
    }
  }, [confirmation, busy]);

  async function runAction(action: 'cancel' | 'returns') {
    setBusy(action);
    setError('');
    setMessage('');
    try {
      const updated = await requestApi<Order>(
        `/me/fulfillment-orders/${encodeURIComponent(shipment.id)}/${action}`,
        { method: 'POST' },
      );
      onOrderUpdate(updated);
      setMessage(
        action === 'cancel'
          ? 'This shipment has been canceled.'
          : 'Your return request has been sent to the shop.',
      );
      setConfirmation(null);
    } catch (cause: unknown) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
        setError(
          cause instanceof Error
            ? cause.message
            : 'The shipment could not be updated.',
        );
        setConfirmation(null);
      }
    } finally {
      setBusy('');
    }
  }

  async function saveRating() {
    setBusy('rating');
    setError('');
    setMessage('');
    try {
      const feedback = await requestApi<DeliveryFeedback>(
        `/me/fulfillment-orders/${encodeURIComponent(shipment.id)}/delivery-feedback`,
        { method: 'PUT', body: JSON.stringify({ rating }) },
      );
      onFeedbackUpdate(shipment.id, feedback);
      setMessage('Thank you. Your delivery rating has been saved.');
    } catch (cause: unknown) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError'))
        setError(
          cause instanceof Error
            ? cause.message
            : 'Your delivery rating could not be saved.',
        );
    } finally {
      setBusy('');
    }
  }

  async function messageVendor() {
    if (!shipment.shop_id) return;
    setBusy('message');
    setError('');
    try {
      const conversation = await requestApi<{ id: string }>(
        '/me/conversations',
        {
          method: 'POST',
          body: JSON.stringify({
            shop_id: shipment.shop_id,
            order_id: order.id,
          }),
        },
      );
      router.push(`/messages/${conversation.id}`);
    } catch (cause: unknown) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError'))
        setError(
          cause instanceof Error
            ? cause.message
            : 'The vendor conversation could not be opened.',
        );
    } finally {
      setBusy('');
    }
  }

  async function submitReview(itemId: string) {
    setBusy('review');
    setError('');
    setMessage('');
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
      setReviewedIds((ids) => [...ids, itemId]);
      setReviewItemId('');
      setReviewTitle('');
      setReviewBody('');
      setMessage(
        'Thank you. Your verified-purchase review is awaiting moderation.',
      );
    } catch (cause: unknown) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError'))
        setError(
          cause instanceof Error
            ? cause.message
            : 'Your review could not be submitted.',
        );
    } finally {
      setBusy('');
    }
  }

  return (
    <article
      aria-label={`Shipment from ${shipment.shop_name}`}
      className="overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-sm"
    >
      <div className="grid lg:grid-cols-[250px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside
          aria-label={`Shipment details for ${shipment.shop_name}`}
          className="border-b border-gray-200 px-6 py-7 lg:border-b-0 lg:border-r lg:px-7"
        >
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">
            Vendor&apos;s Market
          </p>
          <h2
            ref={heading}
            tabIndex={-1}
            className="mt-2 text-xl font-bold tracking-tight text-gray-950"
          >
            {shipment.shop_name}
          </h2>
          <p className="mt-2 break-all text-xs text-gray-500">
            {shipment.fulfillment_number}
          </p>
          <dl className="mt-6 space-y-5 border-t border-gray-200 pt-6 text-sm">
            <div>
              <dt className="text-xs font-semibold text-gray-500">
                Customer name
              </dt>
              <dd className="mt-2 text-gray-900">
                {order.shipping_address.recipient_name || 'Not provided'}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-gray-500">
                Customer contact
              </dt>
              <dd className="mt-2 text-gray-900">
                {order.shipping_address.phone || 'Not provided'}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-gray-500">
                Delivery address
              </dt>
              <dd className="mt-2">
                <address className="not-italic leading-6 text-gray-700">
                  {[
                    order.shipping_address.street_address,
                    order.shipping_address.area,
                    order.shipping_address.city,
                    order.shipping_address.province,
                    order.shipping_address.postal_code,
                  ]
                    .filter(Boolean)
                    .join(', ') || 'Not provided'}
                </address>
              </dd>
            </div>
          </dl>
          <section
            aria-label="Vendor support"
            className="mt-6 border-t border-gray-200 pt-6"
          >
            <h3 className="text-xs font-semibold text-gray-500">
              Seller / Vendor
            </h3>
            <p className="mt-2 text-sm font-medium text-gray-900">
              {shipment.shop_name}
            </p>
            <h3 className="mt-5 text-xs font-semibold text-gray-500">
              Vendor support
            </h3>
            <p className="mt-2 break-all text-sm text-gray-700">
              {shipment.support_phone ? (
                <a
                  href={`tel:${shipment.support_phone}`}
                  className="hover:underline"
                >
                  {shipment.support_phone}
                </a>
              ) : (
                'Phone not provided'
              )}
            </p>
            <p className="mt-2 break-all text-sm text-gray-700">
              {shipment.support_email ? (
                <a
                  href={`mailto:${shipment.support_email}`}
                  className="hover:underline"
                >
                  {shipment.support_email}
                </a>
              ) : (
                'Email not provided'
              )}
            </p>
            {shipment.shop_id ? (
              <button
                type="button"
                disabled={!!busy}
                onClick={() => void messageVendor()}
                className="mt-4 text-left text-sm font-semibold text-blue-700 underline underline-offset-4 disabled:opacity-50"
              >
                {busy === 'message'
                  ? 'Opening conversation...'
                  : 'Message this vendor about the order'}
              </button>
            ) : (
              <p className="mt-3 text-xs text-gray-500">
                This shop is no longer available. Contact marketplace support
                below.
              </p>
            )}
            <p className="mt-3 text-xs leading-5 text-gray-500">
              Contact details and shipment updates are provided by the vendor.
            </p>
          </section>
        </aside>
        <div className="min-w-0 px-5 py-7 sm:px-7 lg:px-8">
          <header className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-200 pb-6">
            <div>
              <p className="text-xs font-medium text-gray-500">Tracking No.</p>
              <p className="mt-2 break-all text-lg font-bold tracking-tight text-gray-950">
                {shipment.tracking_number
                  ? `#${shipment.tracking_number}`
                  : 'Not assigned yet'}
              </p>
            </div>
            <div className="flex max-w-full items-center gap-2 text-gray-700">
              <span className="rounded-lg bg-gray-50 p-2">
                <DashboardIcon path="M3 6h11v10H3zM14 10h4l3 3v3h-7M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
              </span>
              <div>
                <p className="text-[11px] text-gray-500">Shipping partner</p>
                <p className="break-all text-sm font-bold">
                  {shipment.courier_name || 'Not provided'}
                </p>
              </div>
            </div>
          </header>
          <div className="grid gap-6 py-7 sm:grid-cols-[minmax(0,1fr)_180px]">
            <section aria-label="Current shipment status">
              <p className="text-xs font-medium text-gray-500">
                Your shipment is
              </p>
              <h3
                className={`mt-2 text-3xl font-bold tracking-tight ${shipment.status === 'delivered' ? 'text-emerald-700' : shipment.status === 'cancelled' ? 'text-red-700' : 'text-gray-950'}`}
              >
                {label(shipment.status)}
              </h3>
              <p className="mt-2 text-sm font-semibold text-gray-700">
                as on{' '}
                <time dateTime={statusEvent?.created_at ?? shipment.updated_at}>
                  {date(statusEvent?.created_at ?? shipment.updated_at)},{' '}
                  {time(statusEvent?.created_at ?? shipment.updated_at)}
                </time>
              </p>
              <p className="mt-4 text-xs leading-5 text-gray-500">
                Last updated{' '}
                <time dateTime={shipment.updated_at}>
                  {date(shipment.updated_at)}, {time(shipment.updated_at)}
                </time>
              </p>
            </section>
            <section
              aria-label="Shipment actions"
              className="rounded-xl border border-gray-100 bg-gray-50 p-3"
            >
              {canCancel && (
                <button
                  className={`${control} w-full`}
                  type="button"
                  disabled={!!busy}
                  onClick={(event) => {
                    trigger.current = event.currentTarget;
                    setConfirmation('cancel');
                  }}
                >
                  Cancel Order
                </button>
              )}
              <button
                className={`${control} mt-2 w-full`}
                type="button"
                disabled={!!busy || !canReturn}
                aria-describedby={`return-policy-${shipment.id}`}
                onClick={(event) => {
                  trigger.current = event.currentTarget;
                  setConfirmation('returns');
                }}
              >
                Return Order
              </button>
              <p
                id={`return-policy-${shipment.id}`}
                className="mt-2 text-[11px] leading-5 text-gray-500"
              >
                {canReturn && shipment.return_deadline
                  ? `Request by ${date(shipment.return_deadline)}, ${time(shipment.return_deadline)}.`
                  : shipment.status === 'delivered'
                    ? 'The return window is unavailable or has closed.'
                    : 'Returns are available for eligible delivered items.'}
              </p>
              <button
                type="button"
                disabled
                className={`${control} mt-3 w-full`}
                aria-describedby={`exchange-policy-${shipment.id}`}
              >
                Exchange Item
              </button>
              <p
                id={`exchange-policy-${shipment.id}`}
                className="mt-2 text-[11px] text-gray-500"
              >
                Exchanges are not supported yet.
              </p>
              <div className="mt-4 border-t border-gray-200 pt-3">
                <p className="text-xs text-gray-600">For delivery queries</p>
                <Link
                  className="mt-1 inline-block text-sm font-semibold text-blue-700 underline underline-offset-4"
                  href={supportLink}
                >
                  Contact Us
                </Link>
              </div>
            </section>
          </div>
          {error && (
            <p
              role="alert"
              className="mb-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
            >
              {error}
            </p>
          )}
          {message && (
            <p
              role="status"
              className="mb-5 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800"
            >
              {message}
            </p>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void saveRating();
            }}
            className="border-y border-gray-200 py-5"
          >
            <fieldset
              disabled={!!busy || !completedDelivery}
              aria-describedby={`rating-help-${shipment.id}`}
            >
              <legend className="text-sm font-semibold text-gray-900">
                How was your delivery experience?
              </legend>
              <div className="mt-4 flex flex-wrap gap-3 sm:gap-5">
                {moods.map((mood) => (
                  <label
                    key={mood.value}
                    className="relative cursor-pointer text-center"
                  >
                    <input
                      type="radio"
                      name={`delivery-rating-${shipment.id}`}
                      value={mood.value}
                      checked={rating === mood.value}
                      onChange={() => setRating(mood.value)}
                      className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                      aria-label={`${mood.label}, ${mood.value} out of 5`}
                    />
                    <span
                      className={`flex h-11 w-11 items-center justify-center rounded-full border peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-blue-700 ${rating === mood.value ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-gray-200 bg-gray-50 text-gray-500'}`}
                    >
                      <svg
                        aria-hidden="true"
                        width="30"
                        height="30"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <path d="M8 9h.01M16 9h.01" strokeWidth="2.5" />
                        <path d={mood.mouth} />
                      </svg>
                    </span>
                    <span className="mt-1.5 block text-[11px] font-medium text-gray-600">
                      {mood.label}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <p
              id={`rating-help-${shipment.id}`}
              className="mt-3 text-xs text-gray-500"
            >
              {completedDelivery
                ? shipment.delivery_feedback
                  ? `Saved rating: ${shipment.delivery_feedback.rating} / 5. You can update your feedback.`
                  : 'Rate this shipment after delivery. This is separate from product reviews.'
                : 'Available once delivery is recorded.'}
            </p>
            <button
              type="submit"
              disabled={
                !completedDelivery ||
                !rating ||
                !!busy ||
                rating === shipment.delivery_feedback?.rating
              }
              className="mt-3 rounded-lg bg-emerald-800 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === 'rating'
                ? 'Saving...'
                : shipment.delivery_feedback
                  ? 'Update delivery rating'
                  : 'Save delivery rating'}
            </button>
          </form>
          <section aria-label="Tracking history" className="pt-6">
            <h3 className="text-sm font-semibold text-gray-950">
              Tracking History
            </h3>
            <p className="mt-1 text-xs text-gray-500">
              Latest update first · Times shown in your local timezone
            </p>
            {history.length === 0 ? (
              <p className="mt-5 rounded-lg bg-gray-50 p-4 text-sm text-gray-500">
                No tracking events have been recorded yet.
              </p>
            ) : (
              <ol aria-label="Fulfillment history" className="mt-6">
                {history.map((event, index) => (
                  <li
                    key={event.id}
                    aria-current={index === 0 ? 'step' : undefined}
                    className="grid grid-cols-[minmax(0,100px)_20px_minmax(0,1fr)] gap-3 text-sm sm:grid-cols-[minmax(0,145px)_20px_minmax(0,1fr)] sm:gap-5"
                  >
                    <time
                      dateTime={event.created_at}
                      className="pb-7 text-xs leading-5 text-gray-600"
                    >
                      <span className="block font-medium text-gray-800">
                        {new Date(event.created_at).toLocaleDateString(
                          'en-GB',
                          { day: '2-digit', month: 'short', year: 'numeric' },
                        )}
                      </span>
                      <span>At {time(event.created_at)}</span>
                    </time>
                    <div
                      aria-hidden="true"
                      className="relative flex justify-center"
                    >
                      {index < history.length - 1 && (
                        <span className="absolute bottom-0 top-2 w-px bg-gray-200" />
                      )}
                      <span
                        className={`relative mt-1 h-3 w-3 rounded-full border-[3px] ${index === 0 ? (event.to_status === 'delivered' || event.to_status === 'return_rejected' ? 'border-emerald-100 bg-emerald-600 ring-2 ring-emerald-50' : 'border-blue-100 bg-blue-600 ring-2 ring-blue-50') : 'border-gray-100 bg-gray-500'}`}
                      />
                    </div>
                    <div className="min-w-0 pb-7">
                      <p
                        className={`font-semibold ${index === 0 && shipment.status === 'delivered' ? 'text-emerald-800' : 'text-gray-800'}`}
                      >
                        {label(event.to_status)}
                      </p>
                      {event.location && (
                        <p className="mt-1 text-xs leading-5 text-gray-600">
                          At {event.location}
                        </p>
                      )}
                      {event.note && (
                        <p className="mt-1 text-xs leading-5 text-gray-500">
                          {event.note}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
          <section
            aria-label="Items in this shipment"
            className="mt-3 border-t border-gray-200 pt-5"
          >
            <h3 className="text-sm font-semibold">Items in this shipment</h3>
            <ul className="mt-4 space-y-5">
              {shipment.items.map((item) => (
                <li key={item.id}>
                  <div className="flex items-start gap-3">
                    {item.image_url && (
                      <div
                        role="img"
                        aria-label={item.image_alt || item.product_name}
                        className="h-14 w-14 shrink-0 rounded-lg border border-gray-200 bg-gray-50 bg-contain bg-center bg-no-repeat"
                        style={{
                          backgroundImage: `url("${browserStorageUrl(item.image_url)}")`,
                        }}
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-900">
                        {item.product_name}
                      </p>
                      <p className="mt-1 text-xs text-gray-500">
                        {item.variant_name ? `${item.variant_name} · ` : ''}
                        Quantity: {item.quantity}
                      </p>
                    </div>
                    <p className="shrink-0 text-xs font-semibold text-gray-800">
                      NPR {item.line_total}
                    </p>
                  </div>
                  {shipment.status === 'delivered' &&
                    item.product_id &&
                    !reviewedIds.includes(item.id) &&
                    (reviewItemId === item.id ? (
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          void submitReview(item.id);
                        }}
                        className="mt-3 grid gap-3 rounded-lg bg-gray-50 p-4"
                      >
                        <label className="text-xs font-semibold">
                          Product rating
                          <select
                            value={reviewRating}
                            onChange={(event) =>
                              setReviewRating(Number(event.target.value))
                            }
                            className="ml-3 rounded-lg border border-gray-300 bg-white p-2"
                          >
                            {[5, 4, 3, 2, 1].map((value) => (
                              <option key={value} value={value}>
                                {value} / 5
                              </option>
                            ))}
                          </select>
                        </label>
                        <input
                          aria-label="Review title"
                          value={reviewTitle}
                          onChange={(event) =>
                            setReviewTitle(event.target.value)
                          }
                          maxLength={120}
                          required
                          placeholder="Review title"
                          className="rounded-lg border border-gray-300 p-2 text-sm"
                        />
                        <textarea
                          aria-label="Review"
                          value={reviewBody}
                          onChange={(event) =>
                            setReviewBody(event.target.value)
                          }
                          maxLength={3000}
                          required
                          placeholder="Share your product experience"
                          rows={3}
                          className="rounded-lg border border-gray-300 p-2 text-sm"
                        />
                        <div className="flex flex-wrap gap-3">
                          <button
                            type="submit"
                            disabled={!!busy}
                            className={control}
                          >
                            Submit verified review
                          </button>
                          <button
                            type="button"
                            disabled={!!busy}
                            className={control}
                            onClick={() => setReviewItemId('')}
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : (
                      <button
                        type="button"
                        disabled={!!busy}
                        onClick={() => setReviewItemId(item.id)}
                        className="mt-2 text-xs font-semibold text-blue-700 underline underline-offset-4"
                      >
                        Write a verified-purchase review
                      </button>
                    ))}
                </li>
              ))}
            </ul>
            <p className="mt-5 border-t border-gray-100 pt-3 text-xs text-gray-500">
              Subtotal: NPR {shipment.subtotal} · Delivery: NPR{' '}
              {shipment.shipping_fee}
              {shipment.discount_total !== '0.00'
                ? ` · Discount: NPR ${shipment.discount_total}`
                : ''}
            </p>
          </section>
        </div>
      </div>
      {confirmation && (
        <dialog
          ref={dialog}
          aria-labelledby={`shipment-confirm-${shipment.id}`}
          aria-describedby={`shipment-confirm-description-${shipment.id}`}
          onCancel={(event) => {
            event.preventDefault();
            if (!busy) setConfirmation(null);
          }}
          className="w-[calc(100%-2rem)] max-w-md rounded-xl border border-gray-200 p-6 shadow-xl backdrop:bg-gray-950/40"
        >
          <h3
            id={`shipment-confirm-${shipment.id}`}
            className="text-lg font-bold"
          >
            {confirmation === 'cancel'
              ? 'Cancel this shipment?'
              : 'Request a return?'}
          </h3>
          <p
            id={`shipment-confirm-description-${shipment.id}`}
            className="mt-3 text-sm leading-6 text-gray-600"
          >
            {confirmation === 'cancel'
              ? 'All items in this shop shipment will be canceled. Other shipments are not affected.'
              : 'Request a return for all items in this shipment. The shop will review your request.'}
          </p>
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <button
              autoFocus
              type="button"
              disabled={!!busy}
              className={control}
              onClick={() => setConfirmation(null)}
            >
              Keep order
            </button>
            <button
              type="button"
              disabled={!!busy}
              onClick={() => void runAction(confirmation)}
              className="rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy
                ? 'Submitting...'
                : confirmation === 'cancel'
                  ? 'Confirm cancellation'
                  : 'Confirm return request'}
            </button>
          </div>
        </dialog>
      )}
    </article>
  );
}
