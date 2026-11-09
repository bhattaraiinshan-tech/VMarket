'use client';

import Link from 'next/link';
import { browserStorageUrl } from '@/lib/network';
import { useWorkspace, useWorkspaceShops } from '@/lib/workspace-context';
import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useState,
} from 'react';

import {
  Product,
  ProductPage,
  Shop,
  TradePurchaseOrder,
  TradeRFQ,
  TradeStockTransfer,
  TradeSupplier,
  WholesaleListing,
  requestApi,
} from '@/lib/api';

type TradeWorkspaceData = {
  shop: Shop;
  products: Product[];
  listings: WholesaleListing[];
  myListings: WholesaleListing[];
  rfqs: TradeRFQ[];
  orders: TradePurchaseOrder[];
  transfers: TradeStockTransfer[];
  suppliers: TradeSupplier[];
  ownedDestinations: TransferDestination[];
};

type TransferDestination = {
  shop_id: string;
  shop_name: string;
  product_id: string;
  product_name: string;
  category_id: string;
};
const fieldClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950';
const buttonClass =
  'rounded-lg bg-emerald-800 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50';

export default function TradeWorkspace() {
  const { user } = useWorkspace();
  const { shops } = useWorkspaceShops();
  const ownedShopIds = new Set([
    ...(user?.owned_shop_ids ?? []),
    ...shops.map((shop) => shop.id),
  ]);
  const [data, setData] = useState<TradeWorkspaceData | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [listingForm, setListingForm] = useState({
    product_id: '',
    minimum_order_quantity: '10',
    available_quantity: '100',
    unit_label: 'piece',
    price_tiers: [{ minimum_quantity: '10', unit_price: '' }],
  });
  const [documentUrls, setDocumentUrls] = useState<Record<string, string>>({});
  const [quoteForms, setQuoteForms] = useState<
    Record<string, { unit_price: string; delivery_terms: string; note: string }>
  >({});
  const [rfqQuantities, setRfqQuantities] = useState<Record<string, string>>(
    {},
  );
  const [reviewForms, setReviewForms] = useState<
    Record<string, { rating: string; body: string }>
  >({});
  const [transferForm, setTransferForm] = useState({
    source_product_id: '',
    destination_product_id: '',
    quantity: '1',
    delivery_terms: '',
  });

  const loadWorkspace = useCallback(
    async (search: string): Promise<TradeWorkspaceData> => {
      const listingPath = search.trim()
        ? `/trade/listings?q=${encodeURIComponent(search.trim())}`
        : '/trade/listings';
      const [
        shop,
        products,
        listings,
        myListings,
        rfqs,
        orders,
        transfers,
        suppliers,
        ownedDestinations,
      ] = await Promise.all([
        requestApi<Shop>('/vendor/shop'),
        requestApi<ProductPage>('/vendor/products?page=1&page_size=100'),
        requestApi<WholesaleListing[]>(listingPath),
        requestApi<WholesaleListing[]>('/vendor/trade/listings'),
        requestApi<TradeRFQ[]>('/trade/rfqs'),
        requestApi<TradePurchaseOrder[]>('/trade/orders'),
        requestApi<TradeStockTransfer[]>('/trade/transfers'),
        requestApi<TradeSupplier[]>(
          search.trim()
            ? `/trade/suppliers?q=${encodeURIComponent(search.trim())}`
            : '/trade/suppliers',
        ),
        requestApi<TransferDestination[]>(
          '/vendor/trade/transfer-destinations',
        ),
      ]);
      return {
        shop,
        products: products.items,
        listings,
        myListings,
        rfqs,
        orders,
        transfers,
        suppliers,
        ownedDestinations,
      };
    },
    [],
  );

  useEffect(() => {
    let active = true;
    void loadWorkspace('')
      .then((workspace) => {
        if (active) setData(workspace);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'The trade workspace could not be loaded.',
          );
        }
      });
    return () => {
      active = false;
    };
  }, [loadWorkspace]);

  async function perform(action: () => Promise<void>, successMessage: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      setData(await loadWorkspace(query));
      setNotice(successMessage);
    } catch (cause: unknown) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The trade action could not be completed.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function searchListings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      setData(await loadWorkspace(query));
    } catch (cause: unknown) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Wholesale listings could not be searched.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function createListing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await perform(async () => {
      await requestApi<WholesaleListing>('/vendor/trade/listings', {
        method: 'POST',
        body: JSON.stringify({
          product_id: listingForm.product_id,
          minimum_order_quantity: Number(listingForm.minimum_order_quantity),
          available_quantity: Number(listingForm.available_quantity),
          unit_label: listingForm.unit_label,
          price_tiers: listingForm.price_tiers.map((tier) => ({
            minimum_quantity: Number(tier.minimum_quantity),
            unit_price: tier.unit_price,
          })),
        }),
      });
      setListingForm((current) => ({
        ...current,
        price_tiers: current.price_tiers.map((tier) => ({
          ...tier,
          unit_price: '',
        })),
      }));
    }, 'Wholesale listing published.');
  }

  async function deactivateListing(listing: WholesaleListing) {
    await perform(async () => {
      await requestApi(`/vendor/trade/listings/${listing.id}`, {
        method: 'DELETE',
      });
    }, 'Wholesale listing deactivated.');
  }

  async function requestQuote(
    event: FormEvent<HTMLFormElement>,
    listing: WholesaleListing,
  ) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    await perform(async () => {
      await requestApi<TradeRFQ>('/trade/rfqs', {
        method: 'POST',
        body: JSON.stringify({
          listing_id: listing.id,
          quantity: Number(
            rfqQuantities[listing.id] ?? listing.minimum_order_quantity,
          ),
          delivery_terms: String(formData.get('delivery_terms') ?? ''),
          message: String(formData.get('message') ?? ''),
        }),
      });
    }, 'Request for quotation sent to the supplier.');
  }

  async function submitQuote(event: FormEvent<HTMLFormElement>, rfq: TradeRFQ) {
    event.preventDefault();
    const form = quoteForms[rfq.id] ?? {
      unit_price: '',
      delivery_terms: '',
      note: '',
    };
    await perform(async () => {
      await requestApi<TradeRFQ>(`/trade/rfqs/${rfq.id}/quotes`, {
        method: 'POST',
        body: JSON.stringify({
          quantity: rfq.quantity,
          unit_price: form.unit_price,
          delivery_terms: form.delivery_terms,
          note: form.note,
        }),
      });
    }, 'Quote submitted. The buyer can review it in the RFQ history.');
  }

  async function updateOrder(order: TradePurchaseOrder, status: string) {
    await perform(async () => {
      await requestApi<TradePurchaseOrder>(`/trade/orders/${order.id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      });
    }, `Purchase order marked ${status}.`);
  }

  async function updateTransfer(transfer: TradeStockTransfer, status: string) {
    await perform(async () => {
      await requestApi<TradeStockTransfer>(
        `/trade/transfers/${transfer.id}/status`,
        {
          method: 'POST',
          body: JSON.stringify({ status }),
        },
      );
    }, `Stock transfer marked ${status}.`);
  }

  async function createTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const destination = destinations.find(
      (item) => item.product_id === transferForm.destination_product_id,
    );
    if (!destination) {
      setError('Choose a receiving product in an active destination shop.');
      return;
    }
    await perform(async () => {
      await requestApi<TradeStockTransfer>('/trade/transfers', {
        method: 'POST',
        body: JSON.stringify({
          destination_shop_id: destination.shop_id,
          source_product_id: transferForm.source_product_id,
          destination_product_id: destination.product_id,
          quantity: Number(transferForm.quantity),
          delivery_terms: transferForm.delivery_terms,
        }),
      });
      setTransferForm((current) => ({
        ...current,
        quantity: '1',
        delivery_terms: '',
      }));
    }, 'Stock transfer request sent.');
  }

  async function submitReview(
    event: FormEvent<HTMLFormElement>,
    order: TradePurchaseOrder,
  ) {
    event.preventDefault();
    const form = reviewForms[order.id] ?? { rating: '5', body: '' };
    await perform(async () => {
      await requestApi(`/trade/orders/${order.id}/reviews`, {
        method: 'POST',
        body: JSON.stringify({
          rating: Number(form.rating),
          body: form.body,
        }),
      });
    }, 'Supplier review submitted.');
  }

  async function uploadDocument(
    event: ChangeEvent<HTMLInputElement>,
    path: string,
  ) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    const body = new FormData();
    body.append('file', file);
    await perform(async () => {
      await requestApi(path, { method: 'POST', body });
      input.value = '';
    }, 'Trade document uploaded privately.');
  }

  async function openDocument(documentId: string) {
    setError('');
    try {
      const response = await requestApi<{
        url: string;
        expires_in_seconds: number;
      }>(`/trade/documents/${documentId}/url`);
      setDocumentUrls((current) => ({
        ...current,
        [documentId]: browserStorageUrl(response.url),
      }));
    } catch (cause: unknown) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The private trade document could not be opened.',
      );
    }
  }

  if (!data) {
    return (
      <main className="mx-auto min-h-screen max-w-7xl px-5 py-8 sm:px-8">
        <p role={error ? 'alert' : 'status'} className="text-sm text-slate-700">
          {error || 'Loading vendor trade workspace…'}
        </p>
        {error && (
          <button
            className={`${buttonClass} mt-4`}
            onClick={() =>
              void loadWorkspace(query)
                .then(setData)
                .catch((cause: unknown) =>
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : 'The trade workspace could not be loaded.',
                  ),
                )
            }
          >
            Try again
          </button>
        )}
      </main>
    );
  }

  const products = data.products.filter(
    (product) => product.status === 'approved',
  );
  const activeListingProductIds = new Set(
    data.myListings
      .filter((listing) => listing.is_active)
      .map((listing) => listing.product_id),
  );
  const listableProducts = products.filter(
    (product) => !activeListingProductIds.has(product.id),
  );
  const myRfqs = data.rfqs.filter(
    (rfq) =>
      rfq.buyer_shop_id === data.shop.id || rfq.seller_shop_id === data.shop.id,
  );
  const myOrders = data.orders.filter(
    (order) =>
      order.buyer_shop_id === data.shop.id ||
      order.seller_shop_id === data.shop.id,
  );
  const myTransfers = data.transfers.filter(
    (transfer) =>
      transfer.source_shop_id === data.shop.id ||
      transfer.destination_shop_id === data.shop.id,
  );
  const source = products.find(
    (product) => product.id === transferForm.source_product_id,
  );
  const destinations = [
    ...data.ownedDestinations.filter(
      (item) => !source || item.category_id === source.category_id,
    ),
    ...data.listings.filter((listing) => !ownedShopIds.has(listing.shop_id)),
  ].filter(
    (item, index, items) =>
      item.shop_id !== data.shop.id &&
      items.findIndex((other) => other.product_id === item.product_id) ===
        index,
  );

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-5 py-8 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <Link className="text-sm font-bold text-emerald-800" href="/vendor">
            ← Vendor workspace
          </Link>
          <h1 className="mt-2 text-3xl font-bold text-slate-950">
            Wholesale and vendor trade
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Trade as {data.shop.name}; RFQs and transactions stay scoped to your
            shop.
          </p>
        </div>
        <button
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
          disabled={busy}
          onClick={() =>
            void loadWorkspace(query)
              .then(setData)
              .catch((cause: unknown) =>
                setError(
                  cause instanceof Error
                    ? cause.message
                    : 'The trade workspace could not be loaded.',
                ),
              )
          }
          type="button"
        >
          Refresh
        </button>
      </header>
      {error && (
        <p
          className="mt-5 rounded-lg bg-red-50 p-4 text-sm text-red-800"
          role="alert"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          className="mt-5 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-900"
          role="status"
        >
          {notice}
        </p>
      )}

      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <form
          className="space-y-3 rounded-xl border border-slate-200 bg-white p-5"
          onSubmit={(event) => void createListing(event)}
        >
          <h2 className="text-xl font-bold text-slate-950">
            Publish wholesale offer
          </h2>
          <label className="block text-sm font-semibold text-slate-700">
            Approved product
            <select
              className={`${fieldClass} mt-1`}
              onChange={(event) =>
                setListingForm((current) => ({
                  ...current,
                  product_id: event.target.value,
                }))
              }
              required
              value={listingForm.product_id}
            >
              <option value="">Select a product</option>
              {listableProducts.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name} · stock {product.stock}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-semibold text-slate-700">
              Minimum order
              <input
                className={`${fieldClass} mt-1`}
                min="1"
                onChange={(event) =>
                  setListingForm((current) => ({
                    ...current,
                    minimum_order_quantity: event.target.value,
                    price_tiers: current.price_tiers.map((tier, index) =>
                      index === 0
                        ? { ...tier, minimum_quantity: event.target.value }
                        : tier,
                    ),
                  }))
                }
                required
                type="number"
                value={listingForm.minimum_order_quantity}
              />
            </label>
            <label className="text-sm font-semibold text-slate-700">
              Available bulk quantity
              <input
                className={`${fieldClass} mt-1`}
                min="1"
                onChange={(event) =>
                  setListingForm((current) => ({
                    ...current,
                    available_quantity: event.target.value,
                  }))
                }
                required
                type="number"
                value={listingForm.available_quantity}
              />
            </label>
          </div>
          <label className="block text-sm font-semibold text-slate-700">
            Unit label
            <input
              className={`${fieldClass} mt-1`}
              maxLength={40}
              onChange={(event) =>
                setListingForm((current) => ({
                  ...current,
                  unit_label: event.target.value,
                }))
              }
              required
              value={listingForm.unit_label}
            />
          </label>
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-slate-700">
              Quantity-based prices (NPR per unit)
            </legend>
            {listingForm.price_tiers.map((tier, index) => (
              <div
                className="grid grid-cols-[1fr_1fr_auto] items-end gap-2"
                key={index}
              >
                <label className="text-xs font-semibold text-slate-600">
                  From quantity
                  <input
                    className={`${fieldClass} mt-1`}
                    min={listingForm.minimum_order_quantity}
                    onChange={(event) =>
                      setListingForm((current) => ({
                        ...current,
                        price_tiers: current.price_tiers.map(
                          (item, itemIndex) =>
                            itemIndex === index
                              ? {
                                  ...item,
                                  minimum_quantity: event.target.value,
                                }
                              : item,
                        ),
                      }))
                    }
                    required
                    type="number"
                    value={tier.minimum_quantity}
                  />
                </label>
                <label className="text-xs font-semibold text-slate-600">
                  NPR per unit
                  <input
                    className={`${fieldClass} mt-1`}
                    min="0.01"
                    onChange={(event) =>
                      setListingForm((current) => ({
                        ...current,
                        price_tiers: current.price_tiers.map(
                          (item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, unit_price: event.target.value }
                              : item,
                        ),
                      }))
                    }
                    required
                    step="0.01"
                    type="number"
                    value={tier.unit_price}
                  />
                </label>
                {index > 0 && (
                  <button
                    className="pb-2 text-sm font-semibold text-red-700"
                    onClick={() =>
                      setListingForm((current) => ({
                        ...current,
                        price_tiers: current.price_tiers.filter(
                          (_, itemIndex) => itemIndex !== index,
                        ),
                      }))
                    }
                    type="button"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
            <button
              className="text-sm font-semibold text-emerald-800 underline"
              onClick={() =>
                setListingForm((current) => ({
                  ...current,
                  price_tiers: [
                    ...current.price_tiers,
                    {
                      minimum_quantity: current.minimum_order_quantity,
                      unit_price: '',
                    },
                  ],
                }))
              }
              type="button"
            >
              Add quantity price tier
            </button>
          </fieldset>
          <button className={buttonClass} disabled={busy} type="submit">
            Publish offer
          </button>
        </form>

        <form
          className="space-y-3 rounded-xl border border-slate-200 bg-white p-5"
          onSubmit={(event) => void createTransfer(event)}
        >
          <h2 className="text-xl font-bold text-slate-950">
            Request a stock transfer
          </h2>
          <label className="block text-sm font-semibold text-slate-700">
            Your approved product
            <select
              className={`${fieldClass} mt-1`}
              onChange={(event) =>
                setTransferForm((current) => ({
                  ...current,
                  source_product_id: event.target.value,
                  destination_product_id: '',
                }))
              }
              required
              value={transferForm.source_product_id}
            >
              <option value="">Select source stock</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name} · stock {product.stock}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            Destination shop and matching product
            <select
              className={`${fieldClass} mt-1`}
              onChange={(event) =>
                setTransferForm((current) => ({
                  ...current,
                  destination_product_id: event.target.value,
                }))
              }
              required
              value={transferForm.destination_product_id}
            >
              <option value="">Select receiving product</option>
              {destinations.map((listing) => (
                <option key={listing.product_id} value={listing.product_id}>
                  {listing.shop_name} · {listing.product_name}
                  {ownedShopIds.has(listing.shop_id) ? ' (your shop)' : ''}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              aria-label="Transfer quantity"
              className={fieldClass}
              min="1"
              onChange={(event) =>
                setTransferForm((current) => ({
                  ...current,
                  quantity: event.target.value,
                }))
              }
              required
              type="number"
              value={transferForm.quantity}
            />
            <input
              aria-label="Transfer delivery terms"
              className={fieldClass}
              maxLength={1000}
              onChange={(event) =>
                setTransferForm((current) => ({
                  ...current,
                  delivery_terms: event.target.value,
                }))
              }
              placeholder="Delivery terms"
              required
              value={transferForm.delivery_terms}
            />
          </div>
          <button className={buttonClass} disabled={busy} type="submit">
            Request transfer
          </button>
        </form>
      </section>

      <section className="mt-8">
        <h2 className="text-2xl font-bold text-slate-950">
          Your wholesale offers
        </h2>
        {data.myListings.length ? (
          <ul className="mt-4 grid gap-3 md:grid-cols-2">
            {data.myListings.map((listing) => (
              <li
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4"
                key={listing.id}
              >
                <div>
                  <h3 className="font-semibold text-slate-950">
                    {listing.product_name}
                  </h3>
                  <p className="text-sm text-slate-600">
                    MOQ {listing.minimum_order_quantity} {listing.unit_label} ·{' '}
                    {listing.available_quantity} available ·{' '}
                    {listing.price_tiers
                      .map(
                        (tier) =>
                          `NPR ${tier.unit_price} from ${tier.minimum_quantity}`,
                      )
                      .join(' · ')}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-semibold capitalize text-slate-600">
                    {listing.is_active ? 'Active' : 'Inactive'}
                  </span>
                  {listing.is_active && (
                    <button
                      className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 disabled:opacity-50"
                      disabled={busy}
                      onClick={() => void deactivateListing(listing)}
                      type="button"
                    >
                      Deactivate offer
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-slate-600">
            This shop has not published a wholesale offer yet.
          </p>
        )}
      </section>

      <section className="mt-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-slate-950">
              Find suppliers
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Search approved bulk offers and ask the seller for a quote.
            </p>
          </div>
          <form
            className="flex gap-2"
            onSubmit={(event) => void searchListings(event)}
          >
            <input
              aria-label="Search wholesale listings"
              className={fieldClass}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Product or supplier"
              value={query}
            />
            <button className={buttonClass} disabled={busy} type="submit">
              Search
            </button>
          </form>
        </div>
        {data.listings.length ? (
          <ul className="mt-4 grid gap-4 md:grid-cols-2">
            {data.listings.map((listing) => (
              <li
                className="rounded-xl border border-slate-200 bg-white p-5"
                key={listing.id}
              >
                <div className="flex justify-between gap-3">
                  <h3 className="font-bold text-slate-950">
                    {listing.product_name}
                  </h3>
                  <span className="text-sm font-semibold text-emerald-800">
                    MOQ {listing.minimum_order_quantity} {listing.unit_label}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  {listing.shop_name} · {listing.city}, {listing.province}
                </p>
                <p className="mt-2 text-sm text-slate-700">
                  {listing.available_quantity} {listing.unit_label} available
                </p>
                <p className="mt-1 text-sm text-slate-700">
                  {listing.price_tiers
                    .map(
                      (tier) =>
                        `NPR ${tier.unit_price} from ${tier.minimum_quantity} units`,
                    )
                    .join(' · ') || 'Request current pricing'}
                </p>
                {!ownedShopIds.has(listing.shop_id) &&
                listing.shop_id !== data.shop.id ? (
                  <form
                    className="mt-4 grid gap-2"
                    onSubmit={(event) => void requestQuote(event, listing)}
                  >
                    <label className="text-sm font-semibold text-slate-700">
                      Quantity
                      <input
                        className={`${fieldClass} mt-1`}
                        max={listing.available_quantity}
                        min={listing.minimum_order_quantity}
                        onChange={(event) =>
                          setRfqQuantities((current) => ({
                            ...current,
                            [listing.id]: event.target.value,
                          }))
                        }
                        required
                        type="number"
                        value={
                          rfqQuantities[listing.id] ??
                          String(listing.minimum_order_quantity)
                        }
                      />
                    </label>
                    <input
                      className={fieldClass}
                      maxLength={1000}
                      name="delivery_terms"
                      placeholder="Delivery terms"
                      required
                    />
                    <input
                      className={fieldClass}
                      maxLength={4000}
                      name="message"
                      placeholder="Message to supplier"
                      required
                    />
                    <button
                      className={buttonClass}
                      disabled={busy}
                      type="submit"
                    >
                      Request quote
                    </button>
                  </form>
                ) : (
                  <p className="mt-4 text-sm text-slate-600">
                    You cannot purchase from your own shops. Use an explicit
                    stock transfer instead.
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
            No wholesale listings matched the search.
          </p>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-2xl font-bold text-slate-950">Supplier history</h2>
        {data.suppliers.length ? (
          <ul className="mt-4 grid gap-3 md:grid-cols-2">
            {data.suppliers.map((supplier) => (
              <li
                className="rounded-xl border border-slate-200 bg-white p-5"
                key={supplier.shop_id}
              >
                <h3 className="font-bold text-slate-950">
                  {supplier.shop_name}
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  {supplier.city}, {supplier.province} ·{' '}
                  {supplier.active_listing_count} active offers ·{' '}
                  {supplier.completed_trade_count} completed trades
                </p>
                <p className="mt-2 text-sm font-semibold text-amber-700">
                  {supplier.average_rating
                    ? `${supplier.average_rating} / 5 average business rating`
                    : 'No completed-trade reviews yet'}
                </p>
                {supplier.reviews.slice(0, 2).map((review) => (
                  <p className="mt-2 text-sm text-slate-700" key={review.id}>
                    {review.rating} / 5 · {review.body}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-slate-600">
            No suppliers have active wholesale offers yet.
          </p>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-2xl font-bold text-slate-950">
          RFQs and negotiation
        </h2>
        {myRfqs.length ? (
          <ul className="mt-4 space-y-4">
            {myRfqs.map((rfq) => (
              <li
                className="rounded-xl border border-slate-200 bg-white p-5"
                key={rfq.id}
              >
                <div className="flex flex-wrap justify-between gap-2">
                  <h3 className="font-bold text-slate-950">
                    {rfq.product_name} · {rfq.quantity} units
                  </h3>
                  <span className="text-sm font-semibold capitalize text-emerald-800">
                    {rfq.status}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  {rfq.buyer_shop_name} → {rfq.seller_shop_name}
                </p>
                <p className="mt-2 text-sm text-slate-700">{rfq.message}</p>
                <ol className="mt-3 space-y-2 border-l-2 border-slate-200 pl-4">
                  {rfq.negotiation_history.map((event) => (
                    <li className="text-sm text-slate-700" key={event.id}>
                      {event.note}
                    </li>
                  ))}
                </ol>
                {rfq.buyer_shop_id === data.shop.id &&
                  rfq.quotes
                    .filter((quote) => quote.status === 'pending')
                    .map((quote) => (
                      <div
                        className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-emerald-50 p-3"
                        key={quote.id}
                      >
                        <p className="text-sm text-emerald-950">
                          Quote #{quote.revision}: NPR {quote.unit_price} ×{' '}
                          {quote.quantity}
                        </p>
                        <div className="flex gap-2">
                          <button
                            className={buttonClass}
                            disabled={busy}
                            onClick={() =>
                              void perform(async () => {
                                await requestApi(
                                  `/trade/quotes/${quote.id}/accept`,
                                  { method: 'POST' },
                                );
                              }, 'Purchase order created from the accepted quote.')
                            }
                            type="button"
                          >
                            Accept and create purchase order
                          </button>
                          <button
                            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
                            disabled={busy}
                            onClick={() =>
                              void perform(async () => {
                                await requestApi(
                                  `/trade/quotes/${quote.id}/reject`,
                                  { method: 'POST' },
                                );
                              }, 'Quote declined.')
                            }
                            type="button"
                          >
                            Decline quote
                          </button>
                        </div>
                      </div>
                    ))}
                {rfq.buyer_shop_id === data.shop.id &&
                  ['open', 'quoted'].includes(rfq.status) && (
                    <button
                      className="mt-3 rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 disabled:opacity-50"
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          await requestApi(`/trade/rfqs/${rfq.id}/cancel`, {
                            method: 'POST',
                          });
                        }, 'Request for quotation cancelled.')
                      }
                      type="button"
                    >
                      Cancel RFQ
                    </button>
                  )}
                {rfq.seller_shop_id === data.shop.id &&
                  ['open', 'quoted'].includes(rfq.status) && (
                    <button
                      className="mt-3 rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 disabled:opacity-50"
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          await requestApi(`/trade/rfqs/${rfq.id}/decline`, {
                            method: 'POST',
                            body: JSON.stringify({
                              note: 'The supplier declined this request.',
                            }),
                          });
                        }, 'Request for quotation declined.')
                      }
                      type="button"
                    >
                      Decline RFQ
                    </button>
                  )}
                {rfq.seller_shop_id === data.shop.id &&
                  ['open', 'quoted'].includes(rfq.status) && (
                    <form
                      className="mt-4 grid gap-2 sm:grid-cols-3"
                      onSubmit={(event) => void submitQuote(event, rfq)}
                    >
                      {(
                        [
                          ['unit_price', 'NPR per unit'],
                          ['delivery_terms', 'Delivery terms'],
                          ['note', 'Negotiation note'],
                        ] as const
                      ).map(([key, label]) => (
                        <input
                          className={fieldClass}
                          key={key}
                          maxLength={key === 'delivery_terms' ? 1000 : 2000}
                          onChange={(event) =>
                            setQuoteForms((current) => ({
                              ...current,
                              [rfq.id]: {
                                ...(current[rfq.id] ?? {
                                  unit_price: '',
                                  delivery_terms: '',
                                  note: '',
                                }),
                                [key]: event.target.value,
                              },
                            }))
                          }
                          min={key === 'unit_price' ? '0.01' : undefined}
                          placeholder={label}
                          required
                          step={key === 'unit_price' ? '0.01' : undefined}
                          type={key === 'unit_price' ? 'number' : 'text'}
                          value={quoteForms[rfq.id]?.[key] ?? ''}
                        />
                      ))}
                      <button
                        className={buttonClass}
                        disabled={busy}
                        type="submit"
                      >
                        Submit quote
                      </button>
                    </form>
                  )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-slate-600">
            No RFQs for this shop yet.
          </p>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-2xl font-bold text-slate-950">
          Purchase orders and trade history
        </h2>
        {myOrders.length ? (
          <ul className="mt-4 space-y-4">
            {myOrders.map((order) => {
              const isBuyer = order.buyer_shop_id === data.shop.id;
              const nextStatus =
                order.status === 'placed' && !isBuyer
                  ? 'confirmed'
                  : order.status === 'confirmed' && !isBuyer
                    ? 'shipped'
                    : order.status === 'shipped' && isBuyer
                      ? 'received'
                      : null;
              return (
                <li
                  className="rounded-xl border border-slate-200 bg-white p-5"
                  key={order.id}
                >
                  <div className="flex flex-wrap justify-between gap-2">
                    <h3 className="font-bold text-slate-950">
                      {order.order_number} · {order.product_name}
                    </h3>
                    <span className="text-sm font-semibold capitalize text-emerald-800">
                      {order.status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    {order.buyer_shop_name} ↔ {order.seller_shop_name} ·{' '}
                    {order.quantity} units at NPR {order.unit_price} · Total NPR{' '}
                    {order.total}
                  </p>
                  <p className="mt-1 text-sm text-slate-700">
                    {order.delivery_terms}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    {nextStatus && (
                      <button
                        className={buttonClass}
                        disabled={busy}
                        onClick={() => void updateOrder(order, nextStatus)}
                        type="button"
                      >
                        Mark {nextStatus}
                      </button>
                    )}
                    {['placed', 'confirmed'].includes(order.status) && (
                      <button
                        className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 disabled:opacity-50"
                        disabled={busy}
                        onClick={() => void updateOrder(order, 'cancelled')}
                        type="button"
                      >
                        Cancel purchase order
                      </button>
                    )}
                    <label className="min-w-0 max-w-full text-sm font-semibold text-slate-700">
                      Upload trade document
                      <input
                        accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                        className="mt-1 block w-full max-w-xs text-sm"
                        onChange={(event) =>
                          void uploadDocument(
                            event,
                            `/trade/orders/${order.id}/documents`,
                          )
                        }
                        type="file"
                      />
                    </label>
                    {order.documents.map((document) =>
                      documentUrls[document.id] ? (
                        <a
                          className="text-sm font-semibold text-emerald-800 underline"
                          href={documentUrls[document.id]}
                          key={document.id}
                          rel="noopener noreferrer"
                          target="_blank"
                        >
                          Download {document.original_filename}
                        </a>
                      ) : (
                        <button
                          className="text-sm font-semibold text-emerald-800 underline"
                          key={document.id}
                          onClick={() => void openDocument(document.id)}
                          type="button"
                        >
                          Get link for {document.original_filename}
                        </button>
                      ),
                    )}
                  </div>
                  {isBuyer &&
                    order.status === 'received' &&
                    !order.business_review_submitted && (
                      <form
                        className="mt-4 grid gap-2 sm:grid-cols-[8rem_1fr_auto]"
                        onSubmit={(event) => void submitReview(event, order)}
                      >
                        <select
                          aria-label="Supplier rating"
                          className={fieldClass}
                          onChange={(event) =>
                            setReviewForms((current) => ({
                              ...current,
                              [order.id]: {
                                ...(current[order.id] ?? {
                                  rating: '5',
                                  body: '',
                                }),
                                rating: event.target.value,
                              },
                            }))
                          }
                          value={reviewForms[order.id]?.rating ?? '5'}
                        >
                          {[5, 4, 3, 2, 1].map((rating) => (
                            <option key={rating} value={rating}>
                              {rating} / 5
                            </option>
                          ))}
                        </select>
                        <input
                          className={fieldClass}
                          maxLength={3000}
                          onChange={(event) =>
                            setReviewForms((current) => ({
                              ...current,
                              [order.id]: {
                                ...(current[order.id] ?? {
                                  rating: '5',
                                  body: '',
                                }),
                                body: event.target.value,
                              },
                            }))
                          }
                          placeholder="Review your supplier"
                          required
                          value={reviewForms[order.id]?.body ?? ''}
                        />
                        <button
                          className={buttonClass}
                          disabled={busy}
                          type="submit"
                        >
                          Review supplier
                        </button>
                      </form>
                    )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-slate-600">
            No trade purchase orders yet.
          </p>
        )}
      </section>

      <section className="mt-10 pb-10">
        <h2 className="text-2xl font-bold text-slate-950">
          Inter-vendor stock transfers
        </h2>
        {myTransfers.length ? (
          <ul className="mt-4 space-y-3">
            {myTransfers.map((transfer) => {
              const isSource = transfer.source_shop_id === data.shop.id;
              const nextStatus =
                transfer.status === 'requested' && !isSource
                  ? 'approved'
                  : transfer.status === 'approved' && isSource
                    ? 'shipped'
                    : transfer.status === 'shipped' && !isSource
                      ? 'received'
                      : null;
              return (
                <li
                  className="rounded-xl border border-slate-200 bg-white p-5"
                  key={transfer.id}
                >
                  <div className="flex flex-wrap justify-between gap-2">
                    <h3 className="font-bold text-slate-950">
                      {transfer.quantity} × {transfer.source_product_name} →{' '}
                      {transfer.destination_product_name}
                    </h3>
                    <span className="text-sm font-semibold capitalize text-emerald-800">
                      {transfer.status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    {transfer.source_shop_name} →{' '}
                    {transfer.destination_shop_name} · {transfer.delivery_terms}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    {nextStatus && (
                      <button
                        className={buttonClass}
                        disabled={busy}
                        onClick={() =>
                          void updateTransfer(transfer, nextStatus)
                        }
                        type="button"
                      >
                        Mark {nextStatus}
                      </button>
                    )}
                    {isSource &&
                      ['requested', 'approved'].includes(transfer.status) && (
                        <button
                          className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 disabled:opacity-50"
                          disabled={busy}
                          onClick={() =>
                            void updateTransfer(transfer, 'cancelled')
                          }
                          type="button"
                        >
                          Cancel transfer
                        </button>
                      )}
                    <label className="min-w-0 max-w-full text-sm font-semibold text-slate-700">
                      Upload trade document
                      <input
                        accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                        className="mt-1 block w-full max-w-xs text-sm"
                        onChange={(event) =>
                          void uploadDocument(
                            event,
                            `/trade/transfers/${transfer.id}/documents`,
                          )
                        }
                        type="file"
                      />
                    </label>
                    {transfer.documents.map((document) =>
                      documentUrls[document.id] ? (
                        <a
                          className="text-sm font-semibold text-emerald-800 underline"
                          href={documentUrls[document.id]}
                          key={document.id}
                          rel="noopener noreferrer"
                          target="_blank"
                        >
                          Download {document.original_filename}
                        </a>
                      ) : (
                        <button
                          className="text-sm font-semibold text-emerald-800 underline"
                          key={document.id}
                          onClick={() => void openDocument(document.id)}
                          type="button"
                        >
                          Get link for {document.original_filename}
                        </button>
                      ),
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-slate-600">No stock transfers yet.</p>
        )}
      </section>
    </main>
  );
}
