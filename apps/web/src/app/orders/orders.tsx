'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { type Order, type FulfillmentOrder, requestApi } from '@/lib/api';
import {
  OrderLineItem,
  OrderStatusFilters,
  OrderStatusBadge as StatusBadge,
  orderControl,
  type OrderFilter as StatusFilter,
  matchesOrderStatus,
  orderDateLabel as dateLabel,
  orderStatusLabel as statusLabel,
} from '@/components/orders/order-presentation';
import { useWorkspace } from '@/lib/workspace-context';
import CustomerDashboardShell, {
  DashboardIcon,
} from '../customer-dashboard-shell';

const cancellable = ['pending', 'confirmed', 'processing'];

function matchesStatus(order: Order, filter: StatusFilter) {
  return (
    filter === 'All orders' ||
    order.fulfillments.some((shipment) =>
      matchesOrderStatus(shipment.status, filter),
    )
  );
}

function shipmentMessage(shipment: FulfillmentOrder) {
  if (shipment.status === 'cancelled')
    return 'This shipment has been canceled.';
  if (shipment.status === 'delivered') return 'Your items have been delivered.';
  if (shipment.status === 'returned') return 'Your items have been returned.';
  if (shipment.status === 'return_requested')
    return 'Your return request is being reviewed.';
  if (shipment.tracking_number) return `Tracking: ${shipment.tracking_number}`;
  if (
    ['shipped', 'picked_up', 'in_transit', 'out_for_delivery'].includes(
      shipment.status,
    )
  )
    return 'On the way. Delivery updates are available in order tracking.';
  if (shipment.status === 'pending')
    return 'Waiting for the shop to confirm your order.';
  return 'The shop is preparing your items for dispatch.';
}

export default function CustomerOrders() {
  const { user, workspace } = useWorkspace();
  return <OrdersDashboard key={`${user?.id}:${workspace}`} />;
}

function OrdersDashboard() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('All orders');
  const [sort, setSort] = useState('newest');
  const [showFilters, setShowFilters] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [shop, setShop] = useState('');
  const [cancelTarget, setCancelTarget] = useState<FulfillmentOrder | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelTrigger = useRef<HTMLButtonElement | null>(null);
  const title = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void requestApi<Order[]>('/me/orders', { signal: controller.signal })
      .then((items) => {
        if (active) {
          setOrders(items);
          setLoaded(true);
        }
      })
      .catch((cause: unknown) => {
        if (
          active &&
          !(cause instanceof DOMException && cause.name === 'AbortError')
        ) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Order history could not be loaded.',
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [retry]);

  useEffect(() => {
    if (cancelTarget) {
      if (!dialog.current?.open) dialog.current?.showModal();
    } else if (!busy && cancelTrigger.current) {
      if (cancelTrigger.current.isConnected) cancelTrigger.current.focus();
      else title.current?.focus();
      cancelTrigger.current = null;
    }
  }, [cancelTarget, busy]);

  const invalidDates = !!from && !!to && from > to;
  const shops = Array.from(
    new Set(
      orders.flatMap((order) =>
        order.fulfillments.map((shipment) => shipment.shop_name),
      ),
    ),
  ).sort();
  const search = query.trim().toLowerCase();
  const visibleOrders = orders
    .filter((order) => {
      const placedAt = new Date(order.created_at);
      const date = `${placedAt.getFullYear()}-${String(placedAt.getMonth() + 1).padStart(2, '0')}-${String(placedAt.getDate()).padStart(2, '0')}`;
      const searchable = [
        order.id,
        order.order_number,
        statusLabel(order.status),
        ...order.fulfillments.flatMap((shipment) => [
          statusLabel(shipment.status),
          shipment.status,
          shipment.shop_name,
          ...shipment.items.map(
            (item) => `${item.product_name} ${item.variant_name ?? ''}`,
          ),
        ]),
      ]
        .join(' ')
        .toLowerCase();
      return (
        matchesStatus(order, filter) &&
        searchable.includes(search) &&
        (!from || date >= from) &&
        (!to || date <= to) &&
        (!shop ||
          order.fulfillments.some((shipment) => shipment.shop_name === shop))
      );
    })
    .sort((a, b) =>
      sort === 'oldest'
        ? new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        : new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );

  function resetFilters() {
    setQuery('');
    setFilter('All orders');
    setFrom('');
    setTo('');
    setShop('');
  }

  async function cancelShipment() {
    if (!cancelTarget || busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const updated = await requestApi<Order>(
        `/me/fulfillment-orders/${encodeURIComponent(cancelTarget.id)}/cancel`,
        { method: 'POST' },
      );
      setOrders((current) =>
        current.map((order) => (order.id === updated.id ? updated : order)),
      );
      setMessage(`Shipment from ${cancelTarget.shop_name} canceled.`);
      setCancelTarget(null);
    } catch (cause: unknown) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
        setError(
          cause instanceof Error
            ? cause.message
            : 'The shipment could not be canceled.',
        );
        setCancelTarget(null);
      }
    } finally {
      setBusy(false);
    }
  }

  const control = orderControl;

  return (
    <CustomerDashboardShell active="/orders">
      <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-medium text-gray-500">
            Dashboard / My Orders
          </p>
          <h1
            ref={title}
            tabIndex={-1}
            className="text-3xl font-bold tracking-tight"
          >
            My Orders
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            Track and manage all your personal orders in one place
          </p>
        </div>
        <Link
          href="/marketplace"
          className={`${control} inline-flex items-center gap-2 font-semibold hover:bg-gray-50`}
        >
          Continue shopping <span aria-hidden="true">&rarr;</span>
        </Link>
      </header>

      <OrderStatusFilters
        selected={filter}
        onChange={setFilter}
        count={(status) =>
          loaded
            ? orders.filter((order) => matchesStatus(order, status)).length
            : null
        }
      />

      <div className="my-5 flex flex-wrap items-center gap-3">
        <label
          className={`${control} flex w-full items-center gap-2 sm:max-w-sm`}
        >
          <DashboardIcon path="M21 21l-5-5M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z" />
          <span className="sr-only">Search orders</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by product, order ID or status"
            className="w-full bg-transparent text-sm outline-none"
          />
        </label>
        <label className={`${control} sm:ml-auto`}>
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
          className={`${control} inline-flex items-center gap-2 font-semibold hover:bg-gray-50`}
          aria-expanded={showFilters}
          aria-controls="advanced-order-filters"
          onClick={() => setShowFilters(!showFilters)}
        >
          <DashboardIcon path="M4 5h16M7 12h10M10 19h4" /> Filter
          {from || to || shop ? ' (active)' : ''}
        </button>
      </div>
      {showFilters && (
        <section
          id="advanced-order-filters"
          aria-label="Advanced order filters"
          className="mb-5 flex flex-wrap items-end gap-4 rounded-xl border border-gray-200 bg-white p-4"
        >
          <label className="grid gap-2 text-xs font-semibold">
            From date
            <input
              className={control}
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label className="grid gap-2 text-xs font-semibold">
            To date
            <input
              className={control}
              type="date"
              min={from || undefined}
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </label>
          <label className="grid gap-2 text-xs font-semibold">
            Shop
            <select
              className={control}
              value={shop}
              onChange={(event) => setShop(event.target.value)}
            >
              <option value="">All shops</option>
              {shops.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={`${control} font-semibold text-blue-700`}
            onClick={resetFilters}
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
        <div
          role="alert"
          className="mb-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          {error}
          {!loaded && (
            <button
              className="ml-3 font-semibold underline"
              type="button"
              onClick={() => {
                setLoading(true);
                setError('');
                setRetry((value) => value + 1);
              }}
            >
              Try again
            </button>
          )}
        </div>
      )}
      {message && (
        <p
          role="status"
          className="mb-5 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800"
        >
          {message}
        </p>
      )}
      {loading ? (
        <p
          role="status"
          className="rounded-xl border border-gray-200 bg-white p-12 text-center text-sm text-gray-500"
        >
          Loading orders...
        </p>
      ) : !loaded ? null : orders.length === 0 ? (
        <section className="rounded-xl border border-gray-200 bg-white px-6 py-16 text-center">
          <h2 className="text-lg font-semibold">No orders yet</h2>
          <p className="mt-2 text-sm text-gray-500">
            When you place an order, you can follow its progress here.
          </p>
          <Link
            href="/marketplace"
            className="mt-5 inline-block rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Browse products
          </Link>
        </section>
      ) : invalidDates ? null : visibleOrders.length === 0 ? (
        <section className="rounded-xl border border-gray-200 bg-white p-12 text-center">
          <h2 className="font-semibold">No matching orders</h2>
          <p className="mt-2 text-sm text-gray-500">
            Try a different search or clear your filters.
          </p>
          <button
            type="button"
            onClick={resetFilters}
            className="mt-4 text-sm font-semibold text-blue-700 underline"
          >
            Clear filters
          </button>
        </section>
      ) : (
        <section aria-label="Order history" className="space-y-4">
          <p role="status" className="text-xs text-gray-500">
            {visibleOrders.length} of {orders.length} orders · An order can
            include separate shop shipments.
          </p>
          {visibleOrders.map((order) => (
            <article
              key={order.id}
              aria-label={`Order ${order.order_number}`}
              className="overflow-hidden rounded-xl border border-[#E5E7EB] bg-white"
            >
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-gray-50/70 px-5 py-4">
                <p className="text-xs text-gray-500">
                  Date of Order{' '}
                  <time
                    dateTime={order.created_at}
                    className="ml-2 font-semibold text-gray-800"
                  >
                    {dateLabel(order.created_at)}
                  </time>
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <StatusBadge status={order.status} />
                  <h2 className="text-xs text-gray-500">
                    Order ID:{' '}
                    <span className="font-semibold text-gray-800">
                      {order.order_number}
                    </span>
                  </h2>
                </div>
              </header>
              {order.fulfillments.map((shipment) => (
                <section
                  key={shipment.id}
                  aria-label={`Shipment from ${shipment.shop_name}`}
                  className="border-b border-gray-100 px-5 py-5 last:border-0"
                >
                  <p className="mb-4 text-xs font-semibold text-gray-500">
                    {shipment.shop_name}{' '}
                    <span className="ml-2 font-normal">
                      {shipment.fulfillment_number}
                    </span>
                  </p>
                  <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_200px]">
                    <ul className="space-y-5">
                      {shipment.items.map((item) => (
                        <OrderLineItem key={item.id} item={item} />
                      ))}
                    </ul>
                    <div className="flex flex-col items-start border-t border-gray-100 pt-4 xl:border-l xl:border-t-0 xl:pl-5 xl:pt-0">
                      <StatusBadge status={shipment.status} />
                      <p className="mb-4 mt-2 break-all text-xs leading-5 text-gray-500">
                        {shipmentMessage(shipment)}
                      </p>
                      <Link
                        href={`/orders/${order.id}`}
                        className="w-full rounded-md bg-blue-600 px-4 py-2 text-center text-xs font-semibold text-white hover:bg-blue-700"
                      >
                        Track Order
                      </Link>
                      {cancellable.includes(shipment.status) ? (
                        <button
                          disabled={busy}
                          type="button"
                          onClick={(event) => {
                            cancelTrigger.current = event.currentTarget;
                            setCancelTarget(shipment);
                          }}
                          className="mt-2 w-full rounded-md border border-gray-300 px-4 py-2 text-xs font-semibold text-gray-700 hover:border-red-300 hover:bg-red-50 hover:text-red-800 disabled:opacity-50"
                        >
                          Cancel Order
                        </button>
                      ) : (
                        <Link
                          href={`/orders/${order.id}?invoice=1`}
                          className="mt-2 w-full rounded-md border border-gray-300 px-4 py-2 text-center text-xs font-semibold text-gray-700 hover:bg-gray-50"
                        >
                          View Invoice
                        </Link>
                      )}
                    </div>
                  </div>
                </section>
              ))}
              <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-5 py-3 text-xs text-gray-500">
                <span>
                  Delivery: NPR {order.shipping_total}
                  {order.discount_total !== '0.00' &&
                    ` · Discount: NPR ${order.discount_total}`}
                </span>
                <span>
                  Order total{' '}
                  <strong className="ml-2 text-sm text-gray-900">
                    NPR {order.total}
                  </strong>
                </span>
              </footer>
            </article>
          ))}
        </section>
      )}
      {cancelTarget && (
        <dialog
          ref={dialog}
          onCancel={(event) => {
            event.preventDefault();
            if (!busy) setCancelTarget(null);
          }}
          aria-labelledby="cancel-order-title"
          aria-describedby="cancel-order-description"
          className="w-[calc(100%-2rem)] max-w-md rounded-xl border border-gray-200 p-6 shadow-xl backdrop:bg-gray-950/40"
        >
          <h2 id="cancel-order-title" className="text-lg font-bold">
            Cancel this shipment?
          </h2>
          <p
            id="cancel-order-description"
            className="mt-3 text-sm leading-6 text-gray-600"
          >
            This cancels all items from {cancelTarget.shop_name} in this
            shipment only. Other shop shipments will not be changed.
          </p>
          <div className="mt-6 flex justify-end gap-3">
            <button
              autoFocus
              disabled={busy}
              type="button"
              className={control}
              onClick={() => setCancelTarget(null)}
            >
              Keep order
            </button>
            <button
              disabled={busy}
              type="button"
              onClick={() => void cancelShipment()}
              className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
            >
              {busy ? 'Canceling...' : 'Confirm cancellation'}
            </button>
          </div>
        </dialog>
      )}
    </CustomerDashboardShell>
  );
}
