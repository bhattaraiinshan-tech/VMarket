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
}: {
  product: Product;
  onWishlist: (product: Product) => void;
  saved: boolean;
}) {
  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <Link href={`/marketplace/${product.slug}`} className="block">
        {product.images[0] ? (
          <div
            aria-label={product.images[0].alt_text || product.name}
            className="h-48 bg-cover bg-center bg-slate-100"
            role="img"
            style={{
              backgroundImage: `url("${browserStorageUrl(product.images[0].url)}")`,
            }}
          />
        ) : (
          <div className="flex h-48 items-center justify-center bg-emerald-50 text-4xl text-emerald-800">
            {product.name.slice(0, 1)}
          </div>
        )}
        <div className="p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
            {product.category_name}
            {product.brand_name ? ` · ${product.brand_name}` : ''}
          </p>
          <h2 className="mt-2 line-clamp-2 min-h-12 text-lg font-semibold text-slate-900">
            {product.name}
          </h2>
          <p className="mt-3 text-lg font-bold text-slate-900">
            NPR {product.price}
          </p>
          <p className="mt-1 text-sm text-slate-600">{product.shop_name}</p>
          <p className="mt-2 text-xs text-slate-500">
            {product.available ? 'In stock' : 'Currently unavailable'}
          </p>
        </div>
      </Link>
      <div className="border-t border-slate-100 px-5 py-3">
        <button
          aria-label={`${saved ? 'Remove' : 'Add'} ${product.name} ${saved ? 'from' : 'to'} wishlist`}
          className="text-sm font-semibold text-emerald-800 hover:text-emerald-950"
          onClick={() => onWishlist(product)}
          type="button"
        >
          {saved ? '♥ Saved' : '♡ Add to wishlist'}
        </button>
      </div>
    </article>
  );
}

export default function Marketplace() {
  const { workspace, user } = useWorkspace();
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [products, setProducts] = useState<ProductPage | null>(null);
  const [shops, setShops] = useState<Shop[]>([]);
  const [filters, setFilters] = useState(initialFilters);
  const [draft, setDraft] = useState(initialFilters);
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
    void requestApi<Product[]>('/me/wishlist')
      .then((items) => setSavedIds(new Set(items.map((item) => item.id))))
      .catch((cause: unknown) => {
        if (!(cause instanceof ApiError) || cause.status !== 401) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Wishlist could not be loaded.',
          );
        }
      });
  }, [workspace, user]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setLoading(true);
    setPage(1);
    setFilters({ ...draft });
  }

  async function toggleWishlist(product: Product) {
    const wasSaved = savedIds.has(product.id);
    setError('');
    try {
      await requestApi<void>(`/me/wishlist/${product.id}`, {
        method: wasSaved ? 'DELETE' : 'POST',
      });
      setSavedIds((current) => {
        const updated = new Set(current);
        if (wasSaved) updated.delete(product.id);
        else updated.add(product.id);
        return updated;
      });
    } catch (cause: unknown) {
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
    } catch (cause: unknown) {
      setError(
        cause instanceof Error ? cause.message : 'Shops could not be loaded.',
      );
    }
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl px-5 py-8 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <Link className="text-sm font-bold text-emerald-800" href="/">
            Vendor&apos;s Market
          </Link>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">
            Discover Nepal&apos;s marketplace
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Shop approved local listings and find vendors near you.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-white"
            href="/vendor"
          >
            Vendor workspace
          </Link>
          <Link
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-white"
            href="/cart"
          >
            Cart
          </Link>
          <Link
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-white"
            href="/orders"
          >
            Orders
          </Link>
          <Link
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-white"
            href="/notifications"
          >
            Notifications
          </Link>
        </div>
      </header>

      {error && (
        <p
          className="mt-5 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800"
          role="alert"
        >
          {error}
        </p>
      )}

      <section aria-labelledby="product-heading" className="mt-8">
        <div className="mb-5">
          <p className="text-sm font-semibold text-emerald-800">Marketplace</p>
          <h2
            className="mt-1 text-2xl font-bold text-slate-950"
            id="product-heading"
          >
            Products from trusted shops
          </h2>
        </div>
        <form
          className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-6"
          onSubmit={applyFilters}
        >
          <label className="md:col-span-2">
            <span className="text-xs font-semibold text-slate-700">Search</span>
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
            <span className="text-xs font-semibold text-slate-700">Brand</span>
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
              Sort by
            </span>
            <select
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              onChange={(event) =>
                setDraft({ ...draft, sort: event.target.value })
              }
              value={draft.sort}
            >
              <option value="newest">Newest</option>
              <option value="price_asc">Price: low to high</option>
              <option value="price_desc">Price: high to low</option>
              <option value="name">Name</option>
            </select>
          </label>
          <label>
            <span className="text-xs font-semibold text-slate-700">City</span>
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
            className="rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-900 md:col-span-6"
            type="submit"
          >
            Search products
          </button>
        </form>

        {loading ? (
          <p className="py-12 text-center text-sm text-slate-600" role="status">
            Loading products…
          </p>
        ) : products?.items.length ? (
          <>
            <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {products.items.map((product) => (
                <ProductCard
                  key={product.id}
                  onWishlist={(item) => void toggleWishlist(item)}
                  product={product}
                  saved={savedIds.has(product.id)}
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
        ) : (
          <p className="mt-5 rounded-2xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-600">
            No approved products match these filters yet.
          </p>
        )}
      </section>

      <section
        aria-labelledby="shops-heading"
        className="mt-14 border-t border-slate-200 pt-8"
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
            className="self-end rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-900"
            type="submit"
          >
            Find shops
          </button>
        </form>
        {shops.length > 0 && (
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
