'use client';

import Link from 'next/link';
import { useId, useRef, useState } from 'react';
import type { Product, ProductVariant } from '@/lib/api';
import { browserStorageUrl } from '@/lib/network';
import { useWorkspace } from '@/lib/workspace-context';
import StoreAccountMenu from '../store-account-menu';
import NotificationPopover from '@/components/notifications/notification-popover';

export function ProductHeader({
  cartCount,
  onOpenCart,
}: {
  cartCount: number | null;
  onOpenCart: () => void;
}) {
  const { user, workspace } = useWorkspace();
  const customer = !!user && workspace === 'customer';

  return (
    <header className="border-b border-gray-200 bg-white px-5 sm:px-8">
      <nav
        aria-label="Product navigation"
        className="mx-auto grid min-h-16 max-w-[1440px] grid-cols-[1fr_auto] items-center gap-3 text-xs text-gray-950 sm:grid-cols-[1fr_auto_1fr]"
      >
        <Link className="w-fit py-3 hover:underline" href="/marketplace">
          Store
        </Link>
        <Link
          className="row-start-1 py-3 text-base font-bold tracking-tight sm:col-start-2 sm:text-lg"
          href="/marketplace"
        >
          Vendor&apos;s Market
        </Link>
        <div className="col-span-2 flex items-center justify-end gap-6 pb-3 sm:col-span-1 sm:col-start-3 sm:row-start-1 sm:pb-0">
          <StoreAccountMenu />
          {customer && <NotificationPopover />}
          {customer ? (
            <button
              aria-haspopup="dialog"
              className="py-3 hover:underline"
              onClick={onOpenCart}
              type="button"
            >
              My Bag{cartCount !== null ? ` (${cartCount})` : ''}
            </button>
          ) : (
            <Link className="py-3 hover:underline" href="/">
              My Bag
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}

export function ProductGallery({
  product,
  selectedImageId,
  onSelect,
}: {
  product: Product;
  selectedImageId: string;
  onSelect: (id: string) => void;
}) {
  const selectedImage =
    product.images.find((image) => image.id === selectedImageId) ??
    product.images[0];

  return (
    <section
      aria-label="Product gallery"
      className="flex min-w-0 flex-col lg:col-span-8 lg:grid lg:grid-cols-[4.5rem_minmax(0,1fr)] lg:items-start lg:gap-6"
    >
      {product.images.length > 0 && (
        <div
          aria-label="Product images"
          className="order-2 mt-3 flex gap-3 overflow-x-auto p-1 lg:order-none lg:col-span-1 lg:col-start-1 lg:row-start-1 lg:mt-0 lg:max-h-[780px] lg:flex-col lg:items-center lg:overflow-y-auto"
          role="group"
        >
          {product.images.map((image, index) => (
            <button
              aria-label={`Show image ${index + 1}: ${image.alt_text || product.name}`}
              aria-pressed={image.id === selectedImage?.id}
              className={`h-16 w-16 shrink-0 rounded-sm border bg-[#F9FAFB] bg-contain bg-center bg-no-repeat transition-colors ${image.id === selectedImage?.id ? 'border-gray-900' : 'border-transparent hover:border-gray-400'}`}
              key={image.id}
              onClick={() => onSelect(image.id)}
              style={{
                backgroundImage: `url("${browserStorageUrl(image.url)}")`,
              }}
              type="button"
            />
          ))}
        </div>
      )}
      <div className="order-1 row-start-1 lg:order-none lg:col-span-1 lg:col-start-2">
        {selectedImage ? (
          <div
            aria-label={selectedImage.alt_text || product.name}
            className="relative aspect-[4/5] max-h-[900px] w-full rounded-sm bg-[#F9FAFB]"
            role="img"
          >
            <div
              aria-hidden="true"
              className="absolute inset-[5%] bg-contain bg-center bg-no-repeat"
              style={{
                backgroundImage: `url("${browserStorageUrl(selectedImage.url)}")`,
              }}
            />
          </div>
        ) : (
          <div className="flex aspect-[4/5] items-center justify-center bg-[#F9FAFB] text-sm text-gray-500">
            No product image available
          </div>
        )}
      </div>
    </section>
  );
}

const swatches: Record<string, string> = {
  black: '#111111',
  white: '#ffffff',
  red: '#b91c1c',
  blue: '#1d4ed8',
  green: '#15803d',
  gray: '#6b7280',
  grey: '#6b7280',
  beige: '#e7dccb',
  navy: '#172554',
};

function attributeLabel(key: string) {
  return key.replaceAll('_', ' ');
}

export function ProductOptions({
  variants,
  selectedVariant,
  onSelect,
}: {
  variants: ProductVariant[];
  selectedVariant: ProductVariant | undefined;
  onSelect: (id: string) => void;
}) {
  if (!variants.length) return null;
  const keys = Object.keys(variants[0].attributes);
  const grouped =
    keys.length > 0 &&
    variants.every(
      (variant) =>
        Object.keys(variant.attributes).length === keys.length &&
        keys.every((key) => !!variant.attributes[key]),
    ) &&
    new Set(
      variants.map((variant) =>
        JSON.stringify(keys.map((key) => variant.attributes[key])),
      ),
    ).size === variants.length;

  if (!grouped) {
    return (
      <fieldset>
        <legend className="mb-3 text-xs font-semibold">Select option</legend>
        <div className="flex flex-wrap gap-2">
          {variants.map((variant) => (
            <button
              aria-pressed={variant.id === selectedVariant?.id}
              className={`min-h-11 rounded-sm border px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-40 ${variant.id === selectedVariant?.id ? 'border-gray-950 bg-gray-50' : 'border-gray-200 hover:border-gray-500'}`}
              disabled={variant.stock < 1}
              key={variant.id}
              onClick={() => onSelect(variant.id)}
              type="button"
            >
              {variant.name}
              {variant.stock < 1 ? ' (sold out)' : ''}
            </button>
          ))}
        </div>
      </fieldset>
    );
  }

  return (
    <div className="space-y-6">
      {keys.map((key) => (
        <fieldset key={key}>
          <legend className="mb-3 text-xs font-semibold capitalize">
            Select {attributeLabel(key)}
          </legend>
          <div className="flex flex-wrap gap-2">
            {Array.from(
              new Set(variants.map((variant) => variant.attributes[key])),
            ).map((value) => {
              const candidates = variants.filter(
                (variant) =>
                  variant.attributes[key] === value && variant.stock > 0,
              );
              // Retain other selections when possible, but allow sparse combinations.
              const next = [...candidates].sort((a, b) => {
                const score = (variant: ProductVariant) =>
                  keys.filter(
                    (other) =>
                      other !== key &&
                      variant.attributes[other] ===
                        selectedVariant?.attributes[other],
                  ).length;
                return score(b) - score(a);
              })[0];
              const color =
                /^(color|colour)$/i.test(key) && swatches[value.toLowerCase()];
              return (
                <button
                  aria-pressed={selectedVariant?.attributes[key] === value}
                  className={`flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-sm border px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-40 ${selectedVariant?.attributes[key] === value ? 'border-gray-950 bg-gray-50' : 'border-gray-200 hover:border-gray-500'}`}
                  disabled={!next}
                  key={value}
                  onClick={() => next && onSelect(next.id)}
                  type="button"
                >
                  {color && (
                    <span
                      aria-hidden="true"
                      className="h-3 w-3 rounded-full border border-gray-300"
                      style={{ backgroundColor: color }}
                    />
                  )}
                  {value}
                  {!next ? ' (sold out)' : ''}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

export function ProductInformation({
  product,
  variant,
}: {
  product: Product;
  variant: ProductVariant | undefined;
}) {
  const [activeTab, setActiveTab] = useState(0);
  const id = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const attributes = { ...product.attributes, ...variant?.attributes };
  const specifications = [
    { label: 'Material', keys: ['material'] },
    { label: 'Weight', keys: ['weight'] },
    { label: 'Country of origin', keys: ['country_of_origin', 'origin'] },
    { label: 'Dimensions', keys: ['dimensions'] },
  ];
  const standardKeys = specifications.flatMap((item) => item.keys);

  return (
    <section className="mt-9">
      <div
        aria-label="Product details"
        className="flex border-b border-gray-200"
        role="tablist"
      >
        {['Product information', 'Shipping & returns'].map((label, index) => (
          <button
            aria-controls={`${id}-panel-${index}`}
            aria-selected={activeTab === index}
            className={`min-h-12 flex-1 border-b px-1 pb-3 text-[10px] font-medium uppercase tracking-wide ${activeTab === index ? 'border-gray-950 text-gray-950' : 'border-transparent text-gray-500 hover:text-gray-950'}`}
            id={`${id}-tab-${index}`}
            key={label}
            onClick={() => setActiveTab(index)}
            onKeyDown={(event) => {
              let next: number;
              if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                next = 1 - index;
              } else if (event.key === 'Home') {
                next = 0;
              } else if (event.key === 'End') {
                next = 1;
              } else {
                return;
              }
              event.preventDefault();
              setActiveTab(next);
              tabs.current[next]?.focus();
            }}
            ref={(element) => {
              tabs.current[index] = element;
            }}
            role="tab"
            tabIndex={activeTab === index ? 0 : -1}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
      <div
        aria-labelledby={`${id}-tab-0`}
        className="pt-6"
        hidden={activeTab !== 0}
        id={`${id}-panel-0`}
        role="tabpanel"
        tabIndex={0}
      >
        <dl className="grid grid-cols-2 gap-x-5 gap-y-5 text-xs">
          {specifications.map(({ label, keys }) => (
            <div key={label}>
              <dt className="font-medium text-gray-950">{label}</dt>
              <dd className="mt-1 text-gray-500">
                {keys.map((key) => attributes[key]).find(Boolean) ||
                  'Not provided'}
              </dd>
            </div>
          ))}
          <div>
            <dt className="font-medium text-gray-950">SKU</dt>
            <dd className="mt-1 break-words text-gray-500">
              {variant?.sku ?? product.sku}
            </dd>
          </div>
          {Object.entries(attributes)
            .filter(([key]) => !standardKeys.includes(key))
            .map(([key, value]) => (
              <div key={key}>
                <dt className="font-medium capitalize text-gray-950">
                  {attributeLabel(key)}
                </dt>
                <dd className="mt-1 break-words text-gray-500">{value}</dd>
              </div>
            ))}
        </dl>
      </div>
      <div
        aria-labelledby={`${id}-tab-1`}
        className="space-y-4 pt-6 text-xs leading-6 text-gray-600"
        hidden={activeTab !== 1}
        id={`${id}-panel-1`}
        role="tabpanel"
        tabIndex={0}
      >
        <p>
          Shipping is NPR 100 per shop, calculated at checkout. Payment is cash
          on delivery.
        </p>
        <p>
          Track fulfillment and request eligible returns from your order
          details. Return eligibility is checked against the current platform
          policy.
        </p>
        <Link
          className="inline-block font-medium text-gray-950 underline underline-offset-4"
          href="/orders"
        >
          View your orders
        </Link>
      </div>
    </section>
  );
}
