'use client';

import { useEffect, useRef, useState } from 'react';

import { useWorkspace } from '@/lib/workspace-context';
import type { Workspace } from '@/lib/workspace-state';
import NotificationShell from './notification-shell';
import {
  DeleteConfirmation,
  groupNotifications,
  Icon,
  NotificationRow,
  Popover,
} from '@/components/notifications/notification-ui';
import { useNotifications, type NotificationFilter } from './use-notifications';

export default function NotificationsPage() {
  const { revision, workspace, shopId } = useWorkspace();
  if (!workspace)
    return (
      <main className="p-8">Select a workspace to view notifications.</main>
    );
  // A context change also discards selections, open popovers, and pending results.
  return (
    <NotificationCenter key={revision} workspace={workspace} shopId={shopId} />
  );
}

function NotificationCenter({
  workspace,
  shopId,
}: {
  workspace: Workspace;
  shopId: string | null;
}) {
  const inbox = useNotifications();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const selectAll = useRef<HTMLInputElement>(null);
  const deleteTrigger = useRef<HTMLButtonElement>(null);
  const allSelected =
    inbox.visible.length > 0 &&
    inbox.visible.every((item) => inbox.selected.has(item.id));
  const groups = groupNotifications(inbox.visible, now);

  useEffect(() => {
    if (selectAll.current)
      selectAll.current.indeterminate = inbox.selected.size > 0 && !allSelected;
  }, [inbox.selected, allSelected]);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  function closeConfirmation() {
    setConfirmDelete(false);
    deleteTrigger.current
      ?.closest('details')
      ?.querySelector('summary')
      ?.focus();
  }

  return (
    <NotificationShell search={inbox.search} onSearch={inbox.changeSearch}>
      <main className="m-2 min-h-[640px] rounded-2xl bg-[#fafafe] px-4 pb-10 pt-6 sm:m-4 sm:px-6 sm:pt-8 lg:ml-0 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-600">
              Your activity, in one place
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-800">
              Notification
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              Stay up to date with what matters in your workspace.
            </p>
          </div>
          <span className="rounded-full border border-violet-100 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700">
            {inbox.unread} unread
          </span>
        </div>

        <div className="mb-7 mt-7 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/70 pb-5">
          <div className="flex items-center gap-3">
            <input
              ref={selectAll}
              aria-label="Select all visible notifications"
              type="checkbox"
              className="h-4 w-4 cursor-pointer !accent-violet-700"
              checked={allSelected}
              disabled={inbox.loading || inbox.busy || !inbox.visible.length}
              onChange={inbox.toggleAll}
            />
            <Popover
              label={
                <>
                  <span>
                    Select
                    {inbox.selected.size > 0 ? ` (${inbox.selected.size})` : ''}
                  </span>
                  <span aria-hidden="true">&#8964;</span>
                </>
              }
              className="bg-violet-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-800"
            >
              <p className="px-3 py-2 text-xs text-slate-500">
                {inbox.selected.size
                  ? `${inbox.selected.size} selected`
                  : 'Select notifications first'}
              </p>
              <button
                type="button"
                disabled={!inbox.selected.size || inbox.busy}
                onClick={() => void inbox.update('read')}
                className="block w-full rounded-lg px-3 py-2 text-left hover:bg-violet-50 disabled:opacity-40"
              >
                Mark as Read
              </button>
              <button
                type="button"
                disabled={!inbox.selected.size || inbox.busy}
                onClick={() => void inbox.update('unread')}
                className="block w-full rounded-lg px-3 py-2 text-left hover:bg-violet-50 disabled:opacity-40"
              >
                Mark as Unread
              </button>
              <button
                ref={deleteTrigger}
                type="button"
                disabled={!inbox.selected.size || inbox.busy}
                onClick={() => setConfirmDelete(true)}
                className="mt-1 block w-full rounded-lg border-t border-slate-100 px-3 py-2 text-left text-red-700 hover:bg-red-50 disabled:opacity-40"
              >
                Delete
              </button>
            </Popover>
            <span className="hidden text-xs text-slate-400 sm:inline">
              {inbox.selected.size
                ? `${inbox.selected.size} selected`
                : 'Manage your inbox'}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-slate-500 sm:inline">
              Filter by
            </span>
            <Popover
              align="right"
              labelText={`Filter notifications: ${inbox.filter}`}
              label={
                <>
                  <span>{inbox.filter}</span>
                  <span aria-hidden="true">&#8964;</span>
                </>
              }
              className="min-w-28 justify-between border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 hover:border-violet-300"
            >
              {(['All', 'Read', 'Unread'] satisfies NotificationFilter[]).map(
                (filter) => (
                  <button
                    key={filter}
                    type="button"
                    aria-pressed={inbox.filter === filter}
                    disabled={inbox.busy}
                    onClick={() => inbox.changeFilter(filter)}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-violet-50 disabled:opacity-40 ${inbox.filter === filter ? 'bg-violet-50 font-semibold text-violet-700' : ''}`}
                  >
                    {filter}
                    {filter === inbox.filter && (
                      <span aria-hidden="true">&#10003;</span>
                    )}
                  </button>
                ),
              )}
            </Popover>
          </div>
        </div>

        {inbox.error && (
          <div
            role="alert"
            className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-800"
          >
            <p>{inbox.error}</p>
            {!inbox.notifications.length && (
              <button
                type="button"
                className="font-semibold underline"
                onClick={inbox.retry}
              >
                Try again
              </button>
            )}
          </div>
        )}
        <p role="status" className="mb-3 text-sm text-violet-800">
          {inbox.busy ? 'Updating notifications...' : inbox.notice}
        </p>
        <section
          id="notification-list"
          aria-label="Notification timeline"
          aria-busy={inbox.loading || inbox.busy}
        >
          {inbox.loading ? (
            <div
              role="status"
              className="rounded-xl border border-slate-200 bg-white px-6 py-20 text-center text-sm text-slate-500"
            >
              <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-violet-50 text-violet-600">
                <Icon name="bell" />
              </span>
              Loading notifications...
            </div>
          ) : !inbox.notifications.length && inbox.error ? null : !inbox.visible
              .length ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-20 text-center">
              <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-violet-50 text-violet-600">
                <Icon name="bell" className="h-6 w-6" />
              </span>
              <h2 className="font-semibold text-slate-800">
                {!inbox.notifications.length
                  ? "You're all caught up"
                  : 'No matching notifications'}
              </h2>
              <p className="mt-2 text-sm text-slate-500">
                {!inbox.notifications.length
                  ? 'New updates for this workspace will appear here.'
                  : 'Try a different search or notification filter.'}
              </p>
              {!!inbox.notifications.length && (
                <button
                  type="button"
                  onClick={() => {
                    inbox.changeFilter('All');
                    inbox.changeSearch('');
                  }}
                  className="mt-4 text-sm font-semibold text-violet-700 underline"
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            groups.map(([label, items]) => (
              <section key={label} aria-label={label} className="mb-7">
                <div className="mb-3 flex items-center gap-3">
                  <h2 className="text-sm font-semibold text-slate-800">
                    {label}
                  </h2>
                  <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                    {items.length}
                  </span>
                  <span className="h-px flex-1 bg-slate-200/60" />
                </div>
                <ul className="space-y-3">
                  {items.map((item) => (
                    <NotificationRow
                      key={item.id}
                      item={item}
                      selected={inbox.selected.has(item.id)}
                      disabled={inbox.busy}
                      onSelect={() => inbox.toggle(item.id)}
                      onRead={() => void inbox.update('read', [item.id])}
                      workspace={workspace}
                      shopId={shopId}
                      now={now}
                    />
                  ))}
                </ul>
              </section>
            ))
          )}
        </section>
        {!inbox.loading && inbox.notifications.length > 0 && (
          <p className="mt-7 text-center text-xs text-slate-400">
            Showing {inbox.visible.length} of {inbox.notifications.length}{' '}
            recent notifications
            {inbox.notifications.length === 100 ? ' (latest 100)' : ''}
          </p>
        )}
        {confirmDelete && (
          <DeleteConfirmation
            count={inbox.selected.size}
            onCancel={closeConfirmation}
            onConfirm={() => {
              closeConfirmation();
              void inbox.update('delete');
            }}
          />
        )}
      </main>
    </NotificationShell>
  );
}
