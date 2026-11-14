'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';

import NotificationPopover from '@/components/notifications/notification-popover';
import {
  Icon,
  type IconName,
} from '@/components/notifications/notification-ui';
import { useWorkspace } from '@/lib/workspace-context';

type NavItem = { label: string; href: string; icon: IconName };

export default function SupportShell({
  children,
  search,
  onSearch,
}: {
  children: ReactNode;
  search: string;
  onSearch: (value: string) => void;
}) {
  const { workspace, user } = useWorkspace();
  const [menuOpen, setMenuOpen] = useState(false);
  const vendor = workspace === 'vendor';
  const name =
    user?.profile?.full_name ||
    user?.vendor_profile?.business_name ||
    'Your account';
  const groups: { title: string; items: NavItem[] }[] = [
    {
      title: 'Main',
      items: [
        {
          label: 'Dashboard',
          href: vendor ? '/vendor' : '/',
          icon: 'dashboard',
        },
      ],
    },
    {
      title: vendor ? 'Shop management' : 'Shopping',
      items: vendor
        ? [
            { label: 'Catalog', href: '/vendor', icon: 'products' },
            { label: 'Orders', href: '/vendor/orders', icon: 'orders' },
            { label: 'Wholesale', href: '/vendor/trade', icon: 'stock' },
            { label: 'Promotions', href: '/vendor/promotions', icon: 'offers' },
            { label: 'Reviews', href: '/vendor/reviews', icon: 'messages' },
          ]
        : [
            { label: 'Marketplace', href: '/marketplace', icon: 'products' },
            { label: 'My orders', href: '/orders', icon: 'orders' },
            { label: 'Wishlist', href: '/wishlist', icon: 'offers' },
          ],
    },
    {
      title: 'Help',
      items: [
        { label: 'Messages', href: '/messages', icon: 'messages' },
        { label: 'Settings', href: '/', icon: 'settings' },
        { label: 'Support', href: '/support', icon: 'support' },
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-[#f0eff5] p-3 text-slate-900 sm:p-6 lg:p-8">
      <div className="mx-auto grid min-h-[calc(100vh-7rem)] max-w-[1440px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/5 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="flex min-w-0 flex-col border-b border-slate-200 bg-white p-4 lg:border-b-0 lg:border-r lg:py-6">
          <div className="flex items-center justify-between gap-3">
            <Link
              href="/"
              className="flex items-center gap-2.5 px-2 text-sm font-bold tracking-tight"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-700">
                <Icon name="orders" />
              </span>
              Vendor&apos;s Market
            </Link>
            <button
              type="button"
              aria-expanded={menuOpen}
              aria-controls="support-navigation"
              onClick={() => setMenuOpen(!menuOpen)}
              className="min-h-10 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-violet-50 lg:hidden"
            >
              {menuOpen ? 'Close menu' : 'Menu'}
            </button>
          </div>
          <nav
            id="support-navigation"
            aria-label="Support workspace navigation"
            className={`${menuOpen ? 'grid' : 'hidden'} mt-5 gap-4 sm:grid-cols-3 lg:mt-8 lg:grid lg:grid-cols-1 lg:gap-6`}
          >
            {groups.map((group) => (
              <div key={group.title}>
                <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  {group.title}
                </p>
                <ul className="space-y-1">
                  {group.items.map(({ label, href, icon }) => (
                    <li key={label}>
                      <Link
                        href={href}
                        onClick={() => setMenuOpen(false)}
                        aria-current={href === '/support' ? 'page' : undefined}
                        className={`relative flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors motion-reduce:transition-none ${
                          href === '/support'
                            ? 'bg-violet-100 text-violet-800 before:absolute before:-left-4 before:h-6 before:w-1 before:rounded-r before:bg-violet-600'
                            : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950'
                        }`}
                      >
                        <Icon name={icon} className="h-[18px] w-[18px]" />
                        {label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
          <div className="mt-auto hidden pt-12 lg:block">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Icon name="support" className="h-4 w-4 text-violet-700" />
                Need support?
              </p>
              <p className="mt-2 text-xs leading-5 text-slate-600">
                Tell us what went wrong. Your requests and replies stay in one
                place.
              </p>
              <a
                href="#support-ticket"
                className="mt-2 inline-block text-xs font-semibold text-violet-700 hover:underline"
              >
                Submit a ticket &rarr;
              </a>
            </div>
          </div>
        </aside>
        <div className="min-w-0">
          <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 sm:px-7">
            <label className="order-last flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 text-slate-500 sm:order-none sm:w-64">
              <Icon name="search" className="h-4 w-4 shrink-0" />
              <span className="sr-only">Search support</span>
              <input
                type="search"
                placeholder="Search support..."
                value={search}
                onChange={(event) => onSearch(event.target.value)}
                className="min-w-0 flex-1 bg-transparent py-2.5 text-sm text-slate-900 placeholder:text-slate-500"
              />
            </label>
            <div className="ml-auto flex items-center gap-3">
              <NotificationPopover className="border border-slate-200" />
              <Link
                href="/"
                aria-label={`Your account: ${name}`}
                className="flex min-w-0 items-center gap-3 rounded-lg sm:border-l sm:border-slate-200 sm:pl-4"
              >
                <span
                  aria-hidden="true"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-violet-100 text-xs font-bold text-violet-800"
                >
                  {name
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((part) => part[0])
                    .join('')
                    .toUpperCase()}
                </span>
                <span className="hidden sm:block">
                  <span className="block max-w-36 truncate text-xs font-semibold">
                    {name}
                  </span>
                  <span className="mt-0.5 block text-[11px] capitalize text-slate-500">
                    {workspace} workspace
                  </span>
                </span>
                <Icon name="arrow" className="h-4 w-4 text-slate-400" />
              </Link>
            </div>
          </header>
          <main className="min-h-full bg-[#f7f6fc] px-4 py-6 sm:px-7 sm:py-7">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
