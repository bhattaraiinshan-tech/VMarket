'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { type Product, requestApi } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace-context';
import CustomerDashboardShell from '../customer-dashboard-shell';
import { ProductCard } from '../marketplace/catalog-presentation';

export default function WishlistPage() {
  const { user, workspace } = useWorkspace();
  return <WishlistContent key={`${user?.id}:${workspace}`} />;
}

function WishlistContent() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void requestApi<Product[]>('/me/wishlist', { signal: controller.signal })
      .then((items) => {
        if (active) {
          setProducts(items);
          setLoaded(true);
        }
      })
      .catch((cause: unknown) => {
        if (
          active &&
          !(cause instanceof DOMException && cause.name === 'AbortError')
        ) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Your wishlist could not be loaded.',
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
  }, [retry]);

  async function remove(product: Product) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await requestApi(`/me/wishlist/${encodeURIComponent(product.id)}`, {
        method: 'DELETE',
      });
      setProducts((items) => items.filter((item) => item.id !== product.id));
    } catch (cause: unknown) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
        setError(
          cause instanceof Error
            ? cause.message
            : 'The product could not be removed.',
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <CustomerDashboardShell active="/wishlist">
      <header className="mb-7">
        <h1 className="text-3xl font-bold tracking-tight">Wishlist</h1>
        <p className="mt-2 text-sm text-gray-500">
          Your saved products, ready when you are.
        </p>
      </header>
      {error && (
        <p
          role="alert"
          className="mb-5 rounded-lg bg-red-50 p-4 text-sm text-red-800"
        >
          {error}
          {!loaded && (
            <button
              type="button"
              className="ml-3 font-semibold underline"
              onClick={() => {
                setLoading(true);
                setError('');
                setRetry((value) => value + 1);
              }}
            >
              Try again
            </button>
          )}
        </p>
      )}
      {loading ? (
        <p role="status" className="py-12 text-center text-gray-500">
          Loading wishlist...
        </p>
      ) : !loaded ? null : products.length === 0 ? (
        <section className="rounded-xl border border-gray-200 bg-white p-12 text-center">
          <h2 className="font-semibold">Your wishlist is empty</h2>
          <Link
            href="/marketplace"
            className="mt-4 inline-block text-sm font-semibold text-blue-700 underline"
          >
            Browse products
          </Link>
        </section>
      ) : (
        <section
          aria-label="Saved products"
          aria-busy={busy}
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
        >
          {products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              saved
              canWishlist
              onWishlist={() => void remove(product)}
            />
          ))}
        </section>
      )}
    </CustomerDashboardShell>
  );
}
