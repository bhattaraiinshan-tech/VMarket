'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Product, ProductPage, Shop, requestApi } from '@/lib/api';

export default function ShopDetails({ slug }: { slug: string }) {
  const [shop, setShop] = useState<Shop | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void requestApi<Shop>(`/shops/${encodeURIComponent(slug)}`)
      .then(async (result) => {
        if (!active) return;
        setShop(result);
        const listing = await requestApi<ProductPage>(
          `/catalog/products?shop_id=${encodeURIComponent(result.id)}&page_size=100`,
        );
        if (active) setProducts(listing.items);
      })
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error ? cause.message : 'Shop could not be loaded.',
        ),
      );
    return () => {
      active = false;
    };
  }, [slug]);

  if (error) {
    return (
      <main className="mx-auto max-w-5xl px-5 py-10">
        <p
          className="rounded-lg bg-red-50 p-4 text-sm text-red-800"
          role="alert"
        >
          {error}
        </p>
      </main>
    );
  }
  if (!shop) {
    return (
      <main className="mx-auto max-w-5xl px-5 py-16 text-center" role="status">
        Loading shop…
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
      <header className="mt-5 rounded-3xl bg-emerald-950 p-8 text-white sm:p-12">
        {shop.logo_url && (
          <div
            aria-label={`${shop.name} logo`}
            className="mb-5 h-20 w-20 rounded-xl bg-cover bg-center bg-white"
            role="img"
            style={{ backgroundImage: `url("${shop.logo_url}")` }}
          />
        )}
        <p className="text-sm font-semibold text-emerald-200">
          {shop.city}, {shop.province}
        </p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">{shop.name}</h1>
        {shop.description && (
          <p className="mt-4 max-w-2xl text-emerald-50">{shop.description}</p>
        )}
        {shop.address && (
          <p className="mt-3 text-sm text-emerald-200">{shop.address}</p>
        )}
      </header>
      <section className="mt-9">
        <h2 className="text-2xl font-bold text-slate-950">Approved listings</h2>
        {products.length ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {products.map((product) => (
              <Link
                className="rounded-2xl border border-slate-200 bg-white p-5 hover:border-emerald-700"
                href={`/marketplace/${product.slug}`}
                key={product.id}
              >
                <p className="text-xs font-semibold uppercase text-emerald-800">
                  {product.category_name}
                </p>
                <h3 className="mt-2 font-semibold text-slate-900">
                  {product.name}
                </h3>
                <p className="mt-3 font-bold text-slate-900">
                  NPR {product.price}
                </p>
              </Link>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-600">
            This shop has no published products yet.
          </p>
        )}
      </section>
    </main>
  );
}
