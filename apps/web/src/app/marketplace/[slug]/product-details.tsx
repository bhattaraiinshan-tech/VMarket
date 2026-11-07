'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { browserStorageUrl } from '@/lib/network';

import {
  Cart,
  Product,
  ProductPage,
  ProductReview,
  requestApi,
} from '@/lib/api';
import FraudReportForm from '@/app/fraud-report-form';

export default function ProductDetails({ slug }: { slug: string }) {
  const router = useRouter();
  const [product, setProduct] = useState<Product | null>(null);
  const [related, setRelated] = useState<Product[]>([]);
  const [reviews, setReviews] = useState<ProductReview[]>([]);
  const [error, setError] = useState('');
  const [reviewError, setReviewError] = useState('');
  const [reportedReviewIds, setReportedReviewIds] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [selectedVariantId, setSelectedVariantId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [cartMessage, setCartMessage] = useState('');
  const selectedVariant = product?.variants.find(
    (variant) => variant.id === selectedVariantId,
  );

  useEffect(() => {
    let active = true;
    void requestApi<Product>(`/catalog/products/${encodeURIComponent(slug)}`)
      .then(async (result) => {
        if (!active) return;
        setProduct(result);
        setSelectedVariantId(result.variants[0]?.id ?? '');
        const offers = await requestApi<ProductPage>(
          `/catalog/products?category_id=${encodeURIComponent(result.category_id)}&sort=price_asc&page_size=8`,
        );
        if (active) {
          setRelated(
            offers.items.filter((item) => item.id !== result.id).slice(0, 4),
          );
        }
        const productReviews = await requestApi<ProductReview[]>(
          `/catalog/products/${result.id}/reviews`,
        );
        if (active) setReviews(productReviews);
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

  async function addToCart() {
    if (!product) return;
    setError('');
    setCartMessage('');
    try {
      await requestApi<Cart>('/me/cart/items', {
        method: 'POST',
        body: JSON.stringify({
          product_id: product.id,
          variant_id: selectedVariantId || null,
          quantity,
        }),
      });
      setCartMessage(
        `${quantity} item${quantity === 1 ? '' : 's'} added to your cart.`,
      );
    } catch (cause: unknown) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The item could not be added to your cart.',
      );
    }
  }

  async function startConversation() {
    if (!product) return;
    setReviewError('');
    try {
      const conversation = await requestApi<{ id: string }>(
        '/me/conversations',
        {
          method: 'POST',
          body: JSON.stringify({
            shop_id: product.shop_id,
            product_id: product.id,
          }),
        },
      );
      router.push(`/messages/${conversation.id}`);
    } catch (cause: unknown) {
      setReviewError(
        cause instanceof Error
          ? cause.message
          : 'A conversation could not be started.',
      );
    }
  }

  async function reportReview(reviewId: string) {
    setReviewError('');
    try {
      await requestApi<void>(`/me/reviews/${reviewId}/reports`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Inappropriate or misleading content' }),
      });
      setReportedReviewIds((current) => [...current, reviewId]);
    } catch (cause: unknown) {
      setReviewError(
        cause instanceof Error
          ? cause.message
          : 'The review could not be reported.',
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
                style={{
                  backgroundImage: `url("${browserStorageUrl(image.url)}")`,
                }}
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
            NPR {selectedVariant?.price ?? product.price}
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
            {product.variants.length > 0 && (
              <label className="text-sm font-semibold text-slate-800">
                Option
                <select
                  className="ml-2 rounded-lg border border-slate-300 bg-white px-3 py-2"
                  onChange={(event) => setSelectedVariantId(event.target.value)}
                  value={selectedVariantId}
                >
                  {product.variants.map((variant) => (
                    <option
                      disabled={variant.stock < 1}
                      key={variant.id}
                      value={variant.id}
                    >
                      {variant.name} · NPR {variant.price} · {variant.stock}{' '}
                      available
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="text-sm font-semibold text-slate-800">
              Quantity
              <input
                className="ml-2 w-20 rounded-lg border border-slate-300 px-3 py-2"
                max={
                  product.variants.length > 0
                    ? (product.variants.find(
                        (item) => item.id === selectedVariantId,
                      )?.stock ?? 1)
                    : product.stock
                }
                min={1}
                onChange={(event) => setQuantity(Number(event.target.value))}
                type="number"
                value={quantity}
              />
            </label>
            <button
              className="rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={
                !product.available ||
                quantity < 1 ||
                (product.variants.length > 0 &&
                  (product.variants.find(
                    (item) => item.id === selectedVariantId,
                  )?.stock ?? 0) < 1)
              }
              onClick={() => void addToCart()}
              type="button"
            >
              Add to cart
            </button>
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
            <button
              className="rounded-lg border border-emerald-800 px-4 py-2 text-sm font-semibold text-emerald-900"
              onClick={() => void startConversation()}
              type="button"
            >
              Message vendor
            </button>
            <Link
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800"
              href="/cart"
            >
              View cart
            </Link>
          </div>
          {cartMessage && (
            <p className="mt-3 text-sm text-emerald-800" role="status">
              {cartMessage}
            </p>
          )}
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
      <FraudReportForm targetType="product" targetId={product.id} />
      <section
        aria-labelledby="product-reviews-heading"
        className="mt-12 border-t border-slate-200 pt-8"
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2
              className="text-2xl font-bold text-slate-950"
              id="product-reviews-heading"
            >
              Verified-purchase reviews
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Reviews are accepted only for delivered purchases.
            </p>
          </div>
          {reviews.length > 0 && (
            <p className="font-semibold text-slate-800">
              {(
                reviews.reduce((total, review) => total + review.rating, 0) /
                reviews.length
              ).toFixed(1)}{' '}
              / 5 · {reviews.length}{' '}
              {reviews.length === 1 ? 'review' : 'reviews'}
            </p>
          )}
        </div>
        {reviewError && (
          <p
            className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800"
            role="alert"
          >
            {reviewError}
          </p>
        )}
        {reviews.length ? (
          <ul className="mt-5 space-y-3">
            {reviews.map((review) => (
              <li
                className="rounded-xl border border-slate-200 bg-white p-5"
                key={review.id}
              >
                <div className="flex flex-wrap justify-between gap-2">
                  <h3 className="font-semibold text-slate-950">
                    {review.title}
                  </h3>
                  <span
                    aria-label={`${review.rating} out of 5 stars`}
                    className="font-semibold text-amber-700"
                  >
                    {review.rating} / 5
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                  {review.body}
                </p>
                <p className="mt-3 text-xs text-slate-500">
                  {review.customer_name} ·{' '}
                  {new Date(review.created_at).toLocaleDateString()}
                </p>
                {review.vendor_response && (
                  <div className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm">
                    <p className="font-semibold text-emerald-950">
                      Vendor response
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-emerald-900">
                      {review.vendor_response}
                    </p>
                  </div>
                )}
                <button
                  className="mt-3 text-xs font-semibold text-slate-600 underline disabled:no-underline disabled:opacity-60"
                  disabled={reportedReviewIds.includes(review.id)}
                  onClick={() => void reportReview(review.id)}
                  type="button"
                >
                  {reportedReviewIds.includes(review.id)
                    ? 'Reported'
                    : 'Report review'}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-5 rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
            No published reviews yet.
          </p>
        )}
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
