'use client';

import { useState } from 'react';
import {
  useNotificationInbox,
  type NotificationAction,
} from '@/lib/notification-inbox';

export type NotificationFilter = 'All' | 'Read' | 'Unread';

export function useNotifications() {
  const inbox = useNotificationInbox();
  const [filter, setFilter] = useState<NotificationFilter>('All');
  const [search, setSearch] = useState('');
  const [selection, setSelected] = useState<Set<string>>(new Set());

  const visible = inbox.notifications.filter(
    (item) =>
      (filter === 'All' || (filter === 'Read') === !!item.read_at) &&
      `${item.title} ${item.message}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const visibleIds = new Set(visible.map((item) => item.id));
  const selected = new Set(
    Array.from(selection).filter((id) => visibleIds.has(id)),
  );

  function changeFilter(value: NotificationFilter) {
    setFilter(value);
    setSelected(new Set());
  }

  function changeSearch(value: string) {
    setSearch(value);
    setSelected(new Set());
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((current) =>
      visible.every((item) => current.has(item.id))
        ? new Set()
        : new Set(visible.map((item) => item.id)),
    );
  }

  async function update(
    action: NotificationAction,
    ids = Array.from(selected),
  ) {
    const success = await inbox.update(action, ids);
    if (success) setSelected(new Set());
    return success;
  }

  return {
    ...inbox,
    visible,
    filter,
    search,
    selected,
    changeFilter,
    changeSearch,
    toggle,
    toggleAll,
    update,
  };
}
