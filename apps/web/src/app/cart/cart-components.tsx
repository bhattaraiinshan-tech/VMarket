'use client';

import Link from 'next/link';
import { KeyboardEvent, useState } from 'react';
import type { Cart, CartItem } from '@/lib/api';
import { browserStorageUrl } from '@/lib/network';
import {
  DELIVERY_FEE_PER_SHOP,
  deliveryByShop,
  maxCartQuantity,
} from './cart-money';
import type { PendingCartAction } from './use-cart';

function Icon({
  path,
  className = 'h-4 w-4',
}: {
  path: string;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <path d={path} />
    </svg>
  );
}

const icons = {
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z',
  cash: 'M3 7h18v10H3zM7 12h.01M17 12h.01M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  returns: 'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  shield: 'M12 3 5 6v5c0 4.5 3 8.5 7 10 4-1.5 7-5.5 7-10V6l-7-3Z',
  truck:
    'M3 6h11v10H3zM14 10h4l3 3v3h-7M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
};

export function CartThumbnail({
  item,
  size = 'md',
}: {
  item: CartItem;
  size?: 'sm' | 'md';
}) {
  const dimensions = size === 'sm' ? 'h-16 w-16' : 'h-20 w-20 sm:h-24 sm:w-24';
  if (!item.image_url) {
    return (
      <div
        aria-hidden="true"
        className={`${dimensions} grid shrink-0 place-items-center rounded-lg border border-gray-200 bg-gray-50 text-lg font-semibold text-gray-400`}
      >
        {item.product_name.charAt(0).toUpperCase()}
      </div>
    );
  }
  return (
    <div
      aria-label={item.image_alt}
      className={`${dimensions} shrink-0 rounded-lg border border-gray-200 bg-gray-50 bg-cover bg-center`}
      role="img"
      style={{
        backgroundImage: `url("${browserStorageUrl(item.image_url)}")`,
      }}
    />
  );
}

export function QuantityStepper({
  item,
  disabled,
  onChange,
}: {
  item: CartItem;
  disabled: boolean;
  onChange: (quantity: number) => void;
}) {
  const [draft, setDraft] = useState(String(item.quantity));
  const max = maxCartQuantity(item);
  const control =
    'grid h-9 w-9 place-items-center text-base text-gray-900 transition-colors hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-gray-950 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-transparent';

  function commit() {
    const value = Number(draft);
    if (draft.trim() === '' || value === item.quantity) {
      setDraft(String(item.quantity));
      return;
    }
    onChange(value);
    setDraft(String(item.quantity));
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    }
    if (event.key === 'Escape') setDraft(String(item.quantity));
  }

  return (
    <div className="inline-flex flex-col gap-1">
      <div
        aria-label={`Quantity for ${item.product_name}`}
        className="inline-flex w-fit items-center rounded-md border border-gray-200 bg-white"
        role="group"
      >
        <button
          aria-label={`Decrease ${item.product_name} quantity`}
          className={`${control} rounded-l-md`}
          disabled={disabled || item.quantity <= 1}
          onClick={() => onChange(item.quantity - 1)}
          type="button"
        >
          −
        </button>
        <input
          aria-label={`${item.product_name} quantity`}
          className="h-9 w-11 border-x border-gray-200 text-center text-sm font-medium text-gray-950 [appearance:textfield] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-gray-950 disabled:bg-gray-50 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          disabled={disabled || max < 1}
          inputMode="numeric"
          max={max}
          min={1}
          onBlur={commit}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          type="number"
          value={draft}
        />
        <button
          aria-label={`Increase ${item.product_name} quantity`}
          className={`${control} rounded-r-md`}
          disabled={disabled || item.quantity >= max}
          onClick={() => onChange(item.quantity + 1)}
          type="button"
        >
          +
        </button>
      </div>
      {max < 1 ? (
        <span className="text-xs font-medium text-red-700">Out of stock</span>
      ) : item.quantity > max ? (
        <span className="text-xs font-medium text-red-700">
          Only {max} available
        </span>
      ) : item.quantity >= max && max <= 5 ? (
        <span className="text-xs text-gray-500">Only {max} available</span>
      ) : null}
    </div>
  );
}

function pendingLabel(pending: PendingCartAction | null, item: CartItem) {
  if (pending?.itemId !== item.id) return '';
  if (pending.action === 'quantity') return 'Updating…';
  if (pending.action === 'remove') return 'Removing…';
  return 'Saving…';
}

export function CartLineItem({
  item,
  pending,
  layout = 'page',
  onQuantity,
  onRemove,
  onSave,
}: {
  item: CartItem;
  pending: PendingCartAction | null;
  layout?: 'page' | 'drawer';
  onQuantity: (quantity: number) => void;
  onRemove: () => void;
  onSave: () => void;
}) {
  const disabled = pending !== null;
  const status = pendingLabel(pending, item);
  const href = `/marketplace/${encodeURIComponent(item.product_slug)}`;
  const actions = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium text-gray-600">
      <button
        className="inline-flex min-h-8 items-center gap-1.5 hover:text-red-700 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        onClick={onRemove}
        type="button"
      >
        <Icon path={icons.trash} />
        Remove<span className="sr-only"> {item.product_name}</span>
      </button>
      <button
        className="inline-flex min-h-8 items-center gap-1.5 hover:text-gray-950 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        onClick={onSave}
        type="button"
      >
        <Icon path={icons.heart} />
        Save for later<span className="sr-only"> {item.product_name}</span>
      </button>
      {status && (
        <span className="text-gray-500" role="status">
          {status}
        </span>
      )}
    </div>
  );
  const details = (
    <div className="min-w-0">
      <Link className="font-semibold text-gray-950 hover:underline" href={href}>
        {item.product_name}
      </Link>
      <dl className="mt-1 space-y-0.5 text-xs text-gray-500">
        {item.variant_name && (
          <div className="flex gap-1">
            <dt>Option:</dt>
            <dd className="text-gray-700">{item.variant_name}</dd>
          </div>
        )}
        <div className="flex gap-1">
          <dt>SKU:</dt>
          <dd className="break-all">{item.sku}</dd>
        </div>
        <div className="flex gap-1">
          <dt>Sold by:</dt>
          <dd>{item.shop_name}</dd>
        </div>
      </dl>
    </div>
  );

  if (layout === 'drawer') {
    return (
      <li className="flex gap-3 border-b border-gray-200 py-4 last:border-b-0">
        <CartThumbnail item={item} size="sm" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start justify-between gap-3">
            {details}
            <p className="shrink-0 text-sm font-semibold text-gray-950">
              NPR {item.line_total}
            </p>
          </div>
          <QuantityStepper
            disabled={disabled}
            item={item}
            key={`${item.id}:${item.quantity}`}
            onChange={onQuantity}
          />
          {actions}
        </div>
      </li>
    );
  }

  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 border-b border-gray-200 py-5 last:border-b-0 md:grid-cols-[minmax(0,1fr)_7rem_9.5rem_7rem] md:items-center">
      <div className="col-span-2 flex gap-4 md:col-span-1">
        <CartThumbnail item={item} />
        <div className="min-w-0 space-y-2">
          {details}
          {actions}
        </div>
      </div>
      <p className="col-start-2 text-sm text-gray-700 md:col-start-auto">
        <span className="text-gray-500 md:sr-only">Price: </span>
        NPR {item.unit_price}
      </p>
      <div className="col-start-2 md:col-start-auto">
        <QuantityStepper
          disabled={disabled}
          item={item}
          key={`${item.id}:${item.quantity}`}
          onChange={onQuantity}
        />
      </div>
      <p className="col-start-2 text-sm font-semibold text-gray-950 md:col-start-auto md:text-right">
        <span className="font-normal text-gray-500 md:sr-only">Total: </span>
        NPR {item.line_total}
      </p>
    </li>
  );
}

export function CartItemsHeader() {
  return (
    <div
      aria-hidden="true"
      className="hidden grid-cols-[minmax(0,1fr)_7rem_9.5rem_7rem] border-b border-gray-200 pb-3 text-xs font-semibold uppercase tracking-wider text-gray-500 md:grid"
    >
      <span>Product</span>
      <span>Price</span>
      <span>Quantity</span>
      <span className="text-right">Total</span>
    </div>
  );
}

export function ShopDeliveryNotice({ cart }: { cart: Cart }) {
  const shops = deliveryByShop(cart);
  return (
    <section
      aria-labelledby="cart-delivery-heading"
      className="rounded-lg border border-gray-200 bg-gray-50 p-4"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-gray-700">
          <Icon path={icons.truck} className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2
            className="text-sm font-semibold text-gray-950"
            id="cart-delivery-heading"
          >
            Delivery is NPR {DELIVERY_FEE_PER_SHOP} per shop
          </h2>
          <p className="mt-1 text-xs leading-5 text-gray-600">
            Your cart ships from {shops.length} shop
            {shops.length === 1 ? '' : 's'}. Adding more items from a shop
            already in your cart does not add another delivery fee.
          </p>
          <ul className="mt-3 flex flex-wrap gap-2" aria-label="Shops in cart">
            {shops.map((shop) => (
              <li
                className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-700"
                key={shop.shopId}
              >
                <span className="font-medium text-gray-950">
                  {shop.shopName}
                </span>{' '}
                · {shop.itemCount} item{shop.itemCount === 1 ? '' : 's'} · NPR{' '}
                {shop.subtotal}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export function CartPerks() {
  const perks = [
    {
      icon: icons.cash,
      title: 'Cash on delivery',
      body: 'Pay when your order arrives.',
    },
    {
      icon: icons.shield,
      title: 'Server-checked totals',
      body: 'Stock and prices are confirmed when you place your order.',
    },
    {
      icon: icons.returns,
      title: 'Returns by policy',
      body: 'Eligible delivered orders can be returned from Order history.',
    },
  ];
  return (
    <ul aria-label="Checkout assurances" className="grid gap-3">
      {perks.map((perk) => (
        <li className="flex gap-3 text-xs text-gray-600" key={perk.title}>
          <span className="mt-0.5 text-gray-900">
            <Icon path={perk.icon} className="h-5 w-5" />
          </span>
          <span>
            <span className="block font-semibold text-gray-950">
              {perk.title}
            </span>
            {perk.body}
          </span>
        </li>
      ))}
    </ul>
  );
}
