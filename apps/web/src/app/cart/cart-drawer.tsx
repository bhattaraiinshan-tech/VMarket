'use client';

import Link from 'next/link';
import { KeyboardEvent, useEffect, useId, useRef } from 'react';
import type { Cart } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace-context';
import { CartLineItem } from './cart-components';
import { cartEstimate } from './cart-money';
import { useCart } from './use-cart';
import styles from './cart-drawer.module.css';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function CartDrawer({
  initialCart,
  onCartChange,
  onClose,
}: {
  initialCart?: Cart | null;
  onCartChange?: (cart: Cart) => void;
  onClose: () => void;
}) {
  const { user, workspace } = useWorkspace();
  const customer = !!user && workspace === 'customer';
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const userId = useRef(user?.id);
  const {
    cart,
    loading,
    reloading,
    error,
    notice,
    pending,
    reload,
    setQuantity,
    removeItem,
    saveForLater,
  } = useCart({ initialCart, onCartChange });

  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => {
    if (!customer || user?.id !== userId.current) onClose();
  }, [customer, onClose, user?.id]);

  useEffect(() => {
    if (panel.current && !panel.current.contains(document.activeElement))
      closeButton.current?.focus();
  }, [cart, pending]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !panel.current) return;
    const focusable = Array.from(
      panel.current.querySelectorAll<HTMLElement>(FOCUSABLE),
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const estimate = cart ? cartEstimate(cart) : null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        aria-hidden="true"
        className={`${styles.backdrop} absolute inset-0 bg-gray-950/40`}
        onClick={onClose}
      />
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className={`${styles.panel} relative flex h-full w-full max-w-md flex-col bg-white shadow-2xl`}
        onKeyDown={onKeyDown}
        ref={panel}
        role="dialog"
      >
        <header className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h2 className="text-base font-semibold text-gray-950" id={titleId}>
            Your cart{cart ? ` (${cart.item_count})` : ''}
          </h2>
          <button
            aria-label="Close cart"
            className="grid h-9 w-9 place-items-center rounded-md text-xl text-gray-700 hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gray-950"
            onClick={onClose}
            ref={closeButton}
            type="button"
          >
            ×
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5">
          <div aria-live="polite" className="sr-only">
            {notice}
          </div>
          {error && (
            <div
              className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800"
              role="alert"
            >
              {error}
              {!cart && (
                <button
                  className="ml-2 font-semibold underline"
                  disabled={reloading}
                  onClick={() => void reload()}
                  type="button"
                >
                  Retry
                </button>
              )}
            </div>
          )}
          {loading ? (
            <p
              className="py-10 text-center text-sm text-gray-600"
              role="status"
            >
              Loading your cart…
            </p>
          ) : cart && cart.items.length === 0 ? (
            <div className="py-12 text-center">
              <p className="font-semibold text-gray-950">Your cart is empty</p>
              <button
                className="mt-3 text-sm font-semibold underline"
                onClick={onClose}
                type="button"
              >
                Continue shopping
              </button>
            </div>
          ) : cart ? (
            <ul aria-label="Cart items">
              {cart.items.map((item) => (
                <CartLineItem
                  item={item}
                  key={item.id}
                  layout="drawer"
                  onQuantity={(quantity) => void setQuantity(item, quantity)}
                  onRemove={() => void removeItem(item)}
                  onSave={() => void saveForLater(item)}
                  pending={pending}
                />
              ))}
            </ul>
          ) : null}
        </div>

        {cart && estimate && cart.items.length > 0 && (
          <footer className="space-y-3 border-t border-gray-200 px-5 py-4">
            <dl className="space-y-1.5 text-sm text-gray-700">
              <div className="flex justify-between">
                <dt>Subtotal</dt>
                <dd className="font-medium text-gray-950">
                  NPR {cart.subtotal}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt>
                  Delivery ({estimate.shops.length} shop
                  {estimate.shops.length === 1 ? '' : 's'})
                </dt>
                <dd className="font-medium text-gray-950">
                  NPR {estimate.delivery}
                </dd>
              </div>
              <div className="flex justify-between border-t border-gray-200 pt-2 text-base font-bold text-gray-950">
                <dt>Estimated total</dt>
                <dd>NPR {estimate.total}</dd>
              </div>
            </dl>
            <p className="text-xs text-gray-500">
              Cash on delivery. Promotion codes and the delivery address are
              chosen on the cart page.
            </p>
            <Link
              className="block w-full rounded-md bg-gray-950 px-4 py-3 text-center text-sm font-semibold uppercase tracking-wider text-white hover:bg-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-950"
              href="/cart"
              onClick={onClose}
            >
              Checkout
            </Link>
            <button
              className="w-full py-2 text-sm font-semibold text-gray-700 underline"
              onClick={onClose}
              type="button"
            >
              Continue shopping
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}
