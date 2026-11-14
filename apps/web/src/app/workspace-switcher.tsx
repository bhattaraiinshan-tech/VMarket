'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';

import { requestApi } from '@/lib/api';
import NotificationPopover from '@/components/notifications/notification-popover';
import { useWorkspace, useWorkspaceShops } from '@/lib/workspace-context';
import {
  availableWorkspaces,
  selectShop,
  selectWorkspace,
  type Workspace,
} from '@/lib/workspace-state';

export default function WorkspaceSwitcher({
  accountHeader = false,
  hideNavigation = false,
  hideBrand = false,
}: {
  accountHeader?: boolean;
  hideNavigation?: boolean;
  hideBrand?: boolean;
}) {
  const { user, workspace, shopId } = useWorkspace();
  const { shops, loading, error: shopError, refresh } = useWorkspaceShops();
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function createShop(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    setError('');
    try {
      await requestApi('/vendor/shops', {
        method: 'POST',
        body: JSON.stringify({
          name: values.get('name'),
          city: values.get('city'),
          province: values.get('province'),
          address: values.get('address') || null,
          description: values.get('description') || null,
        }),
      });
      form.reset();
      await refresh();
      setCreating(false);
      setMessage('Shop created. Select it from the shop selector to continue.');
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Shop could not be created.',
      );
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!user) return null;
  const links =
    workspace === 'customer'
      ? [
          ['/marketplace', 'Marketplace'],
          ['/cart', 'Cart'],
          ['/orders', 'Customer orders'],
          ['/wishlist', 'Wishlist'],
          ['/messages', 'Messages'],
          ['/notifications', 'Notifications'],
          ['/support', 'Support and disputes'],
          ['/', 'Profile, addresses and vendor application'],
        ]
      : workspace === 'vendor'
        ? [
            ['/vendor', 'Vendor catalogue'],
            ['/vendor/orders', 'Fulfillment and payments'],
            ['/vendor/profile', 'Profile and account settings'],
            ['/vendor/trade', 'Wholesale and stock transfers'],
            ['/vendor/promotions', 'Shop promotions'],
            ['/messages', 'Shop messages'],
            ['/notifications', 'Shop notifications'],
            ['/support', 'Shop support and disputes'],
          ]
        : workspace === 'admin'
          ? [
              ['/admin/operations', 'Dashboard, policies and investigations'],
              ['/admin/accounts', 'Accounts, approvals and audit history'],
              ['/admin/catalog', 'Catalogue admin'],
              ['/admin/communications', 'Reviews and support queue'],
              ['/notifications', 'Admin notifications'],
            ]
          : [];
  if (accountHeader && workspace === 'customer') {
    return (
      <header
        aria-label="Workspace selection"
        className="border-b border-slate-200 bg-white px-5 py-3 text-sm text-slate-950 sm:px-8 print:hidden"
      >
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 sm:gap-5">
          <Link
            className="mr-auto text-lg font-bold tracking-tight text-teal-950 sm:mr-0"
            href="/"
          >
            Vendor&apos;s Market
          </Link>
          <form
            action="/marketplace"
            className="order-last flex w-full flex-1 sm:order-none sm:min-w-40"
            role="search"
          >
            <label className="sr-only" htmlFor="account-search">
              Search products
            </label>
            <input
              id="account-search"
              name="q"
              type="search"
              placeholder="Search products..."
              className="min-w-0 flex-1 rounded-l-lg border border-slate-300 px-3 py-2"
            />
            <button
              type="submit"
              className="rounded-r-lg border border-l-0 border-slate-300 px-3 font-semibold text-teal-800 hover:bg-teal-50"
            >
              Search
            </button>
          </form>
          <nav aria-label="Quick links" className="flex items-center gap-1">
            <Link
              aria-label="Messages"
              className="rounded-lg p-2 text-slate-800 hover:bg-teal-50"
              href="/messages"
            >
              <svg
                aria-hidden="true"
                width="21"
                height="21"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="m3 7 9 6 9-6" />
              </svg>
            </Link>
            <NotificationPopover />
            <Link
              aria-label="Cart"
              className="rounded-lg p-2 text-slate-800 hover:bg-teal-50"
              href="/cart"
            >
              <svg
                aria-hidden="true"
                width="21"
                height="21"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M2 3h2l2.4 11.4a2 2 0 0 0 2 1.6h9.8a2 2 0 0 0 2-1.6L22 7H5" />
                <circle cx="9" cy="20" r="1" />
                <circle cx="19" cy="20" r="1" />
              </svg>
            </Link>
          </nav>
          <details className="relative ml-auto">
            <summary className="cursor-pointer rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 font-semibold text-teal-950">
              Your account
            </summary>
            <div className="absolute right-0 z-20 mt-2 w-64 max-w-[calc(100vw-2.5rem)] rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
              <p className="mb-3 text-sm font-semibold text-slate-950">
                {user.profile?.full_name || 'Customer'}
              </p>
              <label className="block font-semibold">
                Workspace
                <select
                  className="mt-2 w-full rounded-lg border border-slate-300 bg-white p-2 font-normal"
                  value={workspace}
                  onChange={(event) =>
                    selectWorkspace(event.target.value as Workspace)
                  }
                >
                  {availableWorkspaces(user).map((mode) => (
                    <option key={mode} value={mode}>
                      {mode.charAt(0).toUpperCase() + mode.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
              <nav
                aria-label="customer navigation"
                className="mt-3 grid gap-1 border-t border-slate-200 pt-2"
              >
                {links.map(([href, label]) => (
                  <Link
                    key={href}
                    href={href}
                    className="rounded-md px-2 py-1.5 text-slate-700 hover:bg-teal-50"
                  >
                    {label}
                  </Link>
                ))}
              </nav>
            </div>
          </details>
        </div>
      </header>
    );
  }
  return (
    <header
      aria-label="Workspace selection"
      className={`border-b px-5 py-4 text-sm text-slate-950 sm:px-8 ${workspace === 'customer' ? 'border-slate-200 bg-white' : 'border-emerald-200 bg-emerald-50'}`}
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-5 gap-y-3">
        {workspace === 'customer' && !hideBrand && (
          <Link
            className="text-lg font-bold tracking-tight text-emerald-950"
            href="/"
          >
            Vendor&apos;s Market
          </Link>
        )}
        <Link
          className="font-bold text-emerald-900 underline-offset-4 hover:underline"
          href="/"
        >
          Your account
        </Link>
        <label className="font-semibold">
          Workspace
          <select
            className="ml-2 max-w-full rounded-lg border border-emerald-200 bg-white p-2 font-normal"
            value={workspace ?? ''}
            onChange={(event) => {
              setCreating(false);
              setError('');
              setMessage('');
              selectWorkspace(event.target.value as Workspace);
            }}
          >
            <option value="" disabled>
              Select workspace
            </option>
            {availableWorkspaces(user).map((mode) => (
              <option key={mode} value={mode}>
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </option>
            ))}
          </select>
        </label>
        {!hideNavigation && <NotificationPopover />}
        {workspace === 'vendor' && (
          <>
            <label className="flex min-w-0 max-w-full items-center gap-2 font-semibold">
              Shop
              <select
                className="min-w-0 rounded-lg border border-emerald-200 bg-white p-2 font-normal"
                value={shopId ?? ''}
                disabled={loading}
                onChange={(event) => {
                  setError('');
                  setMessage('');
                  selectShop(
                    event.target.value || null,
                    shops.map((shop) => shop.id),
                  );
                }}
              >
                <option value="">Select a shop explicitly</option>
                {shops.map((shop) => (
                  <option key={shop.id} value={shop.id}>
                    {shop.name}
                    {shop.is_active === false ? ' (inactive)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <span className="text-slate-700">
              {shops.length}/3 shops (inactive shops count)
            </span>
            <button
              type="button"
              className="rounded-lg border border-emerald-800 bg-white px-3 py-2 font-semibold text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
              disabled={loading || shops.length >= 3 || busy}
              onClick={() => setCreating(!creating)}
            >
              Create shop
            </button>
            <button
              type="button"
              className="underline"
              disabled={busy}
              onClick={() => void refresh()}
            >
              Refresh shops
            </button>
          </>
        )}
      </div>
      {!hideNavigation && (
        <nav
          aria-label={`${workspace ?? 'Account'} navigation`}
          className="mx-auto mt-3 flex max-w-7xl flex-wrap gap-x-5 gap-y-2"
        >
          {links.map(([href, label]) => (
            <Link key={href} href={href} className="underline">
              {label}
            </Link>
          ))}
        </nav>
      )}
      {workspace === 'vendor' && (
        <p className="mx-auto mt-3 max-w-7xl font-semibold">
          {shopId
            ? `Working in: ${shops.find((shop) => shop.id === shopId)?.name ?? 'selected shop'}`
            : 'Select a shop above; listing and creating shops remain available.'}
        </p>
      )}
      {workspace === 'vendor' && creating && (
        <form
          aria-label="Create shop"
          className="mx-auto mt-4 grid max-w-4xl gap-3 sm:grid-cols-2"
          onSubmit={createShop}
        >
          {[
            ['name', 'Shop name', true],
            ['city', 'City', true],
            ['province', 'Province', true],
            ['address', 'Address', false],
            ['description', 'Description', false],
          ].map(([name, label, required]) => (
            <label key={String(name)}>
              {label}
              <input
                className="ml-2 rounded border p-2"
                name={String(name)}
                required={Boolean(required)}
                maxLength={name === 'description' ? 2000 : 160}
              />
            </label>
          ))}
          <button
            type="submit"
            className="rounded bg-emerald-800 p-2 text-white disabled:opacity-50"
            disabled={busy || loading || shops.length >= 3}
          >
            Save new shop
          </button>
        </form>
      )}
      {workspace === 'vendor' && (error || shopError) && (
        <p role="alert" className="mt-2 text-red-800">
          {error || shopError}
        </p>
      )}
      {workspace === 'vendor' && message && (
        <p role="status" className="mt-2">
          {message}
        </p>
      )}
    </header>
  );
}
