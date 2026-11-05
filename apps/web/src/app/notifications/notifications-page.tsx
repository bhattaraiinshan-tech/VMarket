'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Notification, requestApi } from '@/lib/api';

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');

  useEffect(() => {
    void requestApi<Notification[]>('/me/notifications')
      .then(setNotifications)
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error
            ? cause.message
            : 'Notifications could not be loaded.',
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  async function markRead(notification: Notification) {
    setBusyId(notification.id);
    setError('');
    try {
      const updated = await requestApi<Notification>(
        `/me/notifications/${notification.id}/read`,
        { method: 'PATCH' },
      );
      setNotifications((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (cause: unknown) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The notification could not be updated.',
      );
    } finally {
      setBusyId('');
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-5 py-8 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <Link
            className="text-sm font-bold text-emerald-800"
            href="/marketplace"
          >
            Vendor&apos;s Market
          </Link>
          <h1 className="mt-2 text-3xl font-bold text-slate-950">
            Notifications
          </h1>
        </div>
        <div className="flex gap-4 text-sm font-semibold text-emerald-800">
          <Link href="/orders">Customer orders</Link>
          <Link href="/vendor/orders">Vendor fulfillment</Link>
        </div>
      </header>
      {error && (
        <p
          className="mt-5 rounded-lg bg-red-50 p-4 text-sm text-red-800"
          role="alert"
        >
          {error}
        </p>
      )}
      {loading ? (
        <p className="py-12 text-center text-slate-600" role="status">
          Loading notifications…
        </p>
      ) : notifications.length === 0 ? (
        <p className="mt-7 rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-600">
          You have no order notifications.
        </p>
      ) : (
        <ul className="mt-7 space-y-3">
          {notifications.map((notification) => (
            <li
              className={`rounded-xl border bg-white p-4 ${notification.read_at ? 'border-slate-200' : 'border-emerald-300'}`}
              key={notification.id}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-950">
                    {notification.title}
                  </p>
                  <p className="mt-1 text-sm text-slate-700">
                    {notification.message}
                  </p>
                  <p className="mt-2 text-xs text-slate-500">
                    {new Date(notification.created_at).toLocaleString()}
                  </p>
                </div>
                {!notification.read_at && (
                  <button
                    className="text-sm font-semibold text-emerald-800 underline disabled:opacity-50"
                    disabled={busyId === notification.id}
                    onClick={() => void markRead(notification)}
                    type="button"
                  >
                    Mark as read
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
