'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';

import { requestApi } from '@/lib/api';
import { useWorkspace, useWorkspaceShops } from '@/lib/workspace-context';
import {
  availableWorkspaces,
  selectShop,
  selectWorkspace,
  type Workspace,
} from '@/lib/workspace-state';

export default function WorkspaceSwitcher() {
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
  return (
    <header
      aria-label="Workspace selection"
      className="border-b border-emerald-200 bg-emerald-50 px-5 py-3 text-sm text-slate-950"
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-end gap-4">
        <Link className="font-bold text-emerald-900" href="/">
          Your account
        </Link>
        <label>
          Workspace
          <select
            className="ml-2 rounded border p-2"
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
        {workspace === 'vendor' && (
          <>
            <label>
              Shop
              <select
                className="ml-2 rounded border p-2"
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
            <span>{shops.length}/3 shops (inactive shops count)</span>
            <button
              type="button"
              className="rounded border border-emerald-800 px-3 py-2 disabled:opacity-50"
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
            <Link href="/vendor" className="underline">
              Vendor catalogue
            </Link>
          </>
        )}
        {workspace === 'customer' && (
          <Link href="/orders" className="underline">
            Customer orders
          </Link>
        )}
        {workspace === 'admin' && (
          <Link href="/admin/catalog" className="underline">
            Catalogue admin
          </Link>
        )}
      </div>
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
