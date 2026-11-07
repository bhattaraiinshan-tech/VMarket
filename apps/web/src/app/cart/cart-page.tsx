'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useRef, useState } from 'react';

import { Cart, DeliveryAddress, Order, requestApi } from '@/lib/api';

function addNprAmounts(...amounts: string[]): string {
  let total = '0';
  for (const amount of amounts) {
    const [whole = '0', fraction = ''] = amount.split('.');
    const current = `${whole}${fraction.padEnd(2, '0').slice(0, 2)}`;
    const width = Math.max(total.length, current.length);
    let carry = 0;
    let sum = '';
    for (let index = 0; index < width; index += 1) {
      const left = Number(total.at(-(index + 1)) ?? '0');
      const right = Number(current.at(-(index + 1)) ?? '0');
      const digitSum = left + right + carry;
      sum = `${digitSum % 10}${sum}`;
      carry = Math.floor(digitSum / 10);
    }
    total = `${carry ? String(carry) : ''}${sum}`.replace(/^0+(?=\d)/, '');
  }
  const padded = total.padStart(3, '0');
  return `${padded.slice(0, -2)}.${padded.slice(-2)}`;
}

export default function CartPage() {
  const [cart, setCart] = useState<Cart | null>(null);
  const [addresses, setAddresses] = useState<DeliveryAddress[]>([]);
  const [addressId, setAddressId] = useState('');
  const [promotionCode, setPromotionCode] = useState('');
  const [placedOrder, setPlacedOrder] = useState<Order | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const idempotencyKey = useRef<{
    key: string;
    addressId: string;
    promotionCode: string;
  } | null>(null);

  async function loadCheckoutData() {
    setLoading(true);
    setError('');
    try {
      const [nextCart, nextAddresses] = await Promise.all([
        requestApi<Cart>('/me/cart'),
        requestApi<DeliveryAddress[]>('/me/addresses'),
      ]);
      setCart(nextCart);
      setAddresses(nextAddresses);
      setAddressId(
        (current) =>
          current ||
          nextAddresses.find((address) => address.is_default)?.id ||
          nextAddresses[0]?.id ||
          '',
      );
    } catch (cause: unknown) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Your cart could not be loaded.',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    void Promise.all([
      requestApi<Cart>('/me/cart'),
      requestApi<DeliveryAddress[]>('/me/addresses'),
    ])
      .then(([nextCart, nextAddresses]) => {
        if (!active) return;
        setCart(nextCart);
        setAddresses(nextAddresses);
        setAddressId(
          (current) =>
            current ||
            nextAddresses.find((address) => address.is_default)?.id ||
            nextAddresses[0]?.id ||
            '',
        );
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Your cart could not be loaded.',
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function updateQuantity(itemId: string, quantity: number) {
    setError('');
    try {
      setCart(
        await requestApi<Cart>(`/me/cart/items/${itemId}`, {
          method: 'PATCH',
          body: JSON.stringify({ quantity }),
        }),
      );
    } catch (cause: unknown) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The quantity could not be updated.',
      );
    }
  }

  async function removeItem(itemId: string) {
    setError('');
    try {
      await requestApi<void>(`/me/cart/items/${itemId}`, { method: 'DELETE' });
      await loadCheckoutData();
    } catch (cause: unknown) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The cart item could not be removed.',
      );
    }
  }

  async function placeOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!addressId) {
      setError('Add a delivery address before placing your order.');
      return;
    }
    setBusy(true);
    setError('');
    const normalizedCode = promotionCode.trim().toUpperCase();
    if (
      !idempotencyKey.current ||
      idempotencyKey.current.addressId !== addressId ||
      idempotencyKey.current.promotionCode !== normalizedCode
    ) {
      idempotencyKey.current = {
        key: crypto.randomUUID(),
        addressId,
        promotionCode: normalizedCode,
      };
    }
    try {
      const order = await requestApi<Order>('/me/checkout', {
        method: 'POST',
        body: JSON.stringify({
          address_id: addressId,
          payment_method: 'cash_on_delivery',
          idempotency_key: idempotencyKey.current.key,
          promotion_code: normalizedCode || null,
        }),
      });
      setPlacedOrder(order);
      idempotencyKey.current = null;
      await loadCheckoutData();
    } catch (cause: unknown) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Checkout could not be completed.',
      );
    } finally {
      setBusy(false);
    }
  }

  const vendorCount = new Set(cart?.items.map((item) => item.shop_id)).size;
  const shipping = `${vendorCount * 100}.00`;

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
            Shopping cart
          </h1>
        </div>
        <Link className="text-sm font-semibold text-emerald-800" href="/orders">
          Order history
        </Link>
      </header>

      {error && (
        <p
          className="mt-5 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800"
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
      {placedOrder && (
        <div
          className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4"
          role="status"
        >
          <p className="font-semibold text-emerald-900">
            Order {placedOrder.order_number} placed. Pay NPR {placedOrder.total}{' '}
            on delivery.
          </p>
          <Link
            className="mt-2 inline-block text-sm font-semibold text-emerald-900 underline"
            href={`/orders/${placedOrder.id}`}
          >
            Track order and view invoice
          </Link>
        </div>
      )}

      {loading ? (
        <p className="py-12 text-center text-slate-600" role="status">
          Loading your cart…
        </p>
      ) : !cart ? (
        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-8 text-center">
          <h2 className="text-xl font-semibold text-slate-900">
            Your cart is unavailable
          </h2>
          <button
            className="mt-4 font-semibold text-emerald-800 underline"
            onClick={() => void loadCheckoutData()}
            type="button"
          >
            Retry
          </button>
        </section>
      ) : !cart.items.length ? (
        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-8 text-center">
          <h2 className="text-xl font-semibold text-slate-900">
            Your cart is empty
          </h2>
          <Link
            className="mt-4 inline-block font-semibold text-emerald-800"
            href="/marketplace"
          >
            Browse the marketplace
          </Link>
        </section>
      ) : (
        <div className="mt-7 grid gap-6 lg:grid-cols-[1fr_21rem]">
          <section aria-label="Cart items" className="space-y-3">
            {cart.items.map((item) => (
              <article
                className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4"
                key={item.id}
              >
                <div>
                  <h2 className="font-semibold text-slate-950">
                    {item.product_name}
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">
                    {item.variant_name ? `${item.variant_name} · ` : ''}
                    {item.shop_name} · NPR {item.unit_price} each
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">
                    Line total: NPR {item.line_total}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div
                    aria-label={`Quantity for ${item.product_name}`}
                    className="flex items-center gap-2 text-sm text-slate-700"
                  >
                    <button
                      aria-label={`Decrease ${item.product_name} quantity`}
                      className="h-8 w-8 rounded border border-slate-300 disabled:opacity-40"
                      disabled={item.quantity <= 1}
                      onClick={() =>
                        void updateQuantity(item.id, item.quantity - 1)
                      }
                      type="button"
                    >
                      −
                    </button>
                    <span className="min-w-6 text-center">{item.quantity}</span>
                    <button
                      aria-label={`Increase ${item.product_name} quantity`}
                      className="h-8 w-8 rounded border border-slate-300 disabled:opacity-40"
                      disabled={item.quantity >= item.available_stock}
                      onClick={() =>
                        void updateQuantity(item.id, item.quantity + 1)
                      }
                      type="button"
                    >
                      +
                    </button>
                  </div>
                  <button
                    className="text-sm font-semibold text-red-700 underline"
                    onClick={() => void removeItem(item.id)}
                    type="button"
                  >
                    Remove
                  </button>
                </div>
              </article>
            ))}
          </section>

          <form
            className="h-fit rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            onSubmit={(event) => void placeOrder(event)}
          >
            <h2 className="text-lg font-semibold text-slate-950">Checkout</h2>
            <label className="mt-4 block text-sm font-medium text-slate-800">
              Delivery address
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                onChange={(event) => setAddressId(event.target.value)}
                required
                value={addressId}
              >
                <option value="">Choose an address</option>
                {addresses.map((address) => (
                  <option key={address.id} value={address.id}>
                    {address.label}: {address.recipient_name}, {address.city},{' '}
                    {address.province}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-4 block text-sm font-medium text-slate-800">
              Promotion code (optional)
              <input
                autoComplete="off"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                maxLength={40}
                onChange={(event) => setPromotionCode(event.target.value)}
                value={promotionCode}
              />
            </label>
            {addresses.length === 0 && (
              <p className="mt-2 text-sm text-slate-600">
                <Link
                  className="font-semibold text-emerald-800 underline"
                  href="/"
                >
                  Add a delivery address from your profile
                </Link>
              </p>
            )}
            {addressId && (
              <p className="mt-2 text-xs text-slate-500">
                {
                  addresses.find((address) => address.id === addressId)
                    ?.street_address
                }
              </p>
            )}
            <div className="mt-5 space-y-2 border-t border-slate-100 pt-4 text-sm">
              <p className="flex justify-between">
                <span>Subtotal</span>
                <span>NPR {cart.subtotal}</span>
              </p>
              <p className="flex justify-between">
                <span>
                  Delivery ({vendorCount} shop{vendorCount === 1 ? '' : 's'})
                </span>
                <span>NPR {shipping}</span>
              </p>
              <p className="flex justify-between border-t border-slate-100 pt-3 font-bold text-slate-950">
                <span>Estimated total</span>
                <span>NPR {addNprAmounts(cart.subtotal, shipping)}</span>
              </p>
            </div>
            <p className="mt-4 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600">
              Cash on delivery. Delivery is NPR 100 per vendor fulfillment.
              Any promotion discount is validated and applied by the server at
              checkout.
            </p>
            <button
              className="mt-4 w-full rounded-lg bg-emerald-800 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
              disabled={busy || !addressId}
              type="submit"
            >
              {busy ? 'Placing order…' : 'Place order'}
            </button>
          </form>
        </div>
      )}
    </main>
  );
}
