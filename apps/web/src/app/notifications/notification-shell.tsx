'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

import type { NotificationInbox } from '@/lib/notification-inbox';
import NotificationPopover from '@/components/notifications/notification-popover';
import { useWorkspace } from '@/lib/workspace-context';
import {
  Icon,
  Popover,
  type IconName,
} from '@/components/notifications/notification-ui';

type NavItem = [string, string, IconName];

export default function NotificationShell({
  children,
  inbox,
  search,
  onSearch,
}: {
  children: ReactNode;
  inbox: NotificationInbox;
  search: string;
  onSearch: (value: string) => void;
}) {
  const { workspace, user } = useWorkspace();
  const links: NavItem[] =
    workspace === 'vendor'
      ? [
          ['Dashboard', '/vendor', 'dashboard'],
          ['Orders', '/vendor/orders', 'orders'],
          ['Offers', '/vendor/promotions', 'offers'],
          ['Stock & wholesale', '/vendor/trade', 'stock'],
          ['Messages', '/messages', 'messages'],
          ['Notifications', '/notifications', 'bell'],
          ['Support', '/support', 'support'],
        ]
      : workspace === 'admin'
        ? [
            ['Dashboard', '/admin/operations', 'dashboard'],
            ['Products', '/admin/catalog', 'products'],
            ['Accounts', '/admin/accounts', 'settings'],
            ['Support & reviews', '/admin/communications', 'messages'],
            ['Notifications', '/notifications', 'bell'],
          ]
        : [
            ['Dashboard', '/', 'dashboard'],
            ['Orders', '/orders', 'orders'],
            ['Products', '/marketplace', 'products'],
            ['Messages', '/messages', 'messages'],
            ['Notifications', '/notifications', 'bell'],
            ['Support', '/support', 'support'],
          ];
  const name =
    user?.profile?.full_name ||
    user?.vendor_profile?.business_name ||
    'Your account';
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top_left,_#e8ddff,_#f3f4fa_65%)] px-3 py-5 text-slate-800 sm:px-6 sm:py-8 lg:px-10 lg:py-12">
      <div className="mx-auto grid min-h-[760px] max-w-[1440px] grid-cols-1 rounded-3xl border border-white/80 bg-white shadow-2xl shadow-violet-950/5 lg:grid-cols-[216px_minmax(0,1fr)]">
        <aside className="min-w-0 border-b border-slate-100 px-4 py-6 lg:border-b-0 lg:py-9">
          <Link
            href="/"
            className="flex items-center gap-2.5 px-3 text-sm font-extrabold tracking-tight text-slate-800"
          >
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-violet-700 text-white">
              <Icon name="orders" />
            </span>
            Vendor&apos;s Market
          </Link>
          <p className="mb-3 mt-8 px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
            {workspace} workspace
          </p>
          <nav
            aria-label="Notification workspace navigation"
            className="flex gap-1 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible"
          >
            {links.map(([label, href, icon]) => (
              <Link
                key={label}
                href={href}
                aria-current={href === '/notifications' ? 'page' : undefined}
                className={`relative flex shrink-0 items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium ${href === '/notifications' ? 'bg-violet-100 text-violet-800 before:absolute before:-left-4 before:h-6 before:w-1 before:rounded-r before:bg-violet-700' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}`}
              >
                <Icon name={icon} className="h-[18px] w-[18px]" />
                {label}
              </Link>
            ))}
          </nav>
          <Link
            href="/"
            className="mt-7 hidden items-center gap-3 px-3 py-3 text-sm text-slate-500 hover:text-violet-700 lg:flex"
          >
            <Icon name="settings" className="h-[18px] w-[18px]" />
            Account & settings
          </Link>
          <Link
            href="/marketplace"
            className="mt-2 hidden items-center gap-3 px-3 py-3 text-sm text-slate-500 hover:text-violet-700 lg:flex"
          >
            <Icon name="arrow" className="h-[18px] w-[18px] rotate-180" />
            Back to marketplace
          </Link>
        </aside>
        <div className="min-w-0">
          <header className="flex flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-8 lg:py-7">
            <label className="order-last flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 text-slate-400 sm:order-none sm:w-72">
              <Icon name="search" className="h-4 w-4 shrink-0" />
              <span className="sr-only">Search notifications</span>
              <input
                type="search"
                placeholder="Search notifications..."
                value={search}
                onChange={(event) => onSearch(event.target.value)}
                className="min-w-0 flex-1 bg-transparent py-2.5 text-sm text-slate-800 outline-offset-4 placeholder:text-slate-400"
              />
            </label>
            <div className="ml-auto flex items-center gap-4">
              <NotificationPopover inbox={inbox} className="bg-slate-100" />
              <Popover
                align="right"
                labelText="Your profile"
                className="text-sm font-semibold text-slate-800"
                label={
                  <>
                    <span
                      aria-hidden="true"
                      className="grid h-9 w-9 place-items-center rounded-lg bg-amber-100 text-xs font-bold text-amber-900"
                    >
                      {initials}
                    </span>
                    <span className="hidden max-w-40 truncate sm:block">
                      {name}
                    </span>
                    <span
                      aria-hidden="true"
                      className="ml-1 text-xs text-slate-400"
                    >
                      &#8964;
                    </span>
                  </>
                }
              >
                <p className="break-words px-3 py-2 font-semibold text-slate-900">
                  {name}
                </p>
                <Link
                  className="block rounded-lg px-3 py-2 hover:bg-violet-50"
                  href="/"
                >
                  Your account & settings
                </Link>
              </Popover>
            </div>
          </header>
          {children}
        </div>
      </div>
    </div>
  );
}
