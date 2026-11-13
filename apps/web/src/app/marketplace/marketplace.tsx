'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';

import {
  ApiError,
  Brand,
  Category,
  Cart,
  Product,
  ProductPage,
  Shop,
  requestApi,
} from '@/lib/api';
import { useWorkspace } from '@/lib/workspace-context';
import { getWorkspaceSnapshot } from '@/lib/workspace-state';
import CatalogFilters, { type Filters } from './catalog-filters';
import {
  CatalogBreadcrumbs,
  CatalogFooter,
  CatalogHeader,
  CatalogHero,
  ProductCard,
} from './catalog-presentation';
import styles from './catalog.module.css';

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

function priceMinorUnits(value: string) {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'));
}

export default function Marketplace({
  initialSearch = '',
  initialCategory = '',
}: {
  initialSearch?: string;
  initialCategory?: string;
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
    category_id: initialCategory,
  });
  const [draft, setDraft] = useState({
    ...initialFilters,
    q: initialSearch,
    category_id: initialCategory,
  });
  const [page, setPage] = useState(1);
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [radius, setRadius] = useState('25');
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [cartCount, setCartCount] = useState<number | null>(null);
  const [cartError, setCartError] = useState('');
  const [catalogError, setCatalogError] = useState('');
  const [productError, setProductError] = useState('');
  const [catalogLoading, setCatalogLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      requestApi<Category[]>('/catalog/categories', {
        signal: controller.signal,
      }),
      requestApi<Brand[]>('/catalog/brands', { signal: controller.signal }),
    ])
      .then(([availableCategories, availableBrands]) => {
        if (controller.signal.aborted) return;
        setCategories(availableCategories);
        setBrands(availableBrands);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setCatalogError(
            cause instanceof Error
              ? cause.message
              : 'Catalogue filters could not be loaded.',
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setCatalogLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
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
    void requestApi<ProductPage>(`/catalog/products?${query.toString()}`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (active) {
          setProducts(result);
          setProductError('');
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setProducts(null);
          setProductError(
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
      controller.abort();
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

  useEffect(() => {
    if (workspace !== 'customer' || !user) return;
    const controller = new AbortController();
    void requestApi<Cart>('/me/cart', { signal: controller.signal })
      .then((cart) => {
        if (!controller.signal.aborted) setCartCount(cart.item_count);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setCartError(
            cause instanceof Error
              ? cause.message
              : 'Cart count could not be loaded.',
          );
      });
    return () => controller.abort();
  }, [workspace, user]);

  function commitFilters(next: Filters) {
    setError('');
    if (
      page === 1 &&
      !productError &&
      Object.keys(next).every(
        (key) => next[key as keyof Filters] === filters[key as keyof Filters],
      )
    )
      return;
    setLoading(true);
    setPage(1);
    setFilters({ ...next });
  }

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (
      [draft.min_price, draft.max_price].some(
        (value) => value && !/^\d{1,10}(?:\.\d{1,2})?$/.test(value),
      )
    ) {
      setError(
        'Enter prices from NPR 0 to NPR 9999999999.99 with at most two decimal places.',
      );
      return;
    }
    if (
      draft.min_price &&
      draft.max_price &&
      priceMinorUnits(draft.min_price) > priceMinorUnits(draft.max_price)
    ) {
      setError('Minimum price cannot exceed maximum price.');
      return;
    }
    commitFilters(draft);
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
    <div className={styles.page}>
      <CatalogHeader
        categories={categories}
        categoryId={filters.category_id}
        search={draft.q}
        onSearchChange={(q) => setDraft((current) => ({ ...current, q }))}
        cartCount={cartCount}
      />
      <main className="marketplace-page">
        <CatalogBreadcrumbs
          categories={categories}
          categoryId={filters.category_id}
        />
        {(error || catalogError || productError || cartError) && (
          <p
            className={`${styles.container} mt-5 rounded-sm bg-red-50 px-4 py-3 text-sm text-red-800`}
            role="alert"
          >
            {[error, catalogError, productError, cartError]
              .filter(Boolean)
              .join(' ')}
          </p>
        )}

        <div className={`${styles.container} ${styles.layout}`}>
          <aside aria-label="Catalog filters">
            {catalogLoading && (
              <p className="mb-3 text-xs text-gray-500" role="status">
                Loading categories and brands…
              </p>
            )}
            <CatalogFilters
              categories={categories}
              brands={brands}
              categoryId={filters.category_id}
              draft={draft}
              onChange={setDraft}
              onSubmit={applyFilters}
              onReset={() => {
                setDraft({ ...initialFilters });
                commitFilters({ ...initialFilters });
              }}
            />
          </aside>
          <section
            aria-labelledby="product-heading"
            className="min-w-0"
            id="catalog-products"
          >
            <h2 className="sr-only" id="product-heading">
              Products
            </h2>
            <CatalogHero />
            <p className="mt-4 text-xs leading-6 text-gray-500">
              Explore products from shops across Nepal. Search by name, narrow
              down your favorites, or discover a shop close to home.
            </p>
            <div className={styles.toolbar}>
              <p aria-live="polite">
                {!loading && products
                  ? products.total === 0
                    ? 'No products'
                    : `Showing ${(products.page - 1) * products.page_size + 1}–${(products.page - 1) * products.page_size + products.items.length} of ${products.total} products`
                  : 'Browse products'}
              </p>
              <label>
                Sort by
                <select
                  aria-label="Sort by"
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
                <div className={styles.productGrid}>
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
          </section>
        </div>

        <section
          aria-labelledby="shops-heading"
          className={`${styles.container} border-t border-gray-200 py-8`}
        >
          <div className="mb-5">
            <p className="text-xs font-medium uppercase tracking-widest text-[#80527f]">
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
            className="grid gap-3 border border-gray-200 bg-white p-4 md:grid-cols-4"
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
              className="self-end bg-[#80527f] px-4 py-2 text-sm font-semibold text-white hover:bg-[#654064] disabled:cursor-not-allowed disabled:opacity-60"
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
      <CatalogFooter categories={categories} />
    </div>
  );
}
