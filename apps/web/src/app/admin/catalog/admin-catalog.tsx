'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';

import { Brand, Category, Product, ProductPage, requestApi } from '@/lib/api';
import { browserStorageUrl } from '@/lib/network';

const fieldClass =
  'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900';

export default function AdminCatalog() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [pending, setPending] = useState<Product[]>([]);
  const [categoryName, setCategoryName] = useState('');
  const [parentCategoryId, setParentCategoryId] = useState('');
  const [brandName, setBrandName] = useState('');
  const [attributeCategory, setAttributeCategory] = useState('');
  const [attributeKey, setAttributeKey] = useState('');
  const [attributeLabel, setAttributeLabel] = useState('');
  const [attributeType, setAttributeType] = useState<
    'text' | 'number' | 'boolean'
  >('text');
  const [attributeRequired, setAttributeRequired] = useState(false);
  const [variantAttribute, setVariantAttribute] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [categoryItems, brandItems, moderation] = await Promise.all([
        requestApi<Category[]>('/catalog/categories'),
        requestApi<Brand[]>('/catalog/brands'),
        requestApi<ProductPage>('/admin/catalog/moderation?page_size=100'),
      ]);
      setCategories(categoryItems);
      setBrands(brandItems);
      setPending(moderation.items);
      if (!attributeCategory && categoryItems[0]) {
        setAttributeCategory(categoryItems[0].id);
      }
    } catch (cause: unknown) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Catalogue data could not be loaded.',
      );
    }
  }, [attributeCategory]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      requestApi<Category[]>('/catalog/categories'),
      requestApi<Brand[]>('/catalog/brands'),
      requestApi<ProductPage>('/admin/catalog/moderation?page_size=100'),
    ])
      .then(([categoryItems, brandItems, moderation]) => {
        if (!active) return;
        setCategories(categoryItems);
        setBrands(brandItems);
        setPending(moderation.items);
        if (categoryItems[0]) setAttributeCategory(categoryItems[0].id);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Catalogue data could not be loaded.',
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function runAction(action: () => Promise<void>) {
    setError('');
    setMessage('');
    setBusy(true);
    try {
      await action();
    } catch (cause: unknown) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The request could not be completed.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function createCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction(async () => {
      const category = await requestApi<Category>('/admin/catalog/categories', {
        method: 'POST',
        body: JSON.stringify({
          name: categoryName,
          parent_id: parentCategoryId || null,
        }),
      });
      setCategories((current) => [...current, category]);
      setAttributeCategory(category.id);
      setCategoryName('');
      setParentCategoryId('');
      setMessage('Category created.');
    });
  }

  async function createBrand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction(async () => {
      const brand = await requestApi<Brand>('/admin/catalog/brands', {
        method: 'POST',
        body: JSON.stringify({ name: brandName }),
      });
      setBrands((current) => [...current, brand]);
      setBrandName('');
      setMessage('Brand created.');
    });
  }

  async function createAttribute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction(async () => {
      await requestApi(
        `/admin/catalog/categories/${attributeCategory}/attributes`,
        {
          method: 'POST',
          body: JSON.stringify({
            key: attributeKey,
            label: attributeLabel,
            value_type: attributeType,
            required: attributeRequired,
            applies_to_variant: variantAttribute,
          }),
        },
      );
      setAttributeKey('');
      setAttributeLabel('');
      setMessage('Category attribute added.');
      await loadData();
    });
  }

  async function reviewProduct(
    product: Product,
    status: 'approved' | 'rejected',
  ) {
    await runAction(async () => {
      await requestApi(`/admin/catalog/products/${product.id}/moderation`, {
        method: 'POST',
        body: JSON.stringify({ status, notes: notes[product.id] || null }),
      });
      setPending((current) => current.filter((item) => item.id !== product.id));
      setMessage(`Listing ${status}.`);
    });
  }

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-5 py-8 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <Link className="text-sm font-bold text-emerald-800" href="/">
            Vendor&apos;s Market
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">
            Catalogue administration
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Manage taxonomy and review vendor listings before publication.
          </p>
        </div>
        <Link
          className="text-sm font-semibold text-emerald-800"
          href="/marketplace"
        >
          Marketplace
        </Link>
        <Link
          className="text-sm font-semibold text-emerald-800"
          href="/admin/operations"
        >
          Operations
        </Link>
      </header>
      {(message || error) && (
        <p
          className={`mt-5 rounded-lg px-4 py-3 text-sm ${error ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800'}`}
          role={error ? 'alert' : 'status'}
        >
          {error || message}
        </p>
      )}

      <section className="mt-7 grid gap-5 lg:grid-cols-2">
        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">
            Categories and subcategories
          </h2>
          <form
            className="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
            onSubmit={(event) => void createCategory(event)}
          >
            <label className="sr-only" htmlFor="category-name">
              Category name
            </label>
            <input
              className={fieldClass}
              id="category-name"
              maxLength={120}
              onChange={(event) => setCategoryName(event.target.value)}
              placeholder="New category"
              required
              value={categoryName}
            />
            <label className="sr-only" htmlFor="parent-category">
              Parent category
            </label>
            <select
              className={fieldClass}
              id="parent-category"
              onChange={(event) => setParentCategoryId(event.target.value)}
              value={parentCategoryId}
            >
              <option value="">Top-level category</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            <button
              className="shrink-0 rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              disabled={busy}
              type="submit"
            >
              Add
            </button>
          </form>
          <ul className="mt-4 space-y-2 text-sm">
            {categories.map((category) => (
              <li className="rounded-lg bg-slate-50 p-3" key={category.id}>
                <span className="font-semibold">
                  {category.parent_id ? '↳ ' : ''}
                  {category.name}
                </span>
                {category.attributes.length > 0 && (
                  <span className="ml-2 text-xs text-slate-500">
                    {category.attributes.map((item) => item.label).join(', ')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Brands</h2>
          <form
            className="mt-4 flex gap-2"
            onSubmit={(event) => void createBrand(event)}
          >
            <label className="sr-only" htmlFor="brand-name">
              Brand name
            </label>
            <input
              className={fieldClass}
              id="brand-name"
              maxLength={120}
              onChange={(event) => setBrandName(event.target.value)}
              placeholder="New brand"
              required
              value={brandName}
            />
            <button
              className="shrink-0 rounded-lg bg-emerald-800 px-4 text-sm font-semibold text-white disabled:opacity-60"
              disabled={busy}
              type="submit"
            >
              Add
            </button>
          </form>
          <ul className="mt-4 flex flex-wrap gap-2">
            {brands.map((brand) => (
              <li
                className="rounded-full bg-slate-100 px-3 py-1 text-sm"
                key={brand.id}
              >
                {brand.name}
              </li>
            ))}
          </ul>
        </article>
      </section>

      <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Category attributes</h2>
        <p className="mt-1 text-sm text-slate-600">
          Define listing fields and variant options used to validate vendor
          submissions.
        </p>
        <form
          className="mt-4 grid gap-3 md:grid-cols-3"
          onSubmit={(event) => void createAttribute(event)}
        >
          <label className="text-sm font-medium">
            Category
            <select
              className={fieldClass}
              onChange={(event) => setAttributeCategory(event.target.value)}
              required
              value={attributeCategory}
            >
              <option value="">Select category</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium">
            Key
            <input
              className={fieldClass}
              maxLength={80}
              onChange={(event) =>
                setAttributeKey(
                  event.target.value.toLowerCase().replaceAll(' ', '_'),
                )
              }
              pattern="[a-z][a-z0-9_]*"
              placeholder="material"
              required
              value={attributeKey}
            />
          </label>
          <label className="text-sm font-medium">
            Label
            <input
              className={fieldClass}
              maxLength={120}
              onChange={(event) => setAttributeLabel(event.target.value)}
              placeholder="Material"
              required
              value={attributeLabel}
            />
          </label>
          <label className="text-sm font-medium">
            Value type
            <select
              className={fieldClass}
              onChange={(event) =>
                setAttributeType(
                  event.target.value as 'text' | 'number' | 'boolean',
                )
              }
              value={attributeType}
            >
              <option value="text">Text</option>
              <option value="number">Number</option>
              <option value="boolean">True / false</option>
            </select>
          </label>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input
              checked={attributeRequired}
              onChange={(event) => setAttributeRequired(event.target.checked)}
              type="checkbox"
            />
            Required for each product
          </label>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input
              checked={variantAttribute}
              onChange={(event) => setVariantAttribute(event.target.checked)}
              type="checkbox"
            />
            Variant option
          </label>
          <button
            className="rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 md:col-span-3 md:justify-self-start"
            disabled={busy || !attributeCategory}
            type="submit"
          >
            Add attribute
          </button>
        </form>
      </section>

      <section className="mt-9">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-emerald-800">
              Listing review
            </p>
            <h2 className="mt-1 text-2xl font-bold text-slate-950">
              Pending moderation
            </h2>
          </div>
          <span className="text-sm text-slate-600">
            {pending.length} pending
          </span>
        </div>
        {pending.length ? (
          <ul className="mt-4 space-y-4">
            {pending.map((product) => (
              <li
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                key={product.id}
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase text-emerald-800">
                      {product.category_name} · {product.shop_name}
                    </p>
                    <h3 className="mt-1 text-lg font-semibold text-slate-950">
                      {product.name}
                    </h3>
                    <p className="mt-1 text-sm text-slate-600">
                      {product.description}
                    </p>
                    <p className="mt-2 text-sm font-semibold">
                      NPR {product.price} · SKU {product.sku} · stock{' '}
                      {product.stock}
                      {product.brand_name ? ` · ${product.brand_name}` : ''}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Attributes:{' '}
                      {Object.entries(product.attributes)
                        .map(([key, value]) => `${key}: ${value}`)
                        .join(', ') || 'none'}
                    </p>
                    {product.variants.length > 0 && (
                      <ul className="mt-2 space-y-1 text-xs text-slate-600">
                        {product.variants.map((variant) => (
                          <li key={variant.id}>
                            {variant.name} · SKU {variant.sku} · NPR{' '}
                            {variant.price} · stock {variant.stock}
                          </li>
                        ))}
                      </ul>
                    )}
                    {product.images.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {product.images.map((image) => (
                          <div
                            aria-label={image.alt_text || product.name}
                            className="h-20 w-20 rounded-lg bg-cover bg-center bg-slate-100"
                            key={image.id}
                            role="img"
                            style={{
                              backgroundImage: `url("${browserStorageUrl(image.url)}")`,
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="rounded-lg bg-emerald-800 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                      disabled={busy}
                      onClick={() => void reviewProduct(product, 'approved')}
                      type="button"
                    >
                      Approve
                    </button>
                    <button
                      className="rounded-lg border border-red-300 px-3 py-2 text-sm font-semibold text-red-800 disabled:opacity-60"
                      disabled={busy}
                      onClick={() => void reviewProduct(product, 'rejected')}
                      type="button"
                    >
                      Reject
                    </button>
                  </div>
                </div>
                <label className="mt-4 block text-sm font-medium">
                  Review notes (optional)
                  <textarea
                    className={fieldClass}
                    maxLength={1000}
                    onChange={(event) =>
                      setNotes((current) => ({
                        ...current,
                        [product.id]: event.target.value,
                      }))
                    }
                    rows={2}
                    value={notes[product.id] ?? ''}
                  />
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-600">
            No product listings are waiting for review.
          </p>
        )}
      </section>
    </main>
  );
}
