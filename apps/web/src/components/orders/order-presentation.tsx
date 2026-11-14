import type { OrderEvent, OrderItem } from '@/lib/api';
import { browserStorageUrl } from '@/lib/network';

export const orderFilters = [
  'All orders',
  'Processing',
  'Shipped',
  'Delivered',
  'Canceled',
] as const;
export type OrderFilter = (typeof orderFilters)[number];

export function OrderStatusFilters({
  selected,
  onChange,
  count,
}: {
  selected: OrderFilter;
  onChange: (filter: OrderFilter) => void;
  count: (filter: OrderFilter) => number | null;
}) {
  return (
    <div
      aria-label="Order status filters"
      className="flex gap-5 overflow-x-auto border-b border-[#E5E7EB]"
    >
      {orderFilters.map((status) => (
        <button
          type="button"
          key={status}
          aria-pressed={selected === status}
          onClick={() => onChange(status)}
          className={`flex shrink-0 items-center gap-2 border-b-2 px-1 pb-4 pt-2 text-sm font-semibold ${selected === status ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-900'}`}
        >
          {status}
          <span
            className={`rounded-md px-2 py-0.5 text-xs ${selected === status ? 'bg-blue-100 text-blue-800' : 'bg-gray-200 text-gray-600'}`}
          >
            {count(status) ?? '-'}
          </span>
        </button>
      ))}
    </div>
  );
}
export const processingStatuses = ['pending', 'confirmed', 'processing'];
export const shippedStatuses = [
  'shipped',
  'picked_up',
  'in_transit',
  'out_for_delivery',
];
export const orderControl =
  'rounded-lg border border-[#E5E7EB] bg-white px-3 py-2.5 text-sm text-gray-700';
export const orderStatusLabel = (status: string) =>
  status.replaceAll('_', ' ').replaceAll('cancelled', 'canceled');
export const orderDateLabel = (date: string) =>
  new Date(date).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

export function matchesOrderStatus(status: string, filter: OrderFilter) {
  return (
    filter === 'All orders' ||
    (filter === 'Processing'
      ? processingStatuses.includes(status)
      : filter === 'Shipped'
        ? shippedStatuses.includes(status)
        : status === (filter === 'Canceled' ? 'cancelled' : 'delivered'))
  );
}

export function OrderStatusBadge({ status }: { status: string }) {
  const color =
    status === 'delivered' || status === 'completed'
      ? 'bg-emerald-50 text-emerald-800'
      : shippedStatuses.includes(status)
        ? 'bg-blue-50 text-blue-800'
        : status.includes('cancelled')
          ? 'bg-red-50 text-red-800'
          : status === 'pending'
            ? 'bg-amber-50 text-amber-800'
            : 'bg-violet-50 text-violet-800';
  return (
    <span
      className={`inline-flex rounded-md px-2.5 py-1 text-xs font-semibold capitalize ${color}`}
    >
      {orderStatusLabel(status)}
    </span>
  );
}

export function OrderLineItem({ item }: { item: OrderItem }) {
  return (
    <li className="grid grid-cols-[80px_minmax(0,1fr)] items-start gap-4 sm:flex sm:items-center">
      {item.image_url ? (
        <div
          role="img"
          aria-label={item.image_alt || item.product_name}
          className="h-20 w-20 shrink-0 rounded-lg border border-gray-200 bg-gray-50 bg-contain bg-center bg-no-repeat"
          style={{
            backgroundImage: `url("${browserStorageUrl(item.image_url)}")`,
          }}
        />
      ) : (
        <div className="grid h-20 w-20 shrink-0 place-items-center rounded-lg border border-gray-200 bg-gray-50 px-2 text-center text-[10px] text-gray-500">
          Image not provided
        </div>
      )}
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-gray-950">
          {item.product_name}
        </h3>
        <p className="mt-1.5 text-xs leading-5 text-gray-500">
          {item.variant_name && (
            <>
              Variant: {item.variant_name}
              <span className="mx-2 text-gray-300">|</span>
            </>
          )}
          Quantity: {item.quantity}
        </p>
        <p className="mt-1 text-xs text-gray-500">SKU: {item.sku}</p>
      </div>
      <div className="col-start-2 text-sm sm:min-w-36">
        <p className="font-semibold text-gray-950">NPR {item.line_total}</p>
        <p className="mt-1 text-xs text-gray-500">NPR {item.unit_price} each</p>
        <p className="mt-2 text-xs text-gray-500">Cash on delivery</p>
      </div>
    </li>
  );
}

export function OrderTrackingHistory({
  events,
  status,
}: {
  events: OrderEvent[];
  status: string;
}) {
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
  const history = [...events].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  return (
    <section aria-label="Tracking history" className="pt-6">
      <h3 className="text-sm font-semibold text-gray-950">Tracking History</h3>
      <p className="mt-1 text-xs text-gray-500">
        Latest update first · Times shown in your local timezone
      </p>
      {!history.length ? (
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
                  {orderDateLabel(event.created_at)}
                </span>
                <span>
                  At{' '}
                  {new Date(event.created_at).toLocaleTimeString('en-GB', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </time>
              <div aria-hidden="true" className="relative flex justify-center">
                {index < history.length - 1 && (
                  <span className="absolute bottom-0 top-2 w-px bg-gray-200" />
                )}
                <span
                  className={`relative mt-1 h-3 w-3 rounded-full border-[3px] ${index === 0 ? (event.to_status === 'delivered' || event.to_status === 'return_rejected' ? 'border-emerald-100 bg-emerald-600 ring-2 ring-emerald-50' : 'border-blue-100 bg-blue-600 ring-2 ring-blue-50') : 'border-gray-100 bg-gray-500'}`}
                />
              </div>
              <div className="min-w-0 pb-7">
                <p
                  className={`font-semibold capitalize ${index === 0 && status === 'delivered' ? 'text-emerald-800' : 'text-gray-800'}`}
                >
                  {labels[event.to_status] || orderStatusLabel(event.to_status)}
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
  );
}
