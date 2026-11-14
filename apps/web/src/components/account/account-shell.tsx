'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import type { WorkspaceUser } from '@/lib/workspace-state';

export type AccountWorkspace = 'customer' | 'vendor';

export function AccountShell({
  user,
  workspace,
  busy,
  onSignOut,
  children,
}: {
  user: WorkspaceUser;
  workspace: AccountWorkspace | null;
  busy: boolean;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const [active, setActive] = useState('#my-details');
  useEffect(() => {
    const update = () => setActive(window.location.hash || '#my-details');
    update();
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);

  if (!workspace) return children;
  const name = user.profile?.full_name || user.vendor_profile?.business_name;
  const links = [
    ['#account-overview', 'Account overview'],
    [
      workspace === 'customer' ? '/orders' : '/vendor/orders',
      workspace === 'customer' ? 'My orders' : 'Shop orders',
    ],
    ['#my-details', 'My details'],
    ['#password', 'Change password'],
    ...(workspace === 'customer'
      ? [
          ['#address-book', 'Address book'],
          ['#payment-methods', 'Payment methods'],
        ]
      : [['#shop-details', 'Shop details']]),
    ['#communication-preferences', 'Communication preferences'],
    ['#security', 'Signed-in sessions'],
    ['/support', 'Need help?'],
  ];

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-8">
      <aside className="min-w-0 border border-slate-200 bg-white">
        <div className="flex items-center gap-4 border-b border-slate-200 p-6">
          <div
            aria-hidden="true"
            className="grid size-14 shrink-0 place-items-center rounded-full bg-slate-900 text-lg font-bold text-white"
          >
            {(name || user.email)
              .split(/\s+/)
              .slice(0, 2)
              .map((part) => part.charAt(0))
              .join('')
              .toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm text-slate-600">Hi,</p>
            <p className="break-words font-bold text-slate-950">
              {name || user.email}
            </p>
            <p className="mt-1 text-xs capitalize text-slate-600">
              {workspace} workspace
            </p>
          </div>
        </div>
        <nav
          aria-label="Account settings"
          className="grid sm:grid-cols-2 lg:grid-cols-1"
        >
          {links.map(([href, label]) => (
            <Link
              aria-current={active === href ? 'location' : undefined}
              className={`border-b border-l-4 border-b-slate-100 px-5 py-3.5 text-sm transition-colors motion-reduce:transition-none ${
                active === href
                  ? 'border-l-teal-700 bg-slate-50 font-bold text-slate-950'
                  : 'border-l-transparent text-slate-700 hover:bg-slate-50'
              }`}
              href={href}
              key={href}
              onClick={() => {
                if (href.startsWith('#')) setActive(href);
              }}
            >
              {label}
            </Link>
          ))}
          <button
            className="border-l-4 border-transparent px-5 py-4 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            disabled={busy}
            onClick={onSignOut}
            type="button"
          >
            Sign out
          </button>
        </nav>
      </aside>
      <div className="min-w-0 space-y-6">{children}</div>
    </div>
  );
}
