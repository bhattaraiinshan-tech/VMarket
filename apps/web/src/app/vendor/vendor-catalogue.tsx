'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';

import {
  ApiError,
  Brand,
  Category,
  Product,
  ProductPage,
  ProductVariant,
  Shop,
  requestApi,
} from '@/lib/api';

type ShopDraft = {
  name: string;
  description: string;
  address: string;
  city: string;
  province: string;
  latitude: string;
  longitude: string;
};

const emptyShop: ShopDraft = {
  name: '',
  description: '',
  address: '',
  city: '',
  province: '',
  latitude: '',
  longitude: '',
};

const fieldClass =
  'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900';

function VariantRow({
  product,
  variant,
  onChanged,
}: {
  product: Product;
  variant: ProductVariant;
  onChanged: () => Promise<void>;
}) {
  const [price, setPrice] = useState(variant.price);
  const [stock, setStock] = useState(String(variant.stock));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function saveVariant() {
    setBusy(true);
    setError('');
    try {
      await requestApi<ProductVariant>(
        `/vendor/products/${product.id}/variants/${variant.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ price, stock: Number.parseInt(stock, 10) }),
        },
      );
      await onChanged();
    } catch (cause: unknown) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Variant could not be updated.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function removeVariant() {
    setBusy(true);
    setError('');
    try {
      await requestApi<void>(
        `/vendor/products/${product.id}/variants/${variant.id}`,
        { method: 'DELETE' },
      );
      await onChanged();
    } catch (cause: unknown) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Variant could not be removed.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-lg bg-slate-50 p-3">
      <p className="text-sm font-medium">
        {variant.name} · SKU {variant.sku}
      </p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="text-xs font-medium">
          Price (NPR)
          <input
            className={fieldClass}
            min="0.01"
            onChange={(event) => setPrice(event.target.value)}
            step="0.01"
            type="number"
            value={price}
          />
        </label>
        <label className="text-xs font-medium">
          Stock
          <input
            className={fieldClass}
            min="0"
            onChange={(event) => setStock(event.target.value)}
            step="1"
            type="number"
            value={stock}
          />
        </label>
        <button
          className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold disabled:opacity-60"
          disabled={busy}
          onClick={() => void saveVariant()}
          type="button"
        >
          Save variant
        </button>
        <button
          className="rounded-lg border border-red-300 px-3 py-2 text-xs font-semibold text-red-800 disabled:opacity-60"
          disabled={busy}
          onClick={() => void removeVariant()}
          type="button"
        >
          Remove
        </button>
      </div>
      {error && (
        <p className="mt-2 text-xs text-red-800" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

function VariantManager({
  product,
  category,
  onChanged,
}: {
  product: Product;
  category: Category | undefined;
  onChanged: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('0');
  const [attributes, setAttributes] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const variantAttributes =
    category?.attributes.filter((attribute) => attribute.applies_to_variant) ??
    [];

  async function addVariant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await requestApi<ProductVariant>(
        `/vendor/products/${product.id}/variants`,
        {
          method: 'POST',
          body: JSON.stringify({
            name,
            sku,
            price,
            stock: Number.parseInt(stock, 10),
            attributes: Object.fromEntries(
              Object.entries(attributes).filter(([, value]) => value.trim()),
            ),
          }),
        },
      );
      setName('');
      setSku('');
      setPrice('');
      setStock('0');
      setAttributes({});
      await onChanged();
    } catch (cause: unknown) {
      setError(
        cause instanceof Error ? cause.message : 'Variant could not be added.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      <h4 className="text-sm font-semibold">Variants</h4>
      {product.variants.length > 0 && (
        <ul className="mt-2 space-y-2">
          {product.variants.map((variant) => (
            <VariantRow
              key={variant.id}
              onChanged={onChanged}
              product={product}
              variant={variant}
            />
          ))}
        </ul>
      )}
      <form
        className="mt-3 grid gap-2 sm:grid-cols-3"
        onSubmit={(event) => void addVariant(event)}
      >
        <input
          aria-label="Variant name"
          className={fieldClass}
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
          placeholder="Variant name"
          required
          value={name}
        />
        <input
          aria-label="Variant SKU"
          className={fieldClass}
          maxLength={80}
          onChange={(event) => setSku(event.target.value)}
          placeholder="Variant SKU"
          required
          value={sku}
        />
        <input
          aria-label="Variant price"
          className={fieldClass}
          min="0.01"
          onChange={(event) => setPrice(event.target.value)}
          placeholder="Price (NPR)"
          required
          step="0.01"
          type="number"
          value={price}
        />
        <input
          aria-label="Variant stock"
          className={fieldClass}
          min="0"
          onChange={(event) => setStock(event.target.value)}
          required
          step="1"
          type="number"
          value={stock}
        />
        {variantAttributes.map((attribute) => (
          <label className="text-xs font-medium" key={attribute.id}>
            {attribute.label}
            {attribute.required ? ' *' : ''}
            <input
              className={fieldClass}
              onChange={(event) =>
                setAttributes((current) => ({
                  ...current,
                  [attribute.key]: event.target.value,
                }))
              }
              required={attribute.required}
              type={attribute.value_type === 'number' ? 'number' : 'text'}
              value={attributes[attribute.key] ?? ''}
            />
          </label>
        ))}
        <button
          className="rounded-lg border border-emerald-700 px-3 py-2 text-sm font-semibold text-emerald-800 disabled:opacity-60"
          disabled={busy}
          type="submit"
        >
          Add variant
        </button>
      </form>
      {error && (
        <p className="mt-2 text-sm text-red-800" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export default function VendorCatalogue() {
  const [shop, setShop] = useState<Shop | null>(null);
  const [shopDraft, setShopDraft] = useState<ShopDraft>(emptyShop);
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sku, setSku] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('0');
  const [attributeValues, setAttributeValues] = useState<
    Record<string, string>
  >({});
  const [image, setImage] = useState<File | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const category = categories.find((item) => item.id === categoryId);
  const productAttributes =
    category?.attributes.filter((attribute) => !attribute.applies_to_variant) ??
    [];

  const loadProducts = useCallback(async () => {
    try {
      const listing = await requestApi<ProductPage>(
        '/vendor/products?page_size=100',
      );
      setProducts(listing.items);
    } catch (cause: unknown) {
      if (!(cause instanceof ApiError) || cause.status !== 404) {
        setError(
          cause instanceof Error
            ? cause.message
            : 'Products could not be loaded.',
        );
      }
    }
  }, []);

  useEffect(() => {
    void requestApi<Category[]>('/catalog/categories')
      .then(setCategories)
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error
            ? cause.message
            : 'Categories could not be loaded.',
        ),
      );
    void requestApi<Brand[]>('/catalog/brands')
      .then(setBrands)
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error
            ? cause.message
            : 'Brands could not be loaded.',
        ),
      );
    void requestApi<Shop>('/vendor/shop')
      .then((result) => {
        setShop(result);
        setShopDraft({
          name: result.name,
          description: result.description ?? '',
          address: result.address ?? '',
          city: result.city,
          province: result.province,
          latitude: result.latitude ?? '',
          longitude: result.longitude ?? '',
        });
        void loadProducts();
      })
      .catch((cause: unknown) => {
        if (!(cause instanceof ApiError) || cause.status !== 404) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Shop profile could not be loaded.',
          );
        }
      });
  }, [loadProducts]);

  async function submitShop(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    setBusy(true);
    const body = {
      ...shopDraft,
      description: shopDraft.description || null,
      address: shopDraft.address || null,
      latitude: shopDraft.latitude || null,
      longitude: shopDraft.longitude || null,
    };
    try {
      const updated = await requestApi<Shop>('/vendor/shop', {
        method: shop ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
      setShop(updated);
      setShopDraft({
        ...shopDraft,
        latitude: updated.latitude ?? '',
        longitude: updated.longitude ?? '',
      });
      setMessage(shop ? 'Shop profile updated.' : 'Shop profile created.');
    } catch (cause: unknown) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Shop profile could not be saved.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    setBusy(true);
    const attributes = Object.fromEntries(
      Object.entries(attributeValues).filter(([, value]) => value.trim()),
    );
    try {
      const product = await requestApi<Product>(
        editingProductId
          ? `/vendor/products/${editingProductId}`
          : '/vendor/products',
        {
          method: editingProductId ? 'PATCH' : 'POST',
          body: JSON.stringify({
            category_id: categoryId,
            brand_id: brandId || null,
            name,
            description,
            sku,
            price,
            stock: Number.parseInt(stock, 10),
            attributes,
          }),
        },
      );
      setProducts((current) =>
        editingProductId
          ? current.map((item) => (item.id === product.id ? product : item))
          : [product, ...current],
      );
      setMessage(
        editingProductId
          ? 'Listing updated and submitted for moderation.'
          : 'Listing submitted for moderation.',
      );
      setEditingProductId(null);
      setName('');
      setDescription('');
      setSku('');
      setPrice('');
      setStock('0');
      setAttributeValues({});
      if (image) {
        const formData = new FormData();
        formData.set('file', image);
        try {
          await requestApi(`/vendor/products/${product.id}/images`, {
            method: 'POST',
            body: formData,
          });
          await loadProducts();
        } catch (cause: unknown) {
          setError(
            cause instanceof Error
              ? `Listing was submitted, but its image could not be uploaded: ${cause.message}`
              : 'Listing was submitted, but its image could not be uploaded.',
          );
        }

        setImage(null);
      }
    } catch (cause: unknown) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Listing could not be submitted.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function uploadShopLogo(file: File) {
    setError('');
    setMessage('');
    setBusy(true);
    const formData = new FormData();
    formData.set('file', file);
    try {
      const updated = await requestApi<Shop>('/vendor/shop/logo', {
        method: 'POST',
        body: formData,
      });
      setShop(updated);
      setMessage('Shop logo updated.');
    } catch (cause: unknown) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Shop logo could not be uploaded.',
      );
    } finally {
      setBusy(false);
    }
  }

  function editProduct(product: Product) {
    setEditingProductId(product.id);
    setCategoryId(product.category_id);
    setBrandId(product.brand_id ?? '');
    setName(product.name);
    setDescription(product.description);
    setSku(product.sku);
    setPrice(product.price);
    setStock(String(product.stock));
    setAttributeValues(product.attributes);
    setImage(null);
    setError('');
    setMessage(
      `Editing ${product.name}. Saving changes sends it for moderation again.`,
    );
  }

  function cancelProductEdit() {
    setEditingProductId(null);
    setName('');
    setDescription('');
    setSku('');
    setPrice('');
    setStock('0');
    setAttributeValues({});
    setImage(null);
  }

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-5 py-8 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <Link className="text-sm font-bold text-emerald-800" href="/">
            Vendor&apos;s Market
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">
            Vendor catalogue
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Manage your shop profile and submit listings for review.
          </p>
        </div>
        <div className="flex flex-wrap gap-4">
          <Link
            className="text-sm font-semibold text-emerald-800"
            href="/vendor/orders"
          >
            Fulfillment orders
          </Link>
          <Link
            className="text-sm font-semibold text-emerald-800"
            href="/marketplace"
          >
            Browse marketplace
          </Link>
        </div>
      </header>
      {(message || error) && (
        <p
          className={`mt-5 rounded-lg px-4 py-3 text-sm ${error ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800'}`}
          role={error ? 'alert' : 'status'}
        >
          {error || message}
        </p>
      )}

      <section className="mt-7 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">Shop profile</h2>
        {!shop && (
          <p className="mt-2 text-sm text-slate-600">
            Shop creation is available after your vendor application is
            approved.
          </p>
        )}
        <form
          className="mt-4 grid gap-4 sm:grid-cols-2"
          onSubmit={(event) => void submitShop(event)}
        >
          {(
            [
              ['name', 'Shop name'],
              ['city', 'City / municipality'],
              ['province', 'Province'],
              ['address', 'Street address'],
              ['latitude', 'Latitude'],
              ['longitude', 'Longitude'],
            ] as const
          ).map(([field, label]) => (
            <label className="text-sm font-medium text-slate-800" key={field}>
              {label}
              <input
                className={fieldClass}
                maxLength={field === 'name' ? 160 : 320}
                onChange={(event) =>
                  setShopDraft((current) => ({
                    ...current,
                    [field]: event.target.value,
                  }))
                }
                required={
                  field === 'name' || field === 'city' || field === 'province'
                }
                value={shopDraft[field]}
              />
            </label>
          ))}
          <label className="text-sm font-medium text-slate-800 sm:col-span-2">
            Description
            <textarea
              className={fieldClass}
              maxLength={2000}
              onChange={(event) =>
                setShopDraft((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              rows={3}
              value={shopDraft.description}
            />
          </label>
          <button
            className="rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 sm:col-span-2 sm:justify-self-start"
            disabled={busy}
            type="submit"
          >
            {shop ? 'Save shop profile' : 'Create shop'}
          </button>
        </form>
        {shop && (
          <div className="mt-5 border-t border-slate-100 pt-4">
            {shop.logo_url && (
              <div
                aria-label={`${shop.name} logo`}
                className="mb-3 h-16 w-16 rounded-lg bg-cover bg-center bg-slate-100"
                role="img"
                style={{ backgroundImage: `url("${shop.logo_url}")` }}
              />
            )}
            <label className="block text-sm font-medium text-slate-800">
              Shop logo (JPEG, PNG, or WebP; up to 8 MB)
              <input
                accept="image/jpeg,image/png,image/webp"
                className={fieldClass}
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadShopLogo(file);
                }}
                type="file"
              />
            </label>
          </div>
        )}
      </section>

      {shop && (
        <>
          <section className="mt-7 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">
              {editingProductId ? 'Edit listing' : 'Submit a product'}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              New or edited listings stay hidden until an administrator approves
              them.
            </p>
            <form
              className="mt-5 grid gap-4 sm:grid-cols-2"
              onSubmit={(event) => void submitProduct(event)}
            >
              <label className="text-sm font-medium text-slate-800">
                Product name
                <input
                  className={fieldClass}
                  maxLength={180}
                  onChange={(event) => setName(event.target.value)}
                  required
                  value={name}
                />
              </label>
              <label className="text-sm font-medium text-slate-800">
                SKU
                <input
                  className={fieldClass}
                  maxLength={80}
                  onChange={(event) => setSku(event.target.value)}
                  required
                  value={sku}
                />
              </label>
              <label className="text-sm font-medium text-slate-800">
                Category
                <select
                  className={fieldClass}
                  onChange={(event) => {
                    setCategoryId(event.target.value);
                    setAttributeValues({});
                  }}
                  required
                  value={categoryId}
                >
                  <option value="">Select a category</option>
                  {categories.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-medium text-slate-800">
                Brand
                <select
                  className={fieldClass}
                  onChange={(event) => setBrandId(event.target.value)}
                  value={brandId}
                >
                  <option value="">No brand</option>
                  {brands.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-medium text-slate-800">
                Price (NPR)
                <input
                  className={fieldClass}
                  min="0.01"
                  onChange={(event) => setPrice(event.target.value)}
                  required
                  step="0.01"
                  type="number"
                  value={price}
                />
              </label>
              <label className="text-sm font-medium text-slate-800">
                Stock quantity
                <input
                  className={fieldClass}
                  min="0"
                  onChange={(event) => setStock(event.target.value)}
                  required
                  step="1"
                  type="number"
                  value={stock}
                />
              </label>
              <label className="text-sm font-medium text-slate-800 sm:col-span-2">
                Description
                <textarea
                  className={fieldClass}
                  maxLength={10000}
                  onChange={(event) => setDescription(event.target.value)}
                  required
                  rows={4}
                  value={description}
                />
              </label>
              {productAttributes.map((attribute) => (
                <label
                  className="text-sm font-medium text-slate-800"
                  key={attribute.id}
                >
                  {attribute.label}
                  {attribute.required ? ' *' : ''}
                  <input
                    className={fieldClass}
                    onChange={(event) =>
                      setAttributeValues((current) => ({
                        ...current,
                        [attribute.key]: event.target.value,
                      }))
                    }
                    required={attribute.required}
                    type={attribute.value_type === 'number' ? 'number' : 'text'}
                    value={attributeValues[attribute.key] ?? ''}
                  />
                </label>
              ))}
              <label className="text-sm font-medium text-slate-800 sm:col-span-2">
                Product image (JPEG, PNG, or WebP; up to 8 MB)
                <input
                  accept="image/jpeg,image/png,image/webp"
                  className={`${fieldClass} file:mr-3 file:rounded-md file:border-0 file:bg-emerald-50 file:px-3 file:py-1 file:text-sm file:font-semibold file:text-emerald-800`}
                  onChange={(event) =>
                    setImage(event.target.files?.[0] ?? null)
                  }
                  type="file"
                />
              </label>
              <button
                className="rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 sm:col-span-2 sm:justify-self-start"
                disabled={busy}
                type="submit"
              >
                {editingProductId ? 'Save changes' : 'Submit listing'}
              </button>
              {editingProductId && (
                <button
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold sm:col-span-2 sm:justify-self-start"
                  disabled={busy}
                  onClick={cancelProductEdit}
                  type="button"
                >
                  Cancel editing
                </button>
              )}
            </form>
          </section>

          <section className="mt-7">
            <h2 className="text-lg font-semibold text-slate-950">
              Your listings
            </h2>
            {products.length ? (
              <ul className="mt-3 space-y-3">
                {products.map((product) => (
                  <li
                    className="rounded-xl border border-slate-200 bg-white p-4"
                    key={product.id}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-900">
                          {product.name}
                        </p>
                        <p className="mt-1 text-sm text-slate-600">
                          SKU {product.sku} · NPR {product.price} · stock{' '}
                          {product.stock}
                        </p>
                        {product.moderation_notes && (
                          <p className="mt-1 text-sm text-amber-800">
                            {product.moderation_notes}
                          </p>
                        )}
                      </div>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${product.status === 'approved' ? 'bg-emerald-50 text-emerald-800' : product.status === 'rejected' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-800'}`}
                      >
                        {product.status}
                      </span>
                      <button
                        className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold"
                        onClick={() => editProduct(product)}
                        type="button"
                      >
                        Edit listing
                      </button>
                    </div>
                    <VariantManager
                      category={categories.find(
                        (item) => item.id === product.category_id,
                      )}
                      onChanged={loadProducts}
                      product={product}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-slate-600">No listings yet.</p>
            )}
          </section>
        </>
      )}
    </main>
  );
}
