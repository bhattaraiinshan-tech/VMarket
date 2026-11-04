'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Product, ProductPage, requestApi } from '@/lib/api';

export default function ProductDetails({ slug }: { slug: string }) {
  const [product, setProduct] = useState<Product | null>(null);
  const [related, setRelated] = useState<Product[]>([]);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    void requestApi<Product>(`/catalog/products/${encodeURIComponent(slug)}`)
      .then(async (result) => {
        if (!active) return;
        setProduct(result);
        const offers = await requestApi<ProductPage>(
          `/catalog/products?category_id=${encodeURIComponent(result.category_id)}&sort=price_asc&page_size=8`,
        );
        if (active) {
          setRelated(
            offers.items.filter((item) => item.id !== result.id).slice(0, 4),
          );
        }
      })
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error
            ? cause.message
            : 'Product could not be loaded.',
        ),
      );
    return () => {
      active = false;
    };
  }, [slug]);

  async function toggleWishlist() {
    if (!product) return;
    setError('');
    try {
      await requestApi<void>(`/me/wishlist/${product.id}`, {
        method: saved ? 'DELETE' : 'POST',
      });
      setSaved(!saved);
    } catch (cause: unknown) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Wishlist could not be updated.',
      );
    }
  }

  if (error && !product) {
    return (
      <main className="mx-auto max-w-5xl px-5 py-10">
        <p
          className="rounded-lg bg-red-50 p-4 text-sm text-red-800"
          role="alert"
        >
          {error}
        </p>
        <Link
          className="mt-4 inline-block text-sm font-semibold text-emerald-800"
          href="/marketplace"
        >
          Back to marketplace
        </Link>
      </main>
    );
  }
  if (!product) {
    return (
      <main className="mx-auto max-w-5xl px-5 py-16 text-center" role="status">
        Loading product…
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-5 py-8 sm:px-8">
      <Link
        className="text-sm font-semibold text-emerald-800"
        href="/marketplace"
      >
        ← Marketplace
      </Link>
      {error && (
        <p
          className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800"
          role="alert"
        >
          {error}
        </p>
      )}
      <section className="mt-5 grid gap-8 lg:grid-cols-2">
        <div className="grid gap-3 sm:grid-cols-2">
          {product.images.length ? (
            product.images.map((image) => (
              <div
                aria-label={image.alt_text || product.name}
                className="min-h-72 rounded-2xl bg-cover bg-center bg-slate-100"
                key={image.id}
                role="img"
                style={{ backgroundImage: `url("${image.url}")` }}
              />
            ))
          ) : (
            <div className="flex min-h-72 items-center justify-center rounded-2xl bg-emerald-50 text-6xl text-emerald-800">
              {product.name.slice(0, 1)}
            </div>
          )}
        </div>
        <div className="self-center">
          <p className="text-sm font-semibold text-emerald-800">
            {product.category_name}
            {product.brand_name ? ` · ${product.brand_name}` : ''}
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">
            {product.name}
          </h1>
          <p className="mt-4 text-2xl font-bold text-slate-950">
            NPR {product.price}
          </p>
          <p className="mt-2 text-sm text-slate-600">
            {product.available ? 'In stock' : 'Currently unavailable'}
          </p>
          <p className="mt-6 whitespace-pre-wrap text-slate-700">
            {product.description}
          </p>
          <dl className="mt-6 grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-slate-500">SKU</dt>
              <dd className="font-medium text-slate-900">{product.sku}</dd>
            </div>
            {Object.entries(product.attributes).map(([key, value]) => (
              <div key={key}>
                <dt className="capitalize text-slate-500">
                  {key.replaceAll('_', ' ')}
                </dt>
                <dd className="font-medium text-slate-900">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              className="rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-900"
              onClick={() => void toggleWishlist()}
              type="button"
            >
              {saved ? '♥ Saved to wishlist' : '♡ Add to wishlist'}
            </button>
            <Link
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800"
              href={`/shops/${product.shop_slug}`}
            >
              Visit {product.shop_name}
            </Link>
          </div>
          {product.variants.length > 0 && (
            <section className="mt-8 border-t border-slate-200 pt-5">
              <h2 className="font-semibold text-slate-900">
                Available variants
              </h2>
              <ul className="mt-3 space-y-2">
                {product.variants.map((variant) => (
                  <li
                    className="flex items-center justify-between rounded-lg bg-slate-50 p-3 text-sm"
                    key={variant.id}
                  >
                    <span>
                      {variant.name}
                      <span className="ml-2 text-slate-500">
                        SKU {variant.sku}
                      </span>
                    </span>
                    <span className="font-semibold">
                      NPR {variant.price} · {variant.stock} available
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </section>
      {related.length > 0 && (
        <section className="mt-14 border-t border-slate-200 pt-8">
          <h2 className="text-2xl font-bold text-slate-950">
            More offers in this category
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {related.map((item) => (
              <Link
                className="rounded-xl border border-slate-200 bg-white p-4 hover:border-emerald-700"
                href={`/marketplace/${item.slug}`}
                key={item.id}
              >
                <p className="font-semibold text-slate-900">{item.name}</p>
                <p className="mt-2 font-bold text-slate-900">
                  NPR {item.price}
                </p>
                <p className="mt-1 text-sm text-slate-600">{item.shop_name}</p>
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
