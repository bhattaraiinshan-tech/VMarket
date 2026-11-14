import { type Order } from '@/lib/api';

export type Invoice = {
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

export default function OrderInvoice({
  order,
  invoice,
}: {
  order: Order;
  invoice: Invoice;
}) {
  return (
    <section
      aria-label="Order invoice"
      className="mt-6 rounded-xl border border-gray-200 bg-white p-6 print:mt-0 print:border-0"
    >
      <p className="text-sm font-semibold text-emerald-800">
        Vendor&apos;s Market · Nepal
      </p>
      <h2 className="mt-2 text-2xl font-bold">
        Invoice {invoice.invoice_number}
      </h2>
      <p className="mt-1 text-sm text-gray-600">{invoice.order_number}</p>
      <div className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
        <div>
          <p className="font-semibold">Ship to</p>
          <p>{invoice.shipping_address.recipient_name}</p>
          <p>{invoice.shipping_address.street_address}</p>
          <p>
            {[
              invoice.shipping_address.area,
              invoice.shipping_address.city,
              invoice.shipping_address.province,
              invoice.shipping_address.postal_code,
            ]
              .filter(Boolean)
              .join(', ')}
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
          className="mt-5 border-t border-gray-200 pt-4"
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
              <span className="shrink-0">NPR {item.line_total}</span>
            </p>
          ))}
          <p className="mt-2 flex justify-between border-t border-gray-100 pt-2 text-sm">
            <span>Delivery</span>
            <span>NPR {fulfillment.shipping_fee}</span>
          </p>
        </div>
      ))}
      <div className="mt-5 space-y-1 border-t border-gray-300 pt-3 text-right text-sm">
        <p>Subtotal: NPR {invoice.subtotal}</p>
        <p>Delivery: NPR {invoice.shipping_total}</p>
        {invoice.discount_total !== '0.00' && (
          <p>Promotion discount: − NPR {invoice.discount_total}</p>
        )}
        <p className="text-lg font-bold">Total due: NPR {invoice.total}</p>
      </div>
    </section>
  );
}
