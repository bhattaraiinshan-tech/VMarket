'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

import type { Notification } from '@/lib/api';
import {
  useNotificationInbox,
  type NotificationInbox,
} from '@/lib/notification-inbox';
import { useWorkspace } from '@/lib/workspace-context';
import type { Workspace } from '@/lib/workspace-state';
import {
  Icon,
  NotificationMessage,
  notificationHref,
  notificationIcon,
  relativeTime,
} from './notification-ui';

export default function NotificationPopover({
  inbox,
  className = '',
}: {
  inbox?: NotificationInbox;
  className?: string;
}) {
  const { user, workspace, shopId, revision } = useWorkspace();
  if (!user || !workspace || (workspace === 'vendor' && !shopId)) return null;
  const key = `${user.id}:${workspace}:${shopId}:${revision}`;
  const props = { workspace, shopId, className };
  return inbox ? (
    <NotificationDropdown key={key} inbox={inbox} {...props} />
  ) : (
    <ConnectedNotificationDropdown key={key} {...props} />
  );
}

type DropdownProps = {
  workspace: Workspace;
  shopId: string | null;
  className: string;
};

function ConnectedNotificationDropdown(props: DropdownProps) {
  const inbox = useNotificationInbox();
  return <NotificationDropdown {...props} inbox={inbox} />;
}

function NotificationDropdown({
  inbox,
  workspace,
  shopId,
  className,
}: DropdownProps & {
  inbox: NotificationInbox;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent | FocusEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
    }
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('focusin', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('focusin', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const label = inbox.loading
    ? 'Notifications, loading'
    : inbox.error && !inbox.notifications.length
      ? 'Notifications, update unavailable'
      : `Notifications, ${inbox.unread} unread`;

  return (
    <div
      ref={root}
      className="relative shrink-0 text-left text-sm font-normal normal-case tracking-normal"
    >
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          setOpen(!open);
          if (!open) void inbox.refresh();
        }}
        className={`relative inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg p-2 text-slate-700 transition-colors hover:bg-violet-50 hover:text-violet-800 motion-reduce:transition-none ${className}`}
      >
        <Icon name="bell" />
        {inbox.unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full border-2 border-white bg-red-600 px-1 text-center text-[10px] font-bold leading-4 text-white"
          >
            {inbox.unread > 99 ? '99+' : inbox.unread}
          </span>
        )}
      </button>
      {open && (
        <NotificationPreview
          id={id}
          inbox={inbox}
          workspace={workspace}
          shopId={shopId}
          onClose={() => {
            setOpen(false);
            trigger.current?.focus();
          }}
        />
      )}
    </div>
  );
}

function NotificationPreview({
  id,
  inbox,
  workspace,
  shopId,
  onClose,
}: {
  id: string;
  inbox: NotificationInbox;
  workspace: Workspace;
  shopId: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const panel = useRef<HTMLElement>(null);
  const active = useRef(true);
  const [now, setNow] = useState(() => new Date());
  useLayoutEffect(() => {
    function align() {
      const element = panel.current;
      if (!element) return;
      element.style.transform = '';
      const rect = element.getBoundingClientRect();
      const offset = Math.max(
        16 - rect.left,
        Math.min(0, window.innerWidth - 16 - rect.right),
      );
      element.style.transform = `translateX(${offset}px)`;
    }
    align();
    window.addEventListener('resize', align);
    return () => window.removeEventListener('resize', align);
  }, []);
  useEffect(() => {
    active.current = true;
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => {
      active.current = false;
      clearInterval(timer);
    };
  }, []);
  const preview = [...inbox.notifications]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, 5);
  const params = new URLSearchParams({ workspace });
  if (workspace === 'vendor' && shopId) params.set('shop_id', shopId);
  const viewAllHref = `/notifications?${params}`;

  async function activate(item: Notification) {
    if (inbox.busy) return;
    if (!item.read_at && !(await inbox.update('read', [item.id]))) return;
    if (!active.current) return;
    const href = notificationHref(item, workspace, shopId);
    if (href) {
      onClose();
      router.push(href);
    }
  }

  return (
    <section
      ref={panel}
      id={id}
      aria-label="Recent notifications"
      className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-800 shadow-xl shadow-slate-900/15"
    >
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3.5">
        <h2 className="text-sm font-bold text-slate-900">Notifications</h2>
        <Link
          href={viewAllHref}
          onClick={onClose}
          className="text-xs font-semibold text-violet-700 underline-offset-4 hover:underline"
        >
          View all
        </Link>
      </div>
      {inbox.error && (
        <div
          role="alert"
          className="border-b border-red-100 bg-red-50 px-4 py-3 text-xs leading-5 text-red-800"
        >
          <p>{inbox.error}</p>
          <button
            type="button"
            disabled={inbox.busy}
            onClick={inbox.retry}
            className="mt-1 font-semibold underline disabled:opacity-50"
          >
            Try again
          </button>
        </div>
      )}
      <div className="max-h-[min(22rem,55dvh)] overflow-y-auto overscroll-contain">
        {inbox.loading ? (
          <p
            role="status"
            className="px-4 py-10 text-center text-sm text-slate-500"
          >
            Loading notifications...
          </p>
        ) : !preview.length ? (
          !inbox.error && (
            <div className="px-5 py-10 text-center">
              <span
                aria-hidden="true"
                className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full bg-violet-50 text-violet-700"
              >
                <Icon name="bell" />
              </span>
              <p className="text-sm font-semibold text-slate-800">
                You&apos;re all caught up.
              </p>
              <p className="mt-1 text-xs text-slate-500">
                New workspace updates will appear here.
              </p>
            </div>
          )
        ) : (
          <ul
            aria-label="Latest notifications"
            aria-busy={inbox.busy}
            className="divide-y divide-slate-100"
          >
            {preview.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  disabled={inbox.busy}
                  onClick={() => void activate(item)}
                  className={`flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-violet-100/60 disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none ${item.read_at ? 'bg-white' : 'bg-violet-50/60'}`}
                >
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg ${item.read_at ? 'bg-slate-100 text-slate-500' : 'bg-violet-100 text-violet-700'}`}
                  >
                    <Icon name={notificationIcon(item)} className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-2">
                      <span
                        className={`text-xs leading-5 ${item.read_at ? 'font-medium text-slate-700' : 'font-semibold text-slate-950'}`}
                      >
                        {item.title}
                      </span>
                      {!item.read_at && (
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-600">
                          <span className="sr-only">Unread</span>
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 line-clamp-2 text-xs leading-5 text-slate-500">
                      <NotificationMessage message={item.message} />
                    </span>
                    <time
                      dateTime={item.created_at}
                      title={new Date(item.created_at).toLocaleString()}
                      className="mt-1 block text-[11px] text-slate-500"
                    >
                      {relativeTime(item.created_at, now)}
                    </time>
                    <span className="sr-only">
                      {notificationHref(item, workspace, shopId)
                        ? 'Open details'
                        : item.read_at
                          ? 'Read notification'
                          : 'Mark as read'}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p role="status" className="sr-only">
        {inbox.busy ? 'Updating notification...' : inbox.notice}
      </p>
      <Link
        href={viewAllHref}
        onClick={onClose}
        className="block border-t border-slate-100 px-4 py-3.5 text-center text-xs font-semibold text-violet-700 hover:bg-violet-50"
      >
        View All Notifications <span aria-hidden="true">&rarr;</span>
      </Link>
      {inbox.notifications.length === 100 && (
        <p className="px-4 pb-2 text-center text-[10px] text-slate-500">
          Unread count covers the latest 100 notifications.
        </p>
      )}
    </section>
  );
}
