'use client';

import Link from 'next/link';
import { useEffect, useRef, type ReactNode } from 'react';

import type { Notification } from '@/lib/api';
import type { Workspace } from '@/lib/workspace-state';

export type IconName =
  | 'dashboard'
  | 'orders'
  | 'offers'
  | 'products'
  | 'stock'
  | 'messages'
  | 'bell'
  | 'settings'
  | 'search'
  | 'arrow'
  | 'support';

const paths: Record<IconName, string> = {
  dashboard: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  orders: 'M6 4h12l2 17H4L6 4z M9 7V5a3 3 0 0 1 6 0v2',
  offers: 'M3 3h8l10 10-8 8L3 11V3z M7 7h.01',
  products: 'm12 3 9 5v9l-9 5-9-5V8l9-5z M3 8l9 5 9-5 M12 13v9 M7 6l10 5',
  stock: 'M3 21V8l9-5 9 5v13 M7 21V11h10v10 M7 15h10 M7 18h10',
  messages:
    'M21 15a3 3 0 0 1-3 3H8l-5 3V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v9z M7 8h10 M7 12h7',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-2 7-2 9h16c0-2-2-2-2-9 M10 21h4',
  settings:
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2',
  search: 'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0z',
  arrow: 'm9 5 7 7-7 7',
  support:
    'M4 13v-2a8 8 0 0 1 16 0v2 M4 11H2v7h4v-7H4z M20 11h2v7h-4v-7h2z M20 18a4 4 0 0 1-4 4h-4',
};

export function Icon({
  name,
  className = 'h-5 w-5',
}: {
  name: IconName;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  );
}

export function Popover({
  label,
  children,
  align = 'left',
  className = '',
  labelText,
}: {
  label: ReactNode;
  children: ReactNode;
  align?: 'left' | 'right';
  className?: string;
  labelText?: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !ref.current?.contains(event.target))
        ref.current?.removeAttribute('open');
    }
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, []);
  return (
    <details
      className="relative"
      ref={ref}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          ref.current?.removeAttribute('open');
          ref.current?.querySelector('summary')?.focus();
        }
      }}
      onClick={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest('button, a')
        ) {
          ref.current?.removeAttribute('open');
          ref.current?.querySelector('summary')?.focus();
        }
      }}
    >
      <summary
        aria-label={labelText}
        className={`flex cursor-pointer list-none items-center gap-2 rounded-lg [&::-webkit-details-marker]:hidden ${className}`}
      >
        {label}
      </summary>
      <div
        className={`absolute top-full z-30 mt-2 w-52 rounded-xl border border-slate-100 bg-white p-2 text-sm text-slate-700 shadow-xl shadow-slate-900/10 ${align === 'right' ? 'right-0' : 'left-0'}`}
      >
        {children}
      </div>
    </details>
  );
}

export function notificationIcon(item: Notification): IconName {
  return item.conversation_id ? 'messages' : item.order_id ? 'orders' : 'bell';
}

export function relativeTime(value: string, now: Date) {
  const minutes = Math.max(
    0,
    Math.floor((now.getTime() - new Date(value).getTime()) / 60000),
  );
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function groupNotifications(items: Notification[], now: Date) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const groups = new Map<string, Notification[]>();
  for (const item of [...items].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  )) {
    const date = new Date(item.created_at);
    const day = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
    ).getTime();
    const label =
      day === today.getTime()
        ? 'Today'
        : day === yesterday.getTime()
          ? 'Yesterday'
          : date.toLocaleDateString(undefined, {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            });
    groups.set(label, [...(groups.get(label) ?? []), item]);
  }
  return Array.from(groups);
}

export function NotificationMessage({ message }: { message: string }) {
  return message.split(/(#[\w-]+|\bVM-[\w-]+\b)/g).map((part, index) =>
    /^(#|VM-)/.test(part) ? (
      <span className="font-medium text-violet-700" key={index}>
        {part}
      </span>
    ) : (
      part
    ),
  );
}

export function notificationHref(
  item: Notification,
  workspace: Workspace,
  shopId: string | null,
) {
  const params = new URLSearchParams({ workspace });
  if (workspace === 'vendor' && shopId) params.set('shop_id', shopId);
  const route =
    item.conversation_id && workspace !== 'admin'
      ? `/messages/${item.conversation_id}`
      : item.order_id
        ? workspace === 'vendor'
          ? '/vendor/orders'
          : workspace === 'admin'
            ? '/admin/communications'
            : `/orders/${item.order_id}`
        : null;
  return route ? `${route}?${params}` : null;
}

export function NotificationRow({
  item,
  selected,
  disabled,
  onSelect,
  onRead,
  workspace,
  shopId,
  now,
}: {
  item: Notification;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  onRead: () => void;
  workspace: Workspace;
  shopId: string | null;
  now: Date;
}) {
  const href = notificationHref(item, workspace, shopId);
  return (
    <li
      className={`grid grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-3 rounded-xl border px-4 py-5 sm:gap-4 lg:grid-cols-[auto_auto_minmax(0,1fr)_7rem_5rem_auto] ${selected ? 'border-violet-300 bg-violet-50/60' : 'border-slate-200/80 bg-white'}`}
    >
      <input
        type="checkbox"
        aria-label={`Select ${item.title}`}
        checked={selected}
        disabled={disabled}
        onChange={onSelect}
        className="h-4 w-4 cursor-pointer rounded border-slate-300 !accent-violet-700"
      />
      <span
        aria-hidden="true"
        className={`grid h-11 w-11 place-items-center rounded-xl ${item.read_at ? 'bg-slate-100 text-slate-500' : 'bg-violet-100 text-violet-700'}`}
      >
        <Icon name={notificationIcon(item)} />
      </span>
      <div className="min-w-0">
        <p
          className={`text-sm leading-6 ${item.read_at ? 'font-medium text-slate-700' : 'font-semibold text-slate-950'}`}
        >
          {item.title}
        </p>
        <p className="mt-0.5 text-sm leading-6 text-slate-500">
          <NotificationMessage message={item.message} />
        </p>
      </div>
      <time
        dateTime={item.created_at}
        title={new Date(item.created_at).toLocaleString()}
        className="col-start-3 text-xs text-slate-500 lg:col-start-auto"
      >
        {relativeTime(item.created_at, now)}
      </time>
      <span
        className={`col-start-3 flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium lg:col-start-auto ${item.read_at ? 'bg-slate-100 text-slate-600' : 'bg-violet-50 text-violet-700'}`}
      >
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 rounded-full ${item.read_at ? 'bg-slate-400' : 'bg-violet-600'}`}
        />
        {item.read_at ? 'Read' : 'Unread'}
      </span>
      <div className="col-start-3 justify-self-end lg:col-start-auto">
        <Popover
          label="Details"
          labelText={`Details for ${item.title}`}
          align="right"
          className="bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          <p className="px-2 py-1 font-semibold text-slate-950">{item.title}</p>
          <p className="px-2 py-1 leading-6">{item.message}</p>
          <p className="px-2 py-2 text-xs text-slate-500">
            {new Date(item.created_at).toLocaleString()}
          </p>
          {href && (
            <Link
              className="block rounded-lg px-2 py-2 font-semibold text-violet-700 hover:bg-violet-50"
              href={href}
            >
              Open {item.conversation_id ? 'conversation' : 'order'}{' '}
              <span aria-hidden="true">&rarr;</span>
            </Link>
          )}
          {!item.read_at && (
            <button
              className="w-full rounded-lg px-2 py-2 text-left font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-50"
              disabled={disabled}
              onClick={onRead}
              type="button"
            >
              Mark as read
            </button>
          )}
        </Popover>
      </div>
    </li>
  );
}

export function DeleteConfirmation({
  count,
  onCancel,
  onConfirm,
}: {
  count: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="delete-title"
      aria-describedby="delete-description"
      onCancel={onCancel}
      className="w-[calc(100%-2rem)] max-w-md rounded-2xl p-6 shadow-xl backdrop:bg-slate-950/40"
    >
      <h2 id="delete-title" className="text-xl font-semibold text-slate-950">
        Delete notifications?
      </h2>
      <p
        id="delete-description"
        className="mt-3 text-sm leading-6 text-slate-600"
      >
        Permanently delete {count} selected notification{count === 1 ? '' : 's'}{' '}
        from your inbox? This cannot be undone. Your orders and messages will
        not be deleted.
      </p>
      <div className="mt-6 flex justify-end gap-3">
        <button
          autoFocus
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800"
        >
          Delete notifications
        </button>
      </div>
    </dialog>
  );
}
