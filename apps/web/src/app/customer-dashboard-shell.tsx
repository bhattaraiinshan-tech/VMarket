'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';

import { requestApi } from '@/lib/api';

const navigation = [
  {
    href: '/',
    label: 'Dashboard',
    path: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  },
  {
    href: '/orders',
    label: 'My Orders',
    path: 'M5 7h14v14H5zM9 7V5a3 3 0 0 1 6 0v2',
  },
  {
    href: '/wishlist',
    label: 'Wishlist',
    path: 'M12 20s-8-5-8-11a4 4 0 0 1 8-2 4 4 0 0 1 8 2c0 6-8 11-8 11Z',
  },
  {
    href: '/',
    label: 'Settings',
    path: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 3v2M12 19v2M3 12h2M19 12h2M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
  },
];

export function DashboardIcon({ path }: { path: string }) {
  return (
    <svg
      aria-hidden="true"
      className="h-5 w-5 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={path} />
    </svg>
  );
}

export default function CustomerDashboardShell({
  children,
  active,
}: {
  children: ReactNode;
  active: '/orders' | '/wishlist';
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function logout() {
    setBusy(true);
    setError('');
    try {
      await requestApi('/auth/logout', { method: 'POST' });
      router.push('/');
    } catch (cause: unknown) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
        setError(
          cause instanceof Error
            ? cause.message
            : 'Logout failed. Please try again.',
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F5F6FA] text-gray-900 lg:flex">
      <aside className="border-b border-[#E5E7EB] bg-white p-4 lg:w-60 lg:shrink-0 lg:border-b-0 lg:border-r lg:px-5 lg:py-8">
        <p className="mb-4 hidden px-3 text-xs font-semibold uppercase tracking-widest text-gray-500 lg:block">
          Customer workspace
        </p>
        <nav
          aria-label="Customer dashboard"
          className="flex flex-wrap gap-1 lg:flex-col lg:gap-2"
        >
          {navigation.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              aria-current={active === item.href ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium ${active === item.href ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-950'}`}
            >
              <DashboardIcon path={item.path} />
              {item.label}
            </Link>
          ))}
          <button
            type="button"
            disabled={busy}
            onClick={() => void logout()}
            className="flex items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 lg:mt-8"
          >
            <DashboardIcon path="M9 5H4v14h5M9 12h12M17 8l4 4-4 4" />
            {busy ? 'Logging out...' : 'Logout'}
          </button>
        </nav>
        {error && (
          <p
            role="alert"
            className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800"
          >
            {error}
          </p>
        )}
        <div className="mt-12 hidden rounded-xl border border-gray-200 bg-gray-50 p-4 lg:block">
          <p className="text-sm font-semibold">Need a hand?</p>
          <p className="mt-2 text-xs leading-5 text-gray-600">
            Get help with your orders and deliveries.
          </p>
          <Link
            href="/support"
            className="mt-3 inline-block text-sm font-semibold text-blue-700 hover:underline"
          >
            Contact support &rarr;
          </Link>
        </div>
      </aside>
      <main className="mx-auto w-full min-w-0 max-w-7xl px-4 py-7 sm:px-7 lg:px-10 lg:py-9">
        {children}
      </main>
    </div>
  );
}
