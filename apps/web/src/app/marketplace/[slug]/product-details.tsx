'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { browserStorageUrl } from '@/lib/network';

import {
  Cart,
  Product,
  ProductPage,
  ProductReview,
  requestApi,
} from '@/lib/api';
import FraudReportForm from '@/app/fraud-report-form';
import CartDrawer from '@/app/cart/cart-drawer';
import { useWorkspace } from '@/lib/workspace-context';
import {
  ProductGallery,
  ProductHeader,
  ProductInformation,
  ProductOptions,
} from './product-presentation';

export default function ProductDetails({ slug }: { slug: string }) {
  const { user, workspace } = useWorkspace();
  const router = useRouter();
  const [product, setProduct] = useState<Product | null>(null);
  const [related, setRelated] = useState<Product[]>([]);
  const [reviews, setReviews] = useState<ProductReview[]>([]);
  const [error, setError] = useState('');
  const [reviewError, setReviewError] = useState('');
  const [reportedReviewIds, setReportedReviewIds] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [selectedVariantId, setSelectedVariantId] = useState('');
  const [selectedImageId, setSelectedImageId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [cartMessage, setCartMessage] = useState('');
  const [cartCount, setCartCount] = useState<number | null>(null);
  const [cartError, setCartError] = useState('');
  const [addingToCart, setAddingToCart] = useState(false);
  const cartRevision = useRef(0);
  const [cartOpen, setCartOpen] = useState(false);
  const [drawerCart, setDrawerCart] = useState<Cart | undefined>();
  const openCart = useCallback(() => {
    setDrawerCart(undefined);
    setCartOpen(true);
  }, []);
  const closeCart = useCallback(() => setCartOpen(false), []);
  const updateCartCount = useCallback((cart: Cart) => {
    cartRevision.current += 1;
    setCartCount(cart.item_count);
    setCartError('');
  }, []);
  const cartDrawer = cartOpen ? (
    <CartDrawer
      initialCart={drawerCart}
      onCartChange={updateCartCount}
      onClose={closeCart}
    />
  ) : null;
  const selectedVariant = product?.variants.find(
    (variant) => variant.id === selectedVariantId,
  );
  const availableStock = product
    ? product.variants.length > 0
      ? (selectedVariant?.stock ?? 0)
      : product.stock
    : 0;
  const isCustomer = workspace === 'customer' && !!user;
  const ownShop =
    !!product && !!user?.owned_shop_ids?.includes(product.shop_id);

  useEffect(() => {
    let active = true;
    void requestApi<Product>(`/catalog/products/${encodeURIComponent(slug)}`)
      .then(async (result) => {
        if (!active) return;
        setProduct(result);
        setSelectedVariantId(
          (
            result.variants.find((variant) => variant.stock > 0) ??
            result.variants[0]
          )?.id ?? '',
        );
        setSelectedImageId(result.images[0]?.id ?? '');
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
      .catch((cause: unknown) => {
        if (
          active &&
          !(cause instanceof DOMException && cause.name === 'AbortError')
        )
          setError(
            cause instanceof Error
              ? cause.message
              : 'Product could not be loaded.',
          );
      });
    return () => {
      active = false;
    };
  }, [slug]);

  useEffect(() => {
    if (!isCustomer || !product) return;
    const controller = new AbortController();
    void requestApi<Product[]>('/me/wishlist', { signal: controller.signal })
      .then((items) => {
        if (!controller.signal.aborted)
          setSaved(items.some((item) => item.id === product.id));
      })
      .catch((cause: unknown) => {
        if (
          !controller.signal.aborted &&
          !(cause instanceof DOMException && cause.name === 'AbortError')
        )
          setError(
            cause instanceof Error
              ? cause.message
              : 'Wishlist could not be loaded.',
          );
      });
    return () => controller.abort();
  }, [isCustomer, product]);

  useEffect(() => {
    if (!isCustomer) return;
    const controller = new AbortController();
    const revision = cartRevision.current;
    void requestApi<Cart>('/me/cart', { signal: controller.signal })
      .then((cart) => {
        if (!controller.signal.aborted && revision === cartRevision.current)
          setCartCount(cart.item_count);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted && revision === cartRevision.current)
          setCartError(
            cause instanceof Error
              ? cause.message
              : 'Bag count could not be loaded.',
          );
      });
    return () => controller.abort();
  }, [isCustomer]);

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
    if (!product || addingToCart || !isCustomer || ownShop) return;
    setError('');
    setCartMessage('');
    setAddingToCart(true);
    try {
      const cart = await requestApi<Cart>('/me/cart/items', {
        method: 'POST',
        body: JSON.stringify({
          product_id: product.id,
          variant_id: selectedVariantId || null,
          quantity,
        }),
      });
      cartRevision.current += 1;
      setCartCount(cart.item_count);
      setCartError('');
      setCartMessage(
        `${quantity} item${quantity === 1 ? '' : 's'} added to your cart.`,
      );
      setDrawerCart(cart);
      setCartOpen(true);
    } catch (cause: unknown) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The item could not be added to your cart.',
      );
    } finally {
      setAddingToCart(false);
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
      <div className="min-h-screen bg-white">
        <ProductHeader cartCount={cartCount} onOpenCart={openCart} />
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
        {cartDrawer}
      </div>
    );
  }
  if (!product) {
    return (
      <div className="min-h-screen bg-white">
        <ProductHeader cartCount={cartCount} onOpenCart={openCart} />
        <main
          className="mx-auto max-w-5xl px-5 py-16 text-center"
          role="status"
        >
          Loading product…
        </main>
        {cartDrawer}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-gray-950">
      <ProductHeader cartCount={cartCount} onOpenCart={openCart} />
      <main className="mx-auto max-w-[1440px] px-5 py-6 sm:px-8 lg:py-10">
        {error && (
          <p
            className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800"
            role="alert"
          >
            {error}
          </p>
        )}
        {cartError && (
          <p className="mb-4 text-sm text-red-800" role="alert">
            {cartError}
          </p>
        )}
        <div className="grid items-start gap-8 lg:grid-cols-12 lg:gap-10">
          <ProductGallery
            product={product}
            selectedImageId={selectedImageId}
            onSelect={setSelectedImageId}
          />
          <section
            aria-label="Product purchase options"
            className="min-w-0 lg:col-span-4 lg:pr-4"
          >
            <h1 className="text-2xl font-semibold tracking-tight text-gray-950">
              {product.name}
            </h1>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-gray-600">
              {product.description}
            </p>
            <div className="mt-8">
              <ProductOptions
                variants={product.variants}
                selectedVariant={selectedVariant}
                onSelect={(id) => {
                  setSelectedVariantId(id);
                  setQuantity(1);
                  setCartMessage('');
                }}
              />
            </div>
            <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
              <p className="text-2xl font-semibold">
                NPR {selectedVariant?.price ?? product.price}
              </p>
              <label className="flex items-center gap-3 text-xs text-gray-600">
                Quantity
                <input
                  className="w-16 rounded-sm border border-gray-200 px-2 py-2 text-gray-950"
                  max={availableStock}
                  min={1}
                  onChange={(event) => setQuantity(Number(event.target.value))}
                  type="number"
                  value={quantity}
                />
              </label>
            </div>
            <p className="mt-2 text-xs text-gray-500">
              {product.available && availableStock > 0
                ? `${availableStock} available`
                : 'Currently unavailable'}
            </p>
            {selectedVariant && (
              <p className="sr-only" role="status">
                Selected option: {selectedVariant.name}
              </p>
            )}
            {isCustomer && (
              <button
                className="mt-5 min-h-12 w-full bg-gray-950 px-4 py-3 text-xs font-medium uppercase tracking-wide text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={
                  !isCustomer ||
                  ownShop ||
                  addingToCart ||
                  !product.available ||
                  availableStock < 1 ||
                  !Number.isInteger(quantity) ||
                  quantity < 1 ||
                  quantity > availableStock
                }
                onClick={() => void addToCart()}
                type="button"
              >
                {addingToCart ? 'Adding to cart…' : 'Add to cart'}
              </button>
            )}
            {!user && (
              <Link
                className="mt-5 flex min-h-12 w-full items-center justify-center bg-gray-950 px-4 py-3 text-xs font-medium uppercase tracking-wide text-white hover:bg-gray-800"
                href="/"
              >
                Sign in to shop
              </Link>
            )}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs">
              {isCustomer && (
                <button
                  aria-pressed={saved}
                  className="py-2 text-gray-600 hover:text-gray-950"
                  onClick={() => void toggleWishlist()}
                  type="button"
                >
                  {saved ? '♥ Saved to wishlist' : '♡ Add to wishlist'}
                </button>
              )}
              {!isCustomer && (
                <p className="text-xs leading-5 text-gray-600">
                  {user ? (
                    'Select Customer workspace above to shop, save products or contact vendors.'
                  ) : (
                    <Link href="/" className="underline">
                      Sign in and select Customer workspace to shop.
                    </Link>
                  )}
                </p>
              )}
              {isCustomer && ownShop && (
                <p className="text-xs leading-5 text-gray-600">
                  You cannot buy from your own shops. Use Vendor stock transfers
                  instead.
                </p>
              )}
              {isCustomer && (
                <Link
                  className="py-2 text-gray-600 underline underline-offset-4 hover:text-gray-950"
                  href="/cart"
                >
                  View cart
                </Link>
              )}
            </div>
            {cartMessage && (
              <p className="mt-3 text-sm text-emerald-800" role="status">
                {cartMessage}
              </p>
            )}
            <ProductInformation product={product} variant={selectedVariant} />
            <div className="mt-8 border-t border-gray-200 pt-5 text-xs">
              <p className="text-gray-500">
                {product.category_name}
                {product.brand_name ? ` · ${product.brand_name}` : ''}
              </p>
              <Link
                className="mt-3 inline-block font-medium underline underline-offset-4"
                href={`/shops/${product.shop_slug}`}
              >
                Visit {product.shop_name}
              </Link>
              {isCustomer && !ownShop && (
                <button
                  className="ml-4 inline-block py-2 text-gray-600 underline underline-offset-4 hover:text-gray-950"
                  onClick={() => void startConversation()}
                  type="button"
                >
                  Message vendor
                </button>
              )}
            </div>
          </section>
        </div>
        <div className="mt-14 grid items-start gap-8 border-t border-gray-200 pt-8 lg:grid-cols-2">
          <div className="min-w-0">
            <FraudReportForm targetType="product" targetId={product.id} />
            <section
              aria-labelledby="product-reviews-heading"
              className="mt-4 rounded-2xl border border-slate-200 bg-white p-5"
            >
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2
                    className="text-lg font-bold text-slate-950"
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
                      reviews.reduce(
                        (total, review) => total + review.rating,
                        0,
                      ) / reviews.length
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
                      {isCustomer && (
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
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-5 rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
                  No published reviews yet.
                </p>
              )}
            </section>
          </div>
          {related.length > 0 && (
            <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="text-lg font-bold text-slate-950">
                More offers in this category
              </h2>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {related.map((item) => (
                  <Link
                    className="rounded-xl border border-slate-200 bg-white p-4 hover:border-emerald-700"
                    href={`/marketplace/${item.slug}`}
                    key={item.id}
                  >
                    {item.images[0] && (
                      <div
                        aria-label={item.images[0].alt_text || item.name}
                        role="img"
                        className="mb-3 aspect-square rounded-lg bg-slate-100 bg-contain bg-center bg-no-repeat"
                        style={{
                          backgroundImage: `url("${browserStorageUrl(item.images[0].url)}")`,
                        }}
                      />
                    )}
                    <p className="font-semibold text-slate-900">{item.name}</p>
                    <p className="mt-2 font-bold text-slate-900">
                      NPR {item.price}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      {item.shop_name}
                    </p>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      </main>
      {cartDrawer}
    </div>
  );
}
