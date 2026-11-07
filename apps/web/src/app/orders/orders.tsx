'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Order, requestApi } from '@/lib/api';

export default function CustomerOrders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void requestApi<Order[]>('/me/orders')
      .then((items) => {
        setOrders(items);
        setLoaded(true);
      })
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error
            ? cause.message
            : 'Order history could not be loaded.',
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-5 py-8 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <Link
            className="text-sm font-bold text-emerald-800"
            href="/marketplace"
          >
            Vendor&apos;s Market
          </Link>
          <h1 className="mt-2 text-3xl font-bold text-slate-950">
            Your orders
          </h1>
        </div>
        <div className="flex gap-4 text-sm font-semibold text-emerald-800">
          <Link href="/notifications">Notifications</Link>
          <Link href="/cart">Shopping cart</Link>
        </div>
      </header>
      {error && (
        <p
          className="mt-5 rounded-lg bg-red-50 p-4 text-sm text-red-800"
          role="alert"
        >
          {error}
        </p>
      )}
      {loading ? (
        <p className="py-12 text-center text-slate-600" role="status">
          Loading orders…
        </p>
      ) : !loaded ? null : orders.length === 0 ? (
        <section className="mt-8 rounded-xl border border-slate-200 bg-white p-8 text-center">
          <p className="font-semibold text-slate-900">No orders yet</p>
          <p className="mt-2 text-sm text-slate-600">
            When you place an order, you can follow its progress here.
          </p>
          <Link
            className="mt-3 inline-block font-semibold text-emerald-800"
            href="/marketplace"
          >
            Browse products
          </Link>
        </section>
      ) : (
        <section aria-label="Order history" className="mt-7 space-y-4">
          {orders.map((order) => (
            <article
              className="rounded-xl border border-slate-200 bg-white p-5"
              key={order.id}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-950">
                    {order.order_number}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    Placed {new Date(order.created_at).toLocaleString()}
                  </p>
                </div>
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold capitalize text-emerald-900">
                  {order.status.replaceAll('_', ' ')}
                </span>
              </div>
              <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-3">
                <p className="text-sm text-slate-700">
                  {order.fulfillments.length} vendor fulfillment
                  {order.fulfillments.length === 1 ? '' : 's'}
                </p>
                <p className="text-sm text-slate-700">
                  Cash on delivery · NPR {order.total}
                </p>
                <Link
                  className="text-sm font-semibold text-emerald-800 underline sm:text-right"
                  href={`/orders/${order.id}`}
                >
                  Track order and invoice
                </Link>
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
