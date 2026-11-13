'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Product } from '@/lib/api';
import { requestApi } from '@/lib/api';
import { browserStorageUrl } from '@/lib/network';

export function SavedForLater({ version }: { version: number }) {
  const [state, setState] = useState<{
    version: number;
    items: Product[];
    error: string;
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void requestApi<Product[]>('/me/wishlist', { signal: controller.signal })
      .then((items) => {
        if (!controller.signal.aborted) setState({ version, items, error: '' });
      })
      .catch((cause: unknown) => {
        if (
          !controller.signal.aborted &&
          !(cause instanceof DOMException && cause.name === 'AbortError')
        )
          setState({
            version,
            items: [],
            error:
              cause instanceof Error
                ? cause.message
                : 'Saved items could not be loaded.',
          });
      });
    return () => controller.abort();
  }, [version]);

  if (!state) return null;
  if (state.error) {
    return (
      <p className="mt-8 text-sm text-gray-600" role="status">
        Saved items could not be loaded: {state.error}
      </p>
    );
  }
  if (!state.items.length) return null;

  return (
    <section aria-labelledby="saved-for-later-heading" className="mt-10">
      <h2
        className="text-base font-semibold text-gray-950"
        id="saved-for-later-heading"
      >
        Saved for later ({state.items.length})
      </h2>
      <p className="mt-1 text-xs text-gray-500">
        Choose an option on the product page to move an item back to your cart.
      </p>
      <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
        {state.items.map((product) => (
          <li key={product.id}>
            <Link
              className="group block rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-950"
              href={`/marketplace/${encodeURIComponent(product.slug)}`}
            >
              {product.images[0] ? (
                <div
                  aria-label={product.images[0].alt_text || product.name}
                  className="aspect-square rounded-lg border border-gray-200 bg-gray-50 bg-cover bg-center"
                  role="img"
                  style={{
                    backgroundImage: `url("${browserStorageUrl(product.images[0].url)}")`,
                  }}
                />
              ) : (
                <div
                  aria-hidden="true"
                  className="grid aspect-square place-items-center rounded-lg border border-gray-200 bg-gray-50 text-2xl font-semibold text-gray-300"
                >
                  {product.name.charAt(0).toUpperCase()}
                </div>
              )}
              <span className="mt-2 block truncate text-sm font-medium text-gray-950 group-hover:underline">
                {product.name}
              </span>
              <span className="block text-xs text-gray-600">
                NPR {product.price}
                {!product.available && ' · Sold out'}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
