'use client';

import Link from 'next/link';
import type { Category, Product } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace-context';
import { browserStorageUrl } from '@/lib/network';
import StoreAccountMenu from './store-account-menu';
import NotificationPopover from '@/components/notifications/notification-popover';
import styles from './catalog.module.css';

export function categoryHref(id: string) {
  return `/marketplace?category_id=${encodeURIComponent(id)}`;
}

export function categoryPath(categories: Category[], id: string) {
  const path: Category[] = [];
  const visited = new Set<string>();
  let current = categories.find((category) => category.id === id);
  while (current && !visited.has(current.id)) {
    path.unshift(current);
    visited.add(current.id);
    const parentId = current.parent_id;
    current = categories.find((category) => category.id === parentId);
  }
  return path;
}

export function CatalogHeader({
  categories,
  categoryId,
  search,
  onSearchChange,
  cartCount,
  onOpenCart,
}: {
  categories: Category[];
  categoryId: string;
  search: string;
  onSearchChange: (value: string) => void;
  cartCount: number | null;
  onOpenCart: () => void;
}) {
  const { workspace, user } = useWorkspace();
  const isCustomer = workspace === 'customer' && !!user;
  const roots = categories.filter((category) => !category.parent_id);

  return (
    <>
      <div className={styles.topBar}>
        <div className={styles.container}>
          <p>Discover local shops. Find your everyday favorites.</p>
          <label className="flex shrink-0 items-center gap-2">
            <span className="sr-only">Currency</span>
            <select
              aria-label="Currency"
              aria-describedby="catalog-currency-note"
              className={styles.currency}
              disabled
              value="NPR"
            >
              <option value="NPR">NPR</option>
            </select>
            <span className="sr-only" id="catalog-currency-note">
              Prices and checkout are available in NPR only.
            </span>
          </label>
        </div>
      </div>
      <header className={styles.header}>
        <div className={`${styles.container} ${styles.headerGrid}`}>
          <Link className={styles.brand} href="/" aria-label="Vendor's Market">
            VENDOR&apos;S <strong>MARKET</strong>
          </Link>
          <div className={styles.utilities}>
            <span className={styles.shipping}>Shipping · NPR 100 / shop</span>
            <a className="py-3 hover:underline" href="#catalog-products">
              Discover products
            </a>
            <StoreAccountMenu />
            {isCustomer && <NotificationPopover />}
            {isCustomer && (
              <button
                aria-haspopup="dialog"
                className="py-3 hover:underline"
                onClick={onOpenCart}
                type="button"
              >
                View cart{cartCount !== null ? ` (${cartCount})` : ''}
              </button>
            )}
            {workspace === 'vendor' && user && (
              <Link className="py-3 hover:underline" href="/vendor">
                Vendor workspace
              </Link>
            )}
          </div>
          <div className={styles.navigationRow}>
            <nav aria-label="Catalog categories" className={styles.categoryNav}>
              <Link
                href="/marketplace"
                aria-current={!categoryId ? 'page' : undefined}
              >
                All products
              </Link>
              {roots.slice(0, 4).map((category) => (
                <Link
                  aria-current={categoryId === category.id ? 'page' : undefined}
                  href={categoryHref(category.id)}
                  key={category.id}
                >
                  {category.name}
                </Link>
              ))}
              {roots.length > 4 && (
                <details className={styles.more}>
                  <summary className="cursor-pointer">More</summary>
                  <div>
                    {roots.slice(4).map((category) => (
                      <Link
                        aria-current={
                          categoryId === category.id ? 'page' : undefined
                        }
                        href={categoryHref(category.id)}
                        key={category.id}
                      >
                        {category.name}
                      </Link>
                    ))}
                  </div>
                </details>
              )}
            </nav>
            <div
              className={styles.search}
              role="search"
              aria-label="Catalog search"
            >
              <label className="sr-only" htmlFor="catalog-search">
                Search
              </label>
              <input
                autoComplete="off"
                form="marketplace-filters"
                id="catalog-search"
                maxLength={120}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="Products, descriptions, or SKU"
                type="search"
                value={search}
              />
              <button
                aria-label="Search products"
                form="marketplace-filters"
                type="submit"
              >
                <svg
                  aria-hidden="true"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <circle cx="10.5" cy="10.5" r="6.5" />
                  <path d="m16 16 5 5" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </header>
    </>
  );
}

export function CatalogBreadcrumbs({
  categories,
  categoryId,
}: {
  categories: Category[];
  categoryId: string;
}) {
  const path = categoryPath(categories, categoryId);
  return (
    <div className={styles.titleBand}>
      <h1>{path.at(-1)?.name ?? (categoryId ? 'Category' : 'All products')}</h1>
      <nav aria-label="Breadcrumb">
        <ol className={styles.breadcrumbs}>
          <li>
            <Link href="/">Home</Link>
          </li>
          <li>
            <Link
              aria-current={!categoryId ? 'page' : undefined}
              href="/marketplace"
            >
              Catalog
            </Link>
          </li>
          {path.map((category, index) => (
            <li key={category.id}>
              <Link
                aria-current={index === path.length - 1 ? 'page' : undefined}
                href={categoryHref(category.id)}
              >
                {category.name}
              </Link>
            </li>
          ))}
        </ol>
      </nav>
    </div>
  );
}

export function CatalogHero() {
  return (
    <section aria-label="Discover the marketplace" className={styles.hero}>
      <div className={styles.heroCopy}>
        <p>Local finds, everyday favorites</p>
        <h2>
          Discover something <strong>uniquely yours.</strong>
        </h2>
      </div>
      <svg
        aria-hidden="true"
        className={styles.heroArt}
        viewBox="0 0 250 155"
        fill="none"
      >
        <ellipse cx="132" cy="140" rx="100" ry="9" fill="#e1dbe6" />
        <path d="m27 48 67-10 13 99-67 4Z" fill="#c8b3cb" />
        <path
          d="m43 52-2-15c-3-30 37-35 40-5l2 15"
          stroke="#80527f"
          strokeWidth="3"
        />
        <path d="m91 65 88-4 12 78-90 1Z" fill="#80527f" />
        <path
          d="m112 72-1-23c-1-30 44-32 46-2l1 22"
          stroke="#50334f"
          strokeWidth="3"
        />
        <path d="m179 89 47 7-6 44-44-1Z" fill="#d2c49f" />
        <path
          d="m188 100 2-17c2-17 27-13 25 4l-2 17"
          stroke="#938467"
          strokeWidth="3"
        />
        <path d="m139 104 7 6-7 6-7-6Z" fill="#efe9f1" />
        <circle cx="217" cy="36" r="4" fill="#c8b3cb" />
        <path
          d="M183 22v10m-5-5h10M17 99v10m-5-5h10"
          stroke="#b49ab7"
          strokeWidth="2"
        />
      </svg>
    </section>
  );
}

export function ProductCard({
  product,
  onWishlist,
  saved,
  canWishlist,
}: {
  product: Product;
  onWishlist: (product: Product) => void;
  saved: boolean;
  canWishlist: boolean;
}) {
  return (
    <article className={styles.card}>
      <Link href={`/marketplace/${product.slug}`} className="block">
        <div className={styles.productImage}>
          {product.images[0] ? (
            <div
              aria-label={product.images[0].alt_text || product.name}
              role="img"
              style={{
                backgroundImage: `url("${browserStorageUrl(product.images[0].url)}")`,
              }}
            />
          ) : (
            <span className="text-[10px] text-gray-500">
              Image not provided
            </span>
          )}
          {!product.available && (
            <span className={styles.badge}>Out of stock</span>
          )}
        </div>
        <h3>{product.name}</h3>
        <p className="mt-1 text-xs font-medium">NPR {product.price}</p>
        <p className="mt-1 text-[10px] text-gray-500">{product.shop_name}</p>
        <p className="mt-1 text-[10px] text-gray-500">
          {product.category_name}
          {product.brand_name ? ` · ${product.brand_name}` : ''}
        </p>
        <p className="mt-2 text-[10px] text-gray-500">
          View product &amp; reviews
        </p>
      </Link>
      {canWishlist && (
        <button
          aria-label={`${saved ? 'Saved' : 'Add to wishlist'}: ${product.name}`}
          aria-pressed={saved}
          className="mt-auto min-h-10 py-2 text-[10px] font-medium text-[#80527f] hover:underline"
          onClick={() => onWishlist(product)}
          type="button"
        >
          {saved ? '♥ Saved' : '♡ Add to wishlist'}
        </button>
      )}
    </article>
  );
}

export function CatalogFooter({ categories }: { categories: Category[] }) {
  const { user, workspace } = useWorkspace();
  const customer = !!user && workspace === 'customer';
  return (
    <footer className={styles.footer}>
      <section aria-labelledby="newsletter-title" className={styles.newsletter}>
        <div className={styles.container}>
          <h2 id="newsletter-title">SUBSCRIBE US</h2>
          <fieldset
            disabled
            aria-describedby="newsletter-unavailable"
            aria-label="Newsletter subscription"
          >
            <label className="sr-only" htmlFor="newsletter-email">
              Email address
            </label>
            <input
              id="newsletter-email"
              placeholder="Your email address"
              type="email"
            />
            <button aria-label="Subscribe (unavailable)" disabled type="button">
              <svg
                aria-hidden="true"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="m3 11 18-8-8 18-2-8-8-2Z" />
                <path d="m11 13 10-10" />
              </svg>
            </button>
          </fieldset>
          <p className="text-[11px] text-gray-500" id="newsletter-unavailable">
            Newsletter signup is not available yet.
          </p>
        </div>
      </section>
      <div className={`${styles.container} ${styles.footerGrid}`}>
        <div>
          <Link className="text-xl font-light tracking-tight" href="/">
            Vendor&apos;s <strong className="font-semibold">Market</strong>
          </Link>
          <p className="mt-4 max-w-56">
            Discover products from shops across Nepal. Browse, save your
            favorites, and shop in Customer workspace.
          </p>
        </div>
        <nav aria-label="Footer navigation">
          <h2>Navigate</h2>
          <ul>
            <li>
              <Link href="/marketplace">Catalog</Link>
            </li>
            <li>
              <Link href="/">Your account</Link>
            </li>
            {customer && (
              <>
                <li>
                  <Link href="/orders">Your orders</Link>
                </li>
                <li>
                  <Link href="/messages">Messages</Link>
                </li>
                <li>
                  <Link href="/support">Support &amp; disputes</Link>
                </li>
              </>
            )}
            <li>
              <a href="#shops-heading">Find local shops</a>
            </li>
          </ul>
        </nav>
        <nav aria-label="Footer categories">
          <h2>Categories</h2>
          <ul>
            {categories
              .filter((category) => !category.parent_id)
              .slice(0, 6)
              .map((category) => (
                <li key={category.id}>
                  <Link href={categoryHref(category.id)}>{category.name}</Link>
                </li>
              ))}
            <li>
              <Link href="/marketplace">All products</Link>
            </li>
          </ul>
        </nav>
        <div>
          <h2>Information</h2>
          <p>Marketplace for Nepal</p>
          <p className="mt-2">Shipping: NPR 100 per shop</p>
          <p className="mt-2">Payment: cash on delivery</p>
          <Link
            className="mt-3 inline-block underline underline-offset-4"
            href={customer ? '/support' : '/'}
          >
            Contact support through your account
          </Link>
        </div>
      </div>
      <div className={styles.bottomBar}>
        <div className={styles.container}>
          <p>© {new Date().getFullYear()} Vendor&apos;s Market</p>
          <p>Cash on delivery · NPR</p>
        </div>
      </div>
    </footer>
  );
}
