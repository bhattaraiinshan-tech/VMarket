'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';

import {
  ApiError,
  Brand,
  Category,
  Product,
  ProductPage,
  Shop,
  requestApi,
} from '@/lib/api';
import { useWorkspace } from '@/lib/workspace-context';
import { browserStorageUrl } from '@/lib/network';
import { getWorkspaceSnapshot } from '@/lib/workspace-state';

type Filters = {
  q: string;
  category_id: string;
  brand_id: string;
  city: string;
  province: string;
  min_price: string;
  max_price: string;
  in_stock: boolean;
  sort: string;
};

const initialFilters: Filters = {
  q: '',
  category_id: '',
  brand_id: '',
  city: '',
  province: '',
  min_price: '',
  max_price: '',
  in_stock: false,
  sort: 'newest',
};

function ProductCard({
  product,
  onWishlist,
  saved,
  canWishlist,
}: {
  product: Product;
  onWishlist: (product: Product) => void;
  saved: boolean;
  canWishlist: boolean;
}) {
  return (
    <article className="group flex h-full min-w-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white transition-shadow hover:shadow-md">
      <Link href={`/marketplace/${product.slug}`} className="block">
        {product.images[0] ? (
          <div
            aria-label={product.images[0].alt_text || product.name}
            className="aspect-[1.15] bg-slate-100 bg-contain bg-center bg-no-repeat"
            role="img"
            style={{
              backgroundImage: `url("${browserStorageUrl(product.images[0].url)}")`,
            }}
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex aspect-[1.15] items-center justify-center bg-slate-100 text-5xl font-semibold text-slate-500"
          >
            {product.name.slice(0, 1)}
          </div>
        )}
        <div className="px-3 pt-3">
          <h3 className="line-clamp-2 text-sm font-semibold text-slate-950">
            {product.name}
          </h3>
          <p className="mt-2 text-sm font-semibold text-slate-950">
            NPR {product.price}
          </p>
          <p className="mt-2 text-xs text-slate-600">
            {product.category_name}
            {product.brand_name ? ` · ${product.brand_name}` : ''}
          </p>
          <p className="mt-2 text-xs text-slate-600">{product.shop_name}</p>
          <p className="mt-1 text-xs text-slate-600">
            {product.available ? 'In stock' : 'Currently unavailable'}
          </p>
        </div>
      </Link>
      <div className="mt-auto px-3 py-3">
        {canWishlist ? (
          <button
            aria-label={`${saved ? 'Saved' : 'Add to wishlist'}: ${product.name}`}
            aria-pressed={saved}
            className="text-xs font-semibold text-emerald-800 hover:text-emerald-950"
            onClick={() => onWishlist(product)}
            type="button"
          >
            {saved ? '♥ Saved' : '♡ Add to wishlist'}
          </button>
        ) : (
          <p className="text-sm text-slate-600">
            Wishlist requires Customer workspace.
          </p>
        )}
      </div>
    </article>
  );
}

export default function Marketplace({
  initialSearch = '',
}: {
  initialSearch?: string;
}) {
  const { workspace, user } = useWorkspace();
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [products, setProducts] = useState<ProductPage | null>(null);
  const [shops, setShops] = useState<Shop[]>([]);
  const [shopSearchState, setShopSearchState] = useState<
    'idle' | 'loading' | 'success' | 'error'
  >('idle');
  const [filters, setFilters] = useState({
    ...initialFilters,
    q: initialSearch,
  });
  const [draft, setDraft] = useState({ ...initialFilters, q: initialSearch });
  const [page, setPage] = useState(1);
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [radius, setRadius] = useState('25');
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void Promise.all([
      requestApi<Category[]>('/catalog/categories'),
      requestApi<Brand[]>('/catalog/brands'),
    ])
      .then(([availableCategories, availableBrands]) => {
        setCategories(availableCategories);
        setBrands(availableBrands);
      })
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error
            ? cause.message
            : 'Catalogue filters could not be loaded.',
        ),
      );
  }, []);

  useEffect(() => {
    let active = true;
    const query = new URLSearchParams({
      page: String(page),
      page_size: '24',
      sort: filters.sort,
    });
    if (filters.q.trim()) query.set('q', filters.q.trim());
    if (filters.category_id) query.set('category_id', filters.category_id);
    if (filters.brand_id) query.set('brand_id', filters.brand_id);
    if (filters.city.trim()) query.set('city', filters.city.trim());
    if (filters.province.trim()) query.set('province', filters.province.trim());
    if (filters.min_price) query.set('min_price', filters.min_price);
    if (filters.max_price) query.set('max_price', filters.max_price);
    if (filters.in_stock) query.set('in_stock', 'true');
    void requestApi<ProductPage>(`/catalog/products?${query.toString()}`)
      .then((result) => {
        if (active) setProducts(result);
      })
      .catch((cause: unknown) => {
        if (active) {
          setProducts(null);
          setError(
            cause instanceof Error
              ? cause.message
              : 'Products could not be loaded.',
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [filters, page]);

  useEffect(() => {
    if (workspace !== 'customer' || !user) return;
    let active = true;
    void requestApi<Product[]>('/me/wishlist')
      .then((items) => {
        if (active) setSavedIds(new Set(items.map((item) => item.id)));
      })
      .catch((cause: unknown) => {
        if (
          active &&
          !(cause instanceof DOMException && cause.name === 'AbortError') &&
          (!(cause instanceof ApiError) || cause.status !== 401)
        ) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Wishlist could not be loaded.',
          );
        }
      });
    return () => {
      active = false;
    };
  }, [workspace, user]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (
      page === 1 &&
      Object.keys(draft).every(
        (key) => draft[key as keyof Filters] === filters[key as keyof Filters],
      )
    )
      return;
    setLoading(true);
    setPage(1);
    setFilters({ ...draft });
  }

  async function toggleWishlist(product: Product) {
    const revision = getWorkspaceSnapshot().revision;
    const wasSaved = savedIds.has(product.id);
    setError('');
    try {
      await requestApi<void>(`/me/wishlist/${product.id}`, {
        method: wasSaved ? 'DELETE' : 'POST',
      });
      if (revision !== getWorkspaceSnapshot().revision) return;
      setSavedIds((current) => {
        const updated = new Set(current);
        if (wasSaved) updated.delete(product.id);
        else updated.add(product.id);
        return updated;
      });
    } catch (cause: unknown) {
      if (
        revision !== getWorkspaceSnapshot().revision ||
        (cause instanceof DOMException && cause.name === 'AbortError')
      )
        return;
      setError(
        cause instanceof Error
          ? cause.message
          : 'Wishlist could not be updated.',
      );
    }
  }

  async function findShops(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setShopSearchState('loading');
    const query = new URLSearchParams({ page_size: '12' });
    if (latitude && longitude) {
      query.set('latitude', latitude);
      query.set('longitude', longitude);
      query.set('radius_km', radius);
    }
    if (draft.city.trim()) query.set('city', draft.city.trim());
    if (draft.province.trim()) query.set('province', draft.province.trim());
    try {
      setShops(await requestApi<Shop[]>(`/shops?${query.toString()}`));
      setShopSearchState('success');
    } catch (cause: unknown) {
      setShopSearchState('error');
      setError(
        cause instanceof Error ? cause.message : 'Shops could not be loaded.',
      );
    }
  }

  return (
    <main className="marketplace-page min-h-screen w-full bg-white text-slate-950">
      <header className="flex flex-wrap items-center justify-between gap-4 border-slate-200 px-5 py-4 sm:px-8">
        <div>
          <Link
            className="text-xs font-semibold text-slate-600 underline-offset-4 hover:underline"
            href="/"
          >
            Vendor&apos;s Market
          </Link>
          <h1 className="mt-1 text-xl font-bold tracking-tight">Products</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {workspace === 'vendor' && user && (
            <Link
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50"
              href="/vendor"
            >
              Vendor workspace
            </Link>
          )}
          {workspace === 'customer' && user && (
            <>
              <Link
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50"
                href="/cart"
              >
                Cart
              </Link>
              <Link
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50"
                href="/orders"
              >
                Orders
              </Link>
            </>
          )}
          {workspace && user && (
            <Link
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50"
              href="/notifications"
            >
              Notifications
            </Link>
          )}
        </div>
      </header>

      {error && (
        <p
          className="mx-5 mt-5 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800"
          role="alert"
        >
          {error}
        </p>
      )}

      <div className="flex min-w-0 border-t border-slate-200">
        <section
          aria-labelledby="product-heading"
          className="min-w-0 flex-1 lg:flex"
        >
          <h2 className="sr-only" id="product-heading">
            Products from trusted shops
          </h2>
          <details
            open
            className="marketplace-filters shrink-0 border-b border-slate-200 lg:border-b-0 lg:border-r lg:open:w-56"
          >
            <summary className="cursor-pointer px-5 py-4 text-sm font-semibold">
              Filters
            </summary>
            <form
              id="marketplace-filters"
              className="grid gap-4 px-5 pb-5 sm:grid-cols-2 lg:grid-cols-1"
              onSubmit={applyFilters}
            >
              <label>
                <span className="text-xs font-semibold text-slate-700">
                  Search
                </span>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  onChange={(event) =>
                    setDraft({ ...draft, q: event.target.value })
                  }
                  placeholder="Products, descriptions, or SKU"
                  value={draft.q}
                />
              </label>
              <label>
                <span className="text-xs font-semibold text-slate-700">
                  Category
                </span>
                <select
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  onChange={(event) =>
                    setDraft({ ...draft, category_id: event.target.value })
                  }
                  value={draft.category_id}
                >
                  <option value="">All categories</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="text-xs font-semibold text-slate-700">
                  Brand
                </span>
                <select
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  onChange={(event) =>
                    setDraft({ ...draft, brand_id: event.target.value })
                  }
                  value={draft.brand_id}
                >
                  <option value="">All brands</option>
                  {brands.map((brand) => (
                    <option key={brand.id} value={brand.id}>
                      {brand.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="text-xs font-semibold text-slate-700">
                  City
                </span>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  onChange={(event) =>
                    setDraft({ ...draft, city: event.target.value })
                  }
                  placeholder="Kathmandu"
                  value={draft.city}
                />
              </label>
              <label>
                <span className="text-xs font-semibold text-slate-700">
                  Province
                </span>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  onChange={(event) =>
                    setDraft({ ...draft, province: event.target.value })
                  }
                  placeholder="Bagmati"
                  value={draft.province}
                />
              </label>
              <label>
                <span className="text-xs font-semibold text-slate-700">
                  Minimum price (NPR)
                </span>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  min="0.01"
                  onChange={(event) =>
                    setDraft({ ...draft, min_price: event.target.value })
                  }
                  step="0.01"
                  type="number"
                  value={draft.min_price}
                />
              </label>
              <label>
                <span className="text-xs font-semibold text-slate-700">
                  Maximum price (NPR)
                </span>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  min="0.01"
                  onChange={(event) =>
                    setDraft({ ...draft, max_price: event.target.value })
                  }
                  step="0.01"
                  type="number"
                  value={draft.max_price}
                />
              </label>
              <label className="flex items-center gap-2 self-end pb-2 text-sm font-semibold text-slate-700">
                <input
                  checked={draft.in_stock}
                  onChange={(event) =>
                    setDraft({ ...draft, in_stock: event.target.checked })
                  }
                  type="checkbox"
                />
                In stock only
              </label>
              <button
                className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
                type="submit"
              >
                Search products
              </button>
            </form>
          </details>
          <div className="min-w-0 flex-1 px-5 pb-8">
            <div className="flex flex-wrap items-center justify-between gap-3 py-4">
              <p className="text-sm text-slate-600" aria-live="polite">
                {!loading && products
                  ? products.total === 0
                    ? 'No products'
                    : `Showing ${(products.page - 1) * products.page_size + 1}–${(products.page - 1) * products.page_size + products.items.length} of ${products.total} products`
                  : 'Browse products'}
              </p>
              <label className="text-sm text-slate-700">
                Sort by
                <select
                  form="marketplace-filters"
                  className="ml-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  value={draft.sort}
                  onChange={(event) => {
                    const sort = event.target.value;
                    setDraft((current) => ({ ...current, sort }));
                    if (sort !== filters.sort || page !== 1) {
                      setError('');
                      setLoading(true);
                      setPage(1);
                      setFilters((current) => ({ ...current, sort }));
                    }
                  }}
                >
                  <option value="newest">Newest</option>
                  <option value="price_asc">Price: low to high</option>
                  <option value="price_desc">Price: high to low</option>
                  <option value="name">Name</option>
                </select>
              </label>
            </div>
            {loading ? (
              <p
                className="py-12 text-center text-sm text-slate-600"
                role="status"
              >
                Loading products…
              </p>
            ) : products?.items.length ? (
              <>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
                  {products.items.map((product) => (
                    <ProductCard
                      key={product.id}
                      onWishlist={(item) => void toggleWishlist(item)}
                      product={product}
                      saved={savedIds.has(product.id)}
                      canWishlist={workspace === 'customer' && !!user}
                    />
                  ))}
                </div>
                <div className="mt-6 flex items-center justify-between">
                  <p className="text-sm text-slate-600">
                    {products.total} listing{products.total === 1 ? '' : 's'}
                  </p>
                  <div className="flex gap-2">
                    <button
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-40"
                      disabled={page <= 1}
                      onClick={() => {
                        setLoading(true);
                        setPage((current) => current - 1);
                      }}
                      type="button"
                    >
                      Previous
                    </button>
                    <button
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-40"
                      disabled={page * products.page_size >= products.total}
                      onClick={() => {
                        setLoading(true);
                        setPage((current) => current + 1);
                      }}
                      type="button"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </>
            ) : products ? (
              <div className="mt-5 rounded-2xl border border-dashed border-emerald-200 bg-white p-10 text-center">
                <p className="font-semibold text-slate-900">
                  No products found
                </p>
                <p className="mt-2 text-sm text-slate-600">
                  No approved products match these filters yet. Try a different
                  search or broaden your filters.
                </p>
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <section
        aria-labelledby="shops-heading"
        className="mx-auto max-w-7xl border-t border-slate-200 px-5 py-8 sm:px-8"
      >
        <div className="mb-5">
          <p className="text-sm font-semibold text-emerald-800">
            Local discovery
          </p>
          <h2
            className="mt-1 text-2xl font-bold text-slate-950"
            id="shops-heading"
          >
            Find shops near you
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Search by city or province above, or enter coordinates to search
            within a radius.
          </p>
        </div>
        <form
          className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-4"
          onSubmit={(event) => void findShops(event)}
        >
          <label>
            <span className="text-xs font-semibold text-slate-700">
              Latitude
            </span>
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              inputMode="decimal"
              onChange={(event) => setLatitude(event.target.value)}
              placeholder="27.7172"
              value={latitude}
            />
          </label>
          <label>
            <span className="text-xs font-semibold text-slate-700">
              Longitude
            </span>
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              inputMode="decimal"
              onChange={(event) => setLongitude(event.target.value)}
              placeholder="85.3240"
              value={longitude}
            />
          </label>
          <label>
            <span className="text-xs font-semibold text-slate-700">
              Radius (km)
            </span>
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              max="500"
              min="1"
              onChange={(event) => setRadius(event.target.value)}
              type="number"
              value={radius}
            />
          </label>
          <button
            className="self-end rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={shopSearchState === 'loading'}
            type="submit"
          >
            {shopSearchState === 'loading' ? 'Finding shops…' : 'Find shops'}
          </button>
        </form>
        {shopSearchState === 'loading' && (
          <p className="mt-5 text-sm text-slate-600" role="status">
            Looking for shops…
          </p>
        )}
        {shopSearchState === 'success' && shops.length === 0 && (
          <p
            className="mt-5 rounded-2xl border border-dashed border-emerald-200 bg-white p-6 text-sm text-slate-600"
            role="status"
          >
            No shops found. Try a different location or a larger radius.
          </p>
        )}
        {shopSearchState === 'success' && shops.length > 0 && (
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shops.map((shop) => (
              <Link
                className="rounded-2xl border border-slate-200 bg-white p-5 hover:border-emerald-700"
                href={`/shops/${shop.slug}`}
                key={shop.id}
              >
                <h3 className="font-semibold text-slate-900">{shop.name}</h3>
                <p className="mt-1 text-sm text-slate-600">
                  {shop.city}, {shop.province}
                </p>
                {shop.distance_km !== null && (
                  <p className="mt-2 text-xs text-emerald-800">
                    {shop.distance_km} km away
                  </p>
                )}
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
