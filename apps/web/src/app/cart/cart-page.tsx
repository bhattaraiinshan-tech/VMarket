'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useRef, useState } from 'react';

import { DeliveryAddress, Order, requestApi } from '@/lib/api';
import { createUuid } from '@/lib/uuid';
import StoreAccountMenu from '../marketplace/store-account-menu';
import NotificationPopover from '@/components/notifications/notification-popover';
import {
  CartItemsHeader,
  CartLineItem,
  ShopDeliveryNotice,
} from './cart-components';
import { OrderSummary, normalizePromotionCode } from './order-summary';
import { SavedForLater } from './saved-for-later';
import { useCart } from './use-cart';

function CartHeader({ count }: { count: number | null }) {
  return (
    <header className="border-b border-gray-200 bg-white px-5 sm:px-8">
      <nav
        aria-label="Cart navigation"
        className="mx-auto flex min-h-16 max-w-[1280px] flex-wrap items-center justify-between gap-x-6 gap-y-1 text-xs text-gray-950"
      >
        <Link
          className="py-3 text-base font-bold tracking-tight sm:text-lg"
          href="/marketplace"
        >
          Vendor&apos;s Market
        </Link>
        <div className="flex flex-wrap items-center gap-x-6">
          <Link className="py-3 hover:underline" href="/marketplace">
            Continue shopping
          </Link>
          <Link className="py-3 hover:underline" href="/orders">
            Order history
          </Link>
          <StoreAccountMenu />
          <NotificationPopover />
          <span aria-current="page" className="py-3 font-semibold">
            Cart{count !== null ? ` (${count})` : ''}
          </span>
        </div>
      </nav>
    </header>
  );
}

export default function CartPage() {
  const {
    cart,
    loading,
    reloading,
    error: cartError,
    notice,
    pending,
    reload,
    setQuantity,
    removeItem,
    saveForLater,
  } = useCart();
  const [addresses, setAddresses] = useState<DeliveryAddress[]>([]);
  const [addressId, setAddressId] = useState('');
  const [addressError, setAddressError] = useState('');
  const [promotionDraft, setPromotionDraft] = useState('');
  const [appliedPromotion, setAppliedPromotion] = useState('');
  const [promotionError, setPromotionError] = useState('');
  const [placedOrder, setPlacedOrder] = useState<Order | null>(null);
  const [checkoutError, setCheckoutError] = useState('');
  const [busy, setBusy] = useState(false);
  const [savedVersion, setSavedVersion] = useState(0);
  const idempotencyKey = useRef<{
    key: string;
    addressId: string;
    promotionCode: string;
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void requestApi<DeliveryAddress[]>('/me/addresses', {
      signal: controller.signal,
    })
      .then((nextAddresses) => {
        if (controller.signal.aborted) return;
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
        if (
          !controller.signal.aborted &&
          !(cause instanceof DOMException && cause.name === 'AbortError')
        )
          setAddressError(
            cause instanceof Error
              ? cause.message
              : 'Delivery addresses could not be loaded.',
          );
      });
    return () => controller.abort();
  }, []);

  function applyPromotion() {
    const code = normalizePromotionCode(promotionDraft);
    if (code.length < 3) {
      setPromotionError('Promotion codes must be 3 to 40 characters.');
      return;
    }
    setPromotionError('');
    setAppliedPromotion(code);
    setPromotionDraft(code);
  }

  function clearPromotion() {
    setAppliedPromotion('');
    setPromotionDraft('');
    setPromotionError('');
  }

  async function placeOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || pending) return;
    if (!addressId) {
      setCheckoutError('Add a delivery address before placing your order.');
      return;
    }
    const normalizedCode =
      appliedPromotion || normalizePromotionCode(promotionDraft);
    if (normalizedCode && normalizedCode.length < 3) {
      setPromotionError('Promotion codes must be 3 to 40 characters.');
      return;
    }
    setBusy(true);
    setCheckoutError('');
    setPromotionError('');
    try {
      if (
        !idempotencyKey.current ||
        idempotencyKey.current.addressId !== addressId ||
        idempotencyKey.current.promotionCode !== normalizedCode
      ) {
        idempotencyKey.current = {
          key: createUuid(),
          addressId,
          promotionCode: normalizedCode,
        };
      }
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
      setAppliedPromotion('');
      setPromotionDraft('');
      await reload();
    } catch (cause: unknown) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError'))
        setCheckoutError(
          cause instanceof Error
            ? cause.message
            : 'Checkout could not be completed.',
        );
    } finally {
      setBusy(false);
    }
  }

  const error = checkoutError || cartError;

  return (
    <div className="min-h-screen bg-white">
      <CartHeader count={cart?.item_count ?? null} />
      <main className="mx-auto max-w-[1280px] px-5 py-8 sm:px-8 lg:py-10">
        <nav aria-label="Breadcrumb" className="text-xs text-gray-500">
          <ol className="flex gap-2">
            <li>
              <Link className="hover:underline" href="/marketplace">
                Marketplace
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li aria-current="page" className="text-gray-950">
              Cart
            </li>
          </ol>
        </nav>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-gray-950">
          Shopping cart
        </h1>

        <div aria-live="polite" className="sr-only">
          {notice}
        </div>
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
        {addressError && (
          <p className="mt-3 text-sm text-red-800" role="alert">
            {addressError}
          </p>
        )}
        {placedOrder && (
          <div
            className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4"
            role="status"
          >
            <p className="font-semibold text-emerald-900">
              Order {placedOrder.order_number} placed. Pay NPR{' '}
              {placedOrder.total} on delivery.
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
          <p className="py-16 text-center text-gray-600" role="status">
            Loading your cart…
          </p>
        ) : !cart ? (
          <section className="mt-8 rounded-xl border border-gray-200 p-8 text-center">
            <h2 className="text-xl font-semibold text-gray-950">
              Your cart is unavailable
            </h2>
            <button
              className="mt-4 font-semibold text-gray-950 underline disabled:opacity-50"
              disabled={reloading}
              onClick={() => void reload()}
              type="button"
            >
              Retry
            </button>
          </section>
        ) : !cart.items.length ? (
          <section className="mt-8 rounded-xl border border-gray-200 p-10 text-center">
            <h2 className="text-xl font-semibold text-gray-950">
              Your cart is empty
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              Find something you like in the marketplace and add it to your
              cart.
            </p>
            <Link
              className="mt-5 inline-block rounded-md bg-gray-950 px-5 py-3 text-sm font-semibold uppercase tracking-wider text-white hover:bg-gray-800"
              href="/marketplace"
            >
              Browse the marketplace
            </Link>
          </section>
        ) : (
          <div className="mt-6 grid items-start gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(20rem,3fr)]">
            <section aria-labelledby="cart-items-heading" className="min-w-0">
              <h2 className="sr-only" id="cart-items-heading">
                Cart items
              </h2>
              <ShopDeliveryNotice cart={cart} />
              <div className="mt-6">
                <CartItemsHeader />
                <ul aria-label="Cart items">
                  {cart.items.map((item) => (
                    <CartLineItem
                      item={item}
                      key={item.id}
                      onQuantity={(quantity) =>
                        void setQuantity(item, quantity)
                      }
                      onRemove={() => void removeItem(item)}
                      onSave={() =>
                        void saveForLater(item).then(() =>
                          setSavedVersion((current) => current + 1),
                        )
                      }
                      pending={pending}
                    />
                  ))}
                </ul>
              </div>
              <Link
                className="mt-4 inline-block text-sm font-semibold text-gray-950 underline"
                href="/marketplace"
              >
                ← Continue shopping
              </Link>
            </section>
            <OrderSummary
              addressId={addressId}
              addresses={addresses}
              appliedPromotion={appliedPromotion}
              busy={busy}
              cart={cart}
              disabled={pending !== null}
              onAddressChange={setAddressId}
              onApplyPromotion={applyPromotion}
              onClearPromotion={clearPromotion}
              onPromotionDraftChange={(value) => {
                setPromotionDraft(value);
                setPromotionError('');
                if (normalizePromotionCode(value) !== appliedPromotion)
                  setAppliedPromotion('');
              }}
              onSubmit={(event) => void placeOrder(event)}
              promotionDraft={promotionDraft}
              promotionError={promotionError}
            />
          </div>
        )}
        {cart && <SavedForLater version={savedVersion} />}
      </main>
    </div>
  );
}
