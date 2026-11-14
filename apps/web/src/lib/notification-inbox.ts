'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { requestApi, type Notification } from './api';

export type NotificationAction = 'read' | 'unread' | 'delete';
const changedEvent = 'vmarket:notifications-changed';

export function useNotificationInbox() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const lifetime = useRef<AbortController | null>(null);
  const loadRequest = useRef<AbortController | null>(null);
  const mutating = useRef(false);

  const refresh = useCallback((replacePending = false) => {
    const session = lifetime.current;
    if (!session || session.signal.aborted || mutating.current) return;
    if (loadRequest.current && !replacePending) return;
    loadRequest.current?.abort();
    const request = new AbortController();
    loadRequest.current = request;
    return requestApi<Notification[]>('/me/notifications', {
      signal: request.signal,
    })
      .then((items) => {
        if (request.signal.aborted || session.signal.aborted) return;
        setNotifications(items);
        setError('');
      })
      .catch((cause: unknown) => {
        if (!request.signal.aborted && !session.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Notifications could not be loaded.',
          );
      })
      .finally(() => {
        if (loadRequest.current === request) loadRequest.current = null;
        if (!request.signal.aborted && !session.signal.aborted)
          setLoading(false);
      });
  }, []);

  useEffect(() => {
    const session = new AbortController();
    lifetime.current = session;
    void refresh();
    const onFocus = () => {
      void refresh();
    };
    const onChange = () => {
      void refresh(true);
    };
    const timer = setInterval(onFocus, 60000);
    window.addEventListener('focus', onFocus);
    window.addEventListener(changedEvent, onChange);
    return () => {
      session.abort();
      loadRequest.current?.abort();
      loadRequest.current = null;
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(changedEvent, onChange);
    };
  }, [refresh]);

  async function update(
    action: NotificationAction,
    ids: string[],
  ): Promise<boolean> {
    const session = lifetime.current;
    if (!ids.length || mutating.current || !session || session.signal.aborted)
      return false;
    mutating.current = true;
    loadRequest.current?.abort();
    loadRequest.current = null;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const updated = await requestApi<Notification[]>(
        '/me/notifications/batch',
        {
          method: 'POST',
          body: JSON.stringify({ ids, action }),
          signal: session.signal,
        },
      );
      if (session.signal.aborted) return false;
      const changes = new Map(updated.map((item) => [item.id, item]));
      const affected = new Set(ids);
      setNotifications((current) =>
        action === 'delete'
          ? current.filter((item) => !affected.has(item.id))
          : current.map((item) => changes.get(item.id) ?? item),
      );
      setNotice(
        `${ids.length} notification${ids.length === 1 ? '' : 's'} ${action === 'delete' ? 'deleted' : `marked as ${action}`}.`,
      );
      window.dispatchEvent(new Event(changedEvent));
      return true;
    } catch (cause: unknown) {
      if (!session.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : 'Notifications could not be updated. Please try again.',
        );
      return false;
    } finally {
      mutating.current = false;
      if (!session.signal.aborted) {
        setLoading(false);
        setBusy(false);
      }
    }
  }

  function retry() {
    setError('');
    setLoading(true);
    void refresh(true);
  }

  return {
    notifications,
    loading,
    error,
    notice,
    busy,
    refresh,
    retry,
    update,
    unread: notifications.filter((item) => !item.read_at).length,
  };
}

export type NotificationInbox = ReturnType<typeof useNotificationInbox>;
