'use client';

import Link from 'next/link';
import { useEffect, useRef, type FormEvent } from 'react';
import type { Brand, Category } from '@/lib/api';
import { categoryHref } from './catalog-presentation';
import styles from './catalog.module.css';

export type Filters = {
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

export default function CatalogFilters({
  categories,
  brands,
  categoryId,
  draft,
  onChange,
  onSubmit,
  onReset,
}: {
  categories: Category[];
  brands: Brand[];
  categoryId: string;
  draft: Filters;
  onChange: (draft: Filters) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onReset: () => void;
}) {
  const filtersRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(min-width: 768px)');
    const update = () => {
      if (filtersRef.current) filtersRef.current.open = media.matches;
    };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const current = categories.find((category) => category.id === categoryId);
  const children = categories.filter(
    (category) => category.parent_id === (current?.id ?? null),
  );

  return (
    <details className={styles.filters} open ref={filtersRef}>
      <summary>Filters</summary>
      <form id="marketplace-filters" onSubmit={onSubmit}>
        <details className={styles.filterSection} open>
          <summary>{current?.name ?? 'Categories'}</summary>
          <div className={styles.filterBody}>
            <nav
              aria-label="Subcategories"
              className="grid gap-3 text-gray-600"
            >
              <Link href="/marketplace">All products</Link>
              {current?.parent_id && (
                <Link href={categoryHref(current.parent_id)}>
                  Back to parent category
                </Link>
              )}
              {children.map((category) => (
                <Link
                  className="hover:text-[#80527f] hover:underline"
                  href={categoryHref(category.id)}
                  key={category.id}
                >
                  {category.name}
                </Link>
              ))}
              {current && !children.length && (
                <p className="text-gray-500">No subcategories.</p>
              )}
            </nav>
            <label className={styles.field}>
              Category
              <select
                aria-label="Category"
                value={draft.category_id}
                onChange={(event) =>
                  onChange({ ...draft, category_id: event.target.value })
                }
              >
                <option value="">All categories</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </details>
        <details className={styles.filterSection} open>
          <summary>Brand</summary>
          <fieldset className={styles.filterBody}>
            <legend className="sr-only">Brand</legend>
            <p className="text-[10px] text-gray-500">Choose one brand.</p>
            <label className={styles.choice}>
              <input
                checked={!draft.brand_id}
                name="brand"
                onChange={() => onChange({ ...draft, brand_id: '' })}
                type="radio"
                value=""
              />
              All brands
            </label>
            {brands.map((brand) => (
              <label className={styles.choice} key={brand.id}>
                <input
                  checked={draft.brand_id === brand.id}
                  name="brand"
                  onChange={() => onChange({ ...draft, brand_id: brand.id })}
                  type="radio"
                  value={brand.id}
                />
                {brand.name}
              </label>
            ))}
          </fieldset>
        </details>
        <details className={styles.filterSection} open>
          <summary>Price</summary>
          <div className={styles.filterBody}>
            <div className="grid grid-cols-2 gap-2">
              <label className={styles.field}>
                <span>Min (NPR)</span>
                <input
                  aria-label="Minimum price (NPR)"
                  min="0"
                  max="9999999999.99"
                  onChange={(event) =>
                    onChange({ ...draft, min_price: event.target.value })
                  }
                  step="0.01"
                  type="number"
                  value={draft.min_price}
                />
              </label>
              <label className={styles.field}>
                <span>Max (NPR)</span>
                <input
                  aria-label="Maximum price (NPR)"
                  min="0"
                  max="9999999999.99"
                  onChange={(event) =>
                    onChange({ ...draft, max_price: event.target.value })
                  }
                  step="0.01"
                  type="number"
                  value={draft.max_price}
                />
              </label>
            </div>
            <button className={styles.apply} type="submit">
              Update
            </button>
          </div>
        </details>
        <details className={styles.filterSection}>
          <summary>Rating</summary>
          <p className="p-3 text-gray-500">
            Rating filters are not available. Published reviews are shown on
            each product page.
          </p>
        </details>
        <details className={styles.filterSection} open>
          <summary>Other</summary>
          <div className={styles.filterBody}>
            <label className={styles.choice}>
              <input
                checked={draft.in_stock}
                onChange={(event) =>
                  onChange({ ...draft, in_stock: event.target.checked })
                }
                type="checkbox"
              />
              In stock only
            </label>
            <label className={styles.field}>
              City
              <input
                maxLength={80}
                onChange={(event) =>
                  onChange({ ...draft, city: event.target.value })
                }
                placeholder="Kathmandu"
                value={draft.city}
              />
            </label>
            <label className={styles.field}>
              Province
              <input
                maxLength={80}
                onChange={(event) =>
                  onChange({ ...draft, province: event.target.value })
                }
                placeholder="Bagmati"
                value={draft.province}
              />
            </label>
          </div>
        </details>
        <div className="grid gap-3">
          <button className={styles.apply} type="submit">
            Apply filters
          </button>
          <button
            className="min-h-10 text-gray-600 underline underline-offset-4"
            onClick={onReset}
            type="button"
          >
            Clear filters
          </button>
        </div>
      </form>
    </details>
  );
}
