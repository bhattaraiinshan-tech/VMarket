'use client';

import { useState, type ReactNode } from 'react';
import { AccountShell } from '@/components/account/account-shell';
import { requestApi } from '@/lib/api';
import { useWorkspace, useWorkspaceShops } from '@/lib/workspace-context';

export default function VendorShell({
  active,
  children,
}: {
  active: 'orders' | 'tracking' | 'profile';
  children: ReactNode;
}) {
  const { user } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!user) return <p role="alert">Sign in to open the vendor workspace.</p>;

  async function signOut() {
    setBusy(true);
    setError('');
    try {
      await requestApi('/auth/logout', { method: 'POST' });
    } catch (cause: unknown) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError'))
        setError(cause instanceof Error ? cause.message : 'Sign out failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="account-dashboard mx-auto min-h-screen w-full max-w-7xl px-4 py-8 text-gray-900 sm:px-8 print:p-0">
      <AccountShell
        user={user}
        workspace="vendor"
        activePage={active}
        busy={busy}
        onSignOut={() => void signOut()}
      >
        {error && (
          <p
            role="alert"
            className="rounded-lg bg-red-50 p-4 text-sm text-red-800"
          >
            {error}
          </p>
        )}
        {children}
      </AccountShell>
    </main>
  );
}

export function VendorPageHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  const { shopId } = useWorkspace();
  const { shops } = useWorkspaceShops();
  return (
    <header className="mb-7 print:hidden" id="account-overview">
      <p className="mb-2 text-xs font-medium text-gray-500">
        Vendor workspace / {title}
      </p>
      <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-gray-500">{description}</p>
      <p className="mt-2 text-xs font-semibold text-gray-600">
        Selected shop:{' '}
        {shops.find((shop) => shop.id === shopId)?.name || 'Select a shop'}
      </p>
    </header>
  );
}
