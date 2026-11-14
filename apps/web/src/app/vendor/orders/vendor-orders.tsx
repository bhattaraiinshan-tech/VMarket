'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { type FulfillmentOrder, requestApi } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace-context';
import {
  matchesOrderStatus,
  OrderLineItem,
  OrderStatusBadge,
  OrderStatusFilters,
  orderControl,
  orderDateLabel,
  type OrderFilter,
} from '@/components/orders/order-presentation';
import VendorShell, { VendorPageHeader } from '../vendor-shell';

export default function VendorOrders() {
  const { user, workspace, shopId } = useWorkspace();
  return <OrdersContent key={`${user?.id}:${workspace}:${shopId}`} />;
}

function OrdersContent() {
  const [orders, setOrders] = useState<FulfillmentOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<OrderFilter>('All orders');
  const [sort, setSort] = useState('newest');
  const [showFilters, setShowFilters] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const items: FulfillmentOrder[] = [];
        let total = 0;
        do {
          const result = await requestApi<{
            items: FulfillmentOrder[];
            total: number;
          }>(`/vendor/orders?offset=${items.length}`, {
            signal: controller.signal,
          });
          if (controller.signal.aborted) return;
          total = result.total;
          if (!result.items.length && items.length < total)
            throw new Error(
              'Order history changed while loading. Please try again.',
            );
          items.push(...result.items);
        } while (items.length < total);
        if (!controller.signal.aborted) {
          setOrders(
            Array.from(new Map(items.map((item) => [item.id, item])).values()),
          );
          setLoaded(true);
        }
      } catch (cause: unknown) {
        if (
          !controller.signal.aborted &&
          !(cause instanceof DOMException && cause.name === 'AbortError')
        )
          setError(
            cause instanceof Error
              ? cause.message
              : 'Vendor orders could not be loaded.',
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [retry]);

  const invalidDates = !!from && !!to && from > to;
  const search = query.trim().toLowerCase();
  const visibleOrders = orders
    .filter((order) => {
      const placed = new Date(order.created_at);
      const date = `${placed.getFullYear()}-${String(placed.getMonth() + 1).padStart(2, '0')}-${String(placed.getDate()).padStart(2, '0')}`;
      return (
        matchesOrderStatus(order.status, filter) &&
        [
          order.id,
          order.order_id,
          order.fulfillment_number,
          order.status,
          order.tracking_number,
          ...order.items.map(
            (item) =>
              `${item.product_name} ${item.variant_name || ''} ${item.sku}`,
          ),
        ]
          .join(' ')
          .toLowerCase()
          .includes(search) &&
        (!from || date >= from) &&
        (!to || date <= to)
      );
    })
    .sort(
      (a, b) =>
        (sort === 'oldest' ? 1 : -1) *
        (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
    );

  function clearFilters() {
    setQuery('');
    setFilter('All orders');
    setFrom('');
    setTo('');
  }

  return (
    <VendorShell active="orders">
      <VendorPageHeader
        title="Shop orders"
        description="Order history and fulfillment for the explicitly selected shop."
      />
      <OrderStatusFilters
        selected={filter}
        onChange={setFilter}
        count={(status) =>
          loaded
            ? orders.filter((order) => matchesOrderStatus(order.status, status))
                .length
            : null
        }
      />
      <div className="my-5 flex flex-wrap items-center gap-3">
        <label
          className={`${orderControl} flex w-full items-center gap-2 sm:max-w-sm`}
        >
          <span className="sr-only">Search orders</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by product, order ID or status"
            className="w-full bg-transparent text-sm"
          />
        </label>
        <label className={`${orderControl} sm:ml-auto`}>
          Sort By:{' '}
          <select
            aria-label="Sort orders"
            value={sort}
            onChange={(event) => setSort(event.target.value)}
            className="bg-white font-semibold"
          >
            <option value="newest">Newest Order</option>
            <option value="oldest">Oldest Order</option>
          </select>
        </label>
        <button
          type="button"
          className={`${orderControl} font-semibold`}
          aria-expanded={showFilters}
          aria-controls="vendor-date-filters"
          onClick={() => setShowFilters(!showFilters)}
        >
          Filter{from || to ? ' (active)' : ''}
        </button>
      </div>
      {showFilters && (
        <section
          id="vendor-date-filters"
          aria-label="Advanced order filters"
          className="mb-5 flex flex-wrap items-end gap-4 rounded-xl border border-gray-200 bg-white p-4"
        >
          <label className="grid gap-2 text-xs font-semibold">
            From date
            <input
              className={orderControl}
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label className="grid gap-2 text-xs font-semibold">
            To date
            <input
              className={orderControl}
              type="date"
              min={from || undefined}
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </label>
          <button
            type="button"
            className={`${orderControl} font-semibold text-blue-700`}
            onClick={clearFilters}
          >
            Clear filters
          </button>
        </section>
      )}
      {invalidDates && (
        <p role="alert" className="mb-4 text-sm text-red-800">
          From date must be on or before To date.
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          {error}
          <button
            type="button"
            className="ml-3 font-semibold underline"
            onClick={() => {
              setError('');
              setLoading(true);
              setRetry((value) => value + 1);
            }}
          >
            Try again
          </button>
        </p>
      )}
      {loading ? (
        <p
          role="status"
          className="rounded-xl border border-gray-200 bg-white p-12 text-center text-sm text-gray-500"
        >
          Loading vendor orders...
        </p>
      ) : !loaded ? null : !orders.length ? (
        <section className="rounded-xl border border-gray-200 bg-white p-12 text-center">
          <h2 className="font-semibold">No orders yet</h2>
          <p className="mt-2 text-sm text-gray-500">
            No orders are waiting for your shop.
          </p>
        </section>
      ) : invalidDates ? null : !visibleOrders.length ? (
        <section className="rounded-xl border border-gray-200 bg-white p-12 text-center">
          <h2 className="font-semibold">No matching orders</h2>
          <button
            type="button"
            onClick={clearFilters}
            className="mt-4 text-sm font-semibold text-blue-700 underline"
          >
            Clear filters
          </button>
        </section>
      ) : (
        <section aria-label="Vendor fulfillment orders" className="space-y-4">
          <p role="status" className="text-xs text-gray-500">
            {visibleOrders.length} of {orders.length} shop shipments
          </p>
          {visibleOrders.map((order) => (
            <article
              key={order.id}
              aria-label={`Order ${order.fulfillment_number}`}
              className="overflow-hidden rounded-xl border border-[#E5E7EB] bg-white"
            >
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-gray-50/70 px-5 py-4">
                <p className="text-xs text-gray-500">
                  Date of Order{' '}
                  <time
                    dateTime={order.created_at}
                    className="ml-2 font-semibold text-gray-800"
                  >
                    {orderDateLabel(order.created_at)}
                  </time>
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <OrderStatusBadge status={order.status} />
                  <h2 className="text-xs text-gray-500">
                    Order ID:{' '}
                    <span className="font-semibold text-gray-800">
                      {order.fulfillment_number}
                    </span>
                  </h2>
                </div>
              </header>
              <div className="px-5 py-5">
                <p className="mb-4 text-xs font-semibold text-gray-500">
                  {order.shop_name}
                </p>
                <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_200px]">
                  <ul className="space-y-5">
                    {order.items.map((item) => (
                      <OrderLineItem key={item.id} item={item} />
                    ))}
                  </ul>
                  <div className="flex flex-col items-start border-t border-gray-100 pt-4 xl:border-l xl:border-t-0 xl:pl-5 xl:pt-0">
                    <OrderStatusBadge status={order.status} />
                    <p className="mb-4 mt-2 break-all text-xs leading-5 text-gray-500">
                      {order.tracking_number
                        ? `Tracking: ${order.tracking_number}`
                        : 'Tracking not assigned yet.'}
                    </p>
                    <Link
                      href={`/vendor/orders/${order.id}`}
                      className="w-full rounded-md bg-blue-600 px-4 py-2 text-center text-xs font-semibold text-white hover:bg-blue-700"
                    >
                      Track Order
                    </Link>
                    <Link
                      href={`/vendor/orders/${order.id}#fulfillment-actions`}
                      className="mt-2 w-full rounded-md border border-gray-300 px-4 py-2 text-center text-xs font-semibold text-gray-700 hover:bg-gray-50"
                    >
                      Manage fulfillment
                    </Link>
                    <Link
                      href={`/vendor/orders/${order.id}#payment-details`}
                      className="mt-2 text-xs font-semibold text-blue-700 underline"
                    >
                      View payment details
                    </Link>
                  </div>
                </div>
              </div>
              <footer className="flex flex-wrap justify-between gap-3 border-t border-gray-100 px-5 py-3 text-xs text-gray-500">
                <span>
                  Delivery: NPR {order.shipping_fee} · Discount: NPR{' '}
                  {order.discount_total}
                </span>
                <span>
                  Shop subtotal{' '}
                  <strong className="ml-2 text-sm text-gray-900">
                    NPR {order.subtotal}
                  </strong>
                </span>
              </footer>
            </article>
          ))}
        </section>
      )}
    </VendorShell>
  );
}
