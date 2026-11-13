'use client';

import Link from 'next/link';
import { FormEvent, useId } from 'react';
import type { Cart, DeliveryAddress } from '@/lib/api';
import { CartPerks } from './cart-components';
import { cartEstimate } from './cart-money';

export function normalizePromotionCode(value: string) {
  return value.trim().toUpperCase();
}

export function OrderSummary({
  cart,
  addresses,
  addressId,
  onAddressChange,
  promotionDraft,
  onPromotionDraftChange,
  appliedPromotion,
  onApplyPromotion,
  onClearPromotion,
  promotionError,
  busy,
  disabled,
  onSubmit,
}: {
  cart: Cart;
  addresses: DeliveryAddress[];
  addressId: string;
  onAddressChange: (id: string) => void;
  promotionDraft: string;
  onPromotionDraftChange: (value: string) => void;
  appliedPromotion: string;
  onApplyPromotion: () => void;
  onClearPromotion: () => void;
  promotionError: string;
  busy: boolean;
  disabled: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const id = useId();
  const { shops, delivery, total } = cartEstimate(cart);
  const selectedAddress = addresses.find((address) => address.id === addressId);
  const blockedItem = cart.items.find(
    (item) => item.available_stock < item.quantity,
  );

  return (
    <form
      aria-labelledby={`${id}-heading`}
      className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6 lg:sticky lg:top-6"
      onSubmit={onSubmit}
    >
      <h2
        className="text-lg font-semibold tracking-tight text-gray-950"
        id={`${id}-heading`}
      >
        Order summary
      </h2>

      <dl className="mt-5 space-y-3 text-sm text-gray-700">
        <div className="flex justify-between gap-4">
          <dt>
            Subtotal ({cart.item_count} item{cart.item_count === 1 ? '' : 's'})
          </dt>
          <dd className="font-medium text-gray-950">NPR {cart.subtotal}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt>
            Delivery ({shops.length} shop{shops.length === 1 ? '' : 's'})
          </dt>
          <dd className="font-medium text-gray-950">NPR {delivery}</dd>
        </div>
        {appliedPromotion && (
          <div className="flex justify-between gap-4">
            <dt>Promotion {appliedPromotion}</dt>
            <dd className="text-gray-500">Applied at checkout</dd>
          </div>
        )}
      </dl>
      <p className="mt-3 text-xs leading-5 text-gray-500">
        No separate tax is added at checkout. Prices shown are the shop prices
        in NPR.
      </p>

      <div className="mt-5 border-t border-gray-200 pt-5">
        <label
          className="text-sm font-medium text-gray-950"
          htmlFor={`${id}-promo`}
        >
          Promotion code
        </label>
        <div className="mt-2 flex gap-2">
          <input
            aria-describedby={`${id}-promo-help`}
            aria-invalid={promotionError ? true : undefined}
            autoComplete="off"
            className="min-w-0 flex-1 rounded-md border border-gray-200 px-3 py-2 text-sm uppercase placeholder:normal-case focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gray-950"
            id={`${id}-promo`}
            maxLength={40}
            onChange={(event) => onPromotionDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onApplyPromotion();
              }
            }}
            placeholder="Enter promo code"
            value={promotionDraft}
          />
          <button
            className="rounded-md border border-gray-950 px-4 text-sm font-semibold text-gray-950 hover:bg-gray-950 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-950 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400 disabled:hover:bg-transparent"
            disabled={busy || !promotionDraft.trim()}
            onClick={onApplyPromotion}
            type="button"
          >
            Apply
          </button>
        </div>
        <p
          className="mt-2 text-xs leading-5 text-gray-500"
          id={`${id}-promo-help`}
        >
          Codes are validated by the server when you place your order; any
          discount appears on the final order total.
        </p>
        {promotionError && (
          <p className="mt-1 text-xs font-medium text-red-700" role="alert">
            {promotionError}
          </p>
        )}
        {appliedPromotion && (
          <p
            className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-700"
            role="status"
          >
            {appliedPromotion} will be checked at checkout.
            <button
              className="font-semibold underline"
              onClick={onClearPromotion}
              type="button"
            >
              Remove code
            </button>
          </p>
        )}
      </div>

      <div className="mt-5 border-t border-gray-200 pt-5">
        <label
          className="text-sm font-medium text-gray-950"
          htmlFor={`${id}-address`}
        >
          Delivery address
        </label>
        <select
          className="mt-2 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gray-950"
          id={`${id}-address`}
          onChange={(event) => onAddressChange(event.target.value)}
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
        {selectedAddress && (
          <p className="mt-2 text-xs text-gray-500">
            {selectedAddress.street_address}
          </p>
        )}
        {addresses.length === 0 && (
          <p className="mt-2 text-xs text-gray-600">
            <Link className="font-semibold text-gray-950 underline" href="/">
              Add a delivery address from your account
            </Link>
          </p>
        )}
      </div>

      <div className="mt-5 flex items-baseline justify-between gap-4 border-t border-gray-200 pt-5">
        <span className="text-sm font-semibold text-gray-950">
          Estimated total
        </span>
        <span className="text-2xl font-bold tracking-tight text-gray-950">
          NPR {total}
        </span>
      </div>
      {appliedPromotion && (
        <p className="mt-1 text-right text-xs text-gray-500">
          Before promotion discount
        </p>
      )}

      {blockedItem && (
        <p className="mt-4 rounded-md bg-red-50 p-3 text-xs text-red-800">
          Update the quantity of {blockedItem.product_name} to match available
          stock before placing your order.
        </p>
      )}
      <button
        className="mt-5 w-full rounded-md bg-gray-950 px-4 py-3.5 text-sm font-semibold uppercase tracking-wider text-white transition-colors hover:bg-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-950 disabled:cursor-not-allowed disabled:bg-gray-300"
        disabled={busy || disabled || !addressId || !!blockedItem}
        type="submit"
      >
        {busy ? 'Placing order…' : 'Place order'}
      </button>

      <section
        aria-labelledby={`${id}-payment`}
        className="mt-4 rounded-md border border-gray-200 p-3"
      >
        <h3
          className="text-xs font-semibold text-gray-950"
          id={`${id}-payment`}
        >
          Payment: Cash on delivery
        </h3>
        <p className="mt-1 text-xs leading-5 text-gray-500">
          Express wallets and card payments are not available yet. You pay the
          courier when your order arrives.
        </p>
      </section>

      <div className="mt-5 border-t border-gray-200 pt-5">
        <CartPerks />
      </div>
    </form>
  );
}
