'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { type DeliveryFeedback, type Order, requestApi } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace-context';
import OrderInvoice, { type Invoice } from './order-invoice';
import ShipmentTrackingCard from './shipment-tracking-card';

export default function OrderDetails({
  orderId,
  showInvoice = false,
}: {
  orderId: string;
  showInvoice?: boolean;
}) {
  const { user, workspace } = useWorkspace();
  return (
    <OrderDetailsContent
      key={`${user?.id}:${workspace}:${orderId}:${showInvoice}`}
      orderId={orderId}
      showInvoice={showInvoice}
    />
  );
}

function OrderDetailsContent({
  orderId,
  showInvoice,
}: {
  orderId: string;
  showInvoice: boolean;
}) {
  const [order, setOrder] = useState<Order | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [invoiceLoading, setInvoiceLoading] = useState(showInvoice);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [invoiceError, setInvoiceError] = useState('');
  const [retry, setRetry] = useState(0);
  const printRequested = useRef(false);
  const invoiceRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void requestApi<Order>(`/me/orders/${encodeURIComponent(orderId)}`, {
      signal: controller.signal,
    })
      .then((value) => {
        if (active) setOrder(value);
      })
      .catch((cause: unknown) => {
        if (
          active &&
          !(cause instanceof DOMException && cause.name === 'AbortError')
        )
          setError(
            cause instanceof Error
              ? cause.message
              : 'Order details could not be loaded.',
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    if (showInvoice) {
      void requestApi<Invoice>(
        `/me/orders/${encodeURIComponent(orderId)}/invoice`,
        { signal: controller.signal },
      )
        .then((value) => {
          if (active) setInvoice(value);
        })
        .catch((cause: unknown) => {
          if (
            active &&
            !(cause instanceof DOMException && cause.name === 'AbortError')
          )
            setInvoiceError(
              cause instanceof Error
                ? cause.message
                : 'The invoice could not be loaded.',
            );
        })
        .finally(() => {
          if (active) setInvoiceLoading(false);
        });
    }
    return () => {
      active = false;
      controller.abort();
      invoiceRequest.current?.abort();
    };
  }, [orderId, showInvoice, retry]);

  useEffect(() => {
    if (invoice && printRequested.current) {
      printRequested.current = false;
      window.print();
    }
  }, [invoice]);

  async function loadInvoice(print = false) {
    setInvoiceError('');
    setInvoiceLoading(true);
    printRequested.current = print;
    const controller = new AbortController();
    invoiceRequest.current?.abort();
    invoiceRequest.current = controller;
    try {
      const response = await requestApi<Invoice>(
        `/me/orders/${encodeURIComponent(orderId)}/invoice`,
        { signal: controller.signal },
      );
      if (!controller.signal.aborted) setInvoice(response);
    } catch (cause: unknown) {
      if (
        !controller.signal.aborted &&
        !(cause instanceof DOMException && cause.name === 'AbortError')
      ) {
        printRequested.current = false;
        setInvoiceError(
          cause instanceof Error
            ? cause.message
            : 'The invoice could not be loaded.',
        );
      }
    } finally {
      if (!controller.signal.aborted) setInvoiceLoading(false);
    }
  }

  function updateOrder(updated: Order) {
    setOrder(updated);
    setInvoice(null);
  }

  function updateFeedback(id: string, feedback: DeliveryFeedback) {
    setOrder((current) =>
      current
        ? {
            ...current,
            fulfillments: current.fulfillments.map((shipment) =>
              shipment.id === id
                ? { ...shipment, delivery_feedback: feedback }
                : shipment,
            ),
          }
        : current,
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F6FA] print:bg-white">
      <main className="mx-auto max-w-6xl px-4 py-8 text-gray-900 sm:px-7 lg:py-10">
        <header className="flex flex-wrap items-start justify-between gap-4 print:hidden">
          <div>
            <Link
              href="/orders"
              className="text-sm font-semibold text-blue-700 hover:underline"
            >
              &larr; Order history
            </Link>
            <h1 className="mt-3 text-3xl font-bold tracking-tight">
              Order tracking
            </h1>
            <p className="mt-2 text-sm text-gray-500">
              Follow each delivery, get help, and share your experience.
            </p>
          </div>
          {order && (
            <button
              type="button"
              disabled={invoiceLoading}
              onClick={() => void loadInvoice(true)}
              className="rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Print / save invoice
            </button>
          )}
        </header>
        {error && (
          <div
            role="alert"
            className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 print:hidden"
          >
            {error}
            <button
              type="button"
              onClick={() => {
                setError('');
                setLoading(true);
                setRetry((value) => value + 1);
              }}
              className="ml-3 font-semibold underline"
            >
              Try again
            </button>
          </div>
        )}
        {invoiceError && (
          <p
            role="alert"
            className="mt-5 rounded-lg bg-red-50 p-4 text-sm text-red-800 print:hidden"
          >
            {invoiceError}
            <button
              type="button"
              disabled={invoiceLoading}
              onClick={() => void loadInvoice()}
              className="ml-3 font-semibold underline"
            >
              Retry invoice
            </button>
          </p>
        )}
        {loading ? (
          <p role="status" className="py-12 text-center text-gray-500">
            Loading order…
          </p>
        ) : order ? (
          <>
            <section
              aria-label="Order summary"
              className="my-7 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-gray-200 bg-white px-5 py-4 print:hidden"
            >
              <div>
                <h2 className="text-sm font-bold">{order.order_number}</h2>
                <p className="mt-1 text-xs capitalize text-gray-500">
                  {order.status.replaceAll('_', ' ')} ·{' '}
                  {order.fulfillments.length} shop shipment
                  {order.fulfillments.length === 1 ? '' : 's'}
                </p>
              </div>
              <p className="text-sm text-gray-500">
                Cash on delivery{' '}
                <strong className="ml-2 text-gray-900">
                  NPR {order.total}
                </strong>
              </p>
              <Link
                href="/notifications"
                className="text-sm font-semibold text-blue-700 hover:underline"
              >
                Notifications
              </Link>
            </section>
            {invoiceLoading && (
              <p
                role="status"
                className="my-5 text-sm text-gray-500 print:hidden"
              >
                Loading invoice...
              </p>
            )}
            {invoice && <OrderInvoice order={order} invoice={invoice} />}
            <div className="mt-7 space-y-6 print:hidden">
              {order.fulfillments.length === 0 ? (
                <p className="rounded-xl border border-gray-200 bg-white p-8 text-sm text-gray-500">
                  No shipments have been recorded for this order yet.
                </p>
              ) : (
                order.fulfillments.map((shipment) => (
                  <ShipmentTrackingCard
                    key={shipment.id}
                    order={order}
                    shipment={shipment}
                    onOrderUpdate={updateOrder}
                    onFeedbackUpdate={updateFeedback}
                  />
                ))
              )}
            </div>
            <section
              aria-label="Order totals"
              className="mt-6 rounded-xl border border-gray-200 bg-white p-5 text-sm print:hidden"
            >
              <h2 className="font-semibold">Order totals</h2>
              <dl className="mt-3 grid gap-2 sm:max-w-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-500">Subtotal</dt>
                  <dd>NPR {order.subtotal}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-500">Delivery</dt>
                  <dd>NPR {order.shipping_total}</dd>
                </div>
                {order.discount_total !== '0.00' && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-gray-500">
                      Promotion {order.promotion_code}
                    </dt>
                    <dd>− NPR {order.discount_total}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-4 border-t border-gray-100 pt-2 font-semibold">
                  <dt>Total due</dt>
                  <dd>NPR {order.total}</dd>
                </div>
              </dl>
              <Link
                href={`/support?kind=dispute&orderId=${encodeURIComponent(order.id)}`}
                className="mt-5 inline-block text-sm font-semibold text-blue-700 underline underline-offset-4"
              >
                Get help with this order
              </Link>
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}
