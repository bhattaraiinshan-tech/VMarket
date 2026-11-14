import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { requestApi, type Notification } from '@/lib/api';
import type { Workspace } from '@/lib/workspace-state';
import NotificationsPage from './notifications-page';
import {
  groupNotifications,
  notificationHref,
  relativeTime,
} from '@/components/notifications/notification-ui';

const context = vi.hoisted(() => ({
  revision: 0,
  workspace: 'customer' as Workspace,
  shopId: null as string | null,
  user: {
    id: 'user-1',
    profile: { full_name: 'Test Customer' },
    vendor_profile: null,
  },
}));
vi.mock('@/lib/api', () => ({ requestApi: vi.fn() }));
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => context }));

const first: Notification = {
  id: 'notification-1',
  workspace: 'customer',
  shop_id: null,
  order_id: 'order-1',
  fulfillment_order_id: null,
  conversation_id: null,
  title: 'Order placed',
  message: 'Your order #254845 was placed.',
  read_at: null,
  created_at: '2026-11-14T09:00:00',
};
const second: Notification = {
  ...first,
  id: 'notification-2',
  title: 'New message',
  message: 'A shop sent a message.',
  order_id: null,
  conversation_id: 'conversation-1',
  read_at: '2026-11-13T10:00:00',
  created_at: '2026-11-13T08:00:00',
};

function installRequests(items: Notification[] = [first, second]) {
  let saved = [...items];
  vi.mocked(requestApi).mockImplementation(async (_path, options) => {
    if (options?.method !== 'POST') return saved;
    const body = JSON.parse(String(options.body)) as {
      ids: string[];
      action: string;
    };
    saved =
      body.action === 'delete'
        ? saved.filter((item) => !body.ids.includes(item.id))
        : saved.map((item) =>
            body.ids.includes(item.id)
              ? {
                  ...item,
                  read_at:
                    body.action === 'read' ? '2026-11-14T12:00:00' : null,
                }
              : item,
          );
    return saved.filter((item) => body.ids.includes(item.id));
  });
}

function openActions() {
  fireEvent.click(screen.getByText(/^Select(?: \(\d+\))?$/));
}

beforeEach(() => {
  context.revision = 0;
  context.workspace = 'customer';
  context.shopId = null;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-14T12:00:00'));
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    },
  });
  installRequests();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetAllMocks();
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});

describe('notification center', () => {
  it('renders real data, date groups, profile, statuses and workspace-aware details', async () => {
    render(<NotificationsPage />);
    expect(
      await screen.findByRole('region', { name: 'Today' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'Yesterday' }),
    ).toBeInTheDocument();
    expect(screen.getByText('#254845')).toHaveClass('text-violet-700');
    expect(screen.getByText('3 hours ago')).toBeInTheDocument();
    expect(screen.getAllByText('Test Customer').length).toBeGreaterThan(0);
    expect(
      screen.queryByRole('button', { name: /^Notifications,/ }),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('banner')).queryByText("Vendor's Market"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: "Vendor's Market" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Your profile')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Notifications' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    fireEvent.click(screen.getByLabelText('Details for Order placed'));
    expect(screen.getByRole('link', { name: /Open order/ })).toHaveAttribute(
      'href',
      '/orders/order-1?workspace=customer',
    );
  });

  it('filters and searches while clearing hidden selections', async () => {
    render(<NotificationsPage />);
    fireEvent.click(await screen.findByLabelText('Select Order placed'));
    fireEvent.click(screen.getByLabelText('Filter notifications: All'));
    fireEvent.click(screen.getByRole('button', { name: 'Read' }));
    expect(
      screen.queryByLabelText('Select Order placed'),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('Select New message')).not.toBeChecked();
    fireEvent.click(screen.getByLabelText('Filter notifications: Read'));
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: '#254845' },
    });
    expect(screen.getByLabelText('Select Order placed')).toBeInTheDocument();
    expect(
      screen.queryByLabelText('Select New message'),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'does not exist' },
    });
    expect(screen.getByText('No matching notifications')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByLabelText('Select New message')).toBeInTheDocument();
  });

  it('selects only visible rows, exposes indeterminate state and persists read/unread', async () => {
    render(<NotificationsPage />);
    fireEvent.click(await screen.findByLabelText('Select Order placed'));
    expect(
      screen.getByLabelText('Select all visible notifications'),
    ).toBePartiallyChecked();
    fireEvent.click(screen.getByLabelText('Select all visible notifications'));
    expect(screen.getByLabelText('Select New message')).toBeChecked();
    openActions();
    fireEvent.click(screen.getByRole('button', { name: 'Mark as Read' }));
    expect(
      await screen.findByText('2 notifications marked as read.'),
    ).toBeInTheDocument();
    expect(screen.getByText('0 unread')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Select Order placed'));
    openActions();
    fireEvent.click(screen.getByRole('button', { name: 'Mark as Unread' }));
    expect(
      await screen.findByText('1 notification marked as unread.'),
    ).toBeInTheDocument();
    expect(screen.getByText('1 unread')).toBeInTheDocument();
    expect(requestApi).toHaveBeenLastCalledWith(
      '/me/notifications/batch',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ ids: ['notification-1'], action: 'unread' }),
      }),
    );
  });

  it('confirms deletion, supports cancel, and leaves unrelated rows intact', async () => {
    render(<NotificationsPage />);
    fireEvent.click(await screen.findByLabelText('Select Order placed'));
    openActions();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    let dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(requestApi).toHaveBeenCalledTimes(1);
    openActions();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    dialog = screen.getByRole('dialog');
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Delete notifications' }),
    );
    expect(
      await screen.findByText('1 notification deleted.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText('Select Order placed'),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('Select New message')).toBeInTheDocument();
  });

  it('preserves rows and selections when a bulk mutation fails', async () => {
    render(<NotificationsPage />);
    fireEvent.click(await screen.findByLabelText('Select Order placed'));
    vi.mocked(requestApi).mockRejectedValueOnce(
      new Error('Update was denied.'),
    );
    openActions();
    fireEvent.click(screen.getByRole('button', { name: 'Mark as Read' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Update was denied.',
    );
    expect(screen.getByLabelText('Select Order placed')).toBeChecked();
    expect(screen.getByText('1 unread')).toBeInTheDocument();
  });

  it('reports load failures and retries without showing a successful empty state', async () => {
    vi.mocked(requestApi).mockRejectedValueOnce(
      new Error('Network unavailable.'),
    );
    render(<NotificationsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Network unavailable.',
    );
    expect(screen.queryByText("You're all caught up")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByLabelText('Select Order placed'),
    ).toBeInTheDocument();
  });

  it('shows an honest empty state and disables bulk actions without a selection', async () => {
    installRequests([]);
    render(<NotificationsPage />);
    expect(await screen.findByText("You're all caught up")).toBeInTheDocument();
    expect(
      screen.getByLabelText('Select all visible notifications'),
    ).toBeDisabled();
    openActions();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  });

  it('dismisses popovers with Escape and an outside pointer event', async () => {
    render(<NotificationsPage />);
    await screen.findByLabelText('Select Order placed');
    const filter = screen.getByLabelText('Filter notifications: All');
    fireEvent.click(filter);
    expect(filter.parentElement).toHaveAttribute('open');
    fireEvent.keyDown(filter, { key: 'Escape' });
    expect(filter.parentElement).not.toHaveAttribute('open');
    expect(filter).toHaveFocus();
    fireEvent.click(filter);
    fireEvent.pointerDown(
      screen.getByRole('heading', { name: 'Notification' }),
    );
    expect(filter.parentElement).not.toHaveAttribute('open');
  });

  it('resets selections and discards a pending response when the workspace changes', async () => {
    let resolveOld!: (items: Notification[]) => void;
    vi.mocked(requestApi).mockImplementationOnce(
      () =>
        new Promise<Notification[]>((resolve) => {
          resolveOld = resolve;
        }),
    );
    const view = render(<NotificationsPage />);
    const signal = vi.mocked(requestApi).mock.calls[0][1]?.signal;
    context.workspace = 'vendor';
    context.shopId = 'shop-2';
    context.revision++;
    installRequests([
      {
        ...second,
        title: 'Shop update',
        workspace: 'vendor',
        shop_id: 'shop-2',
      },
    ]);
    view.rerender(<NotificationsPage />);
    expect(
      await screen.findByLabelText('Select Shop update'),
    ).toBeInTheDocument();
    expect(signal?.aborted).toBe(true);
    await act(async () => resolveOld([first]));
    expect(
      screen.queryByLabelText('Select Order placed'),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Select Shop update'));
    context.shopId = 'shop-3';
    context.revision++;
    view.rerender(<NotificationsPage />);
    await waitFor(() =>
      expect(screen.getByLabelText('Select Shop update')).not.toBeChecked(),
    );
  });

  it('discards mutation results and notices after an account context change', async () => {
    const view = render(<NotificationsPage />);
    fireEvent.click(await screen.findByLabelText('Select Order placed'));
    let resolveUpdate!: (items: Notification[]) => void;
    vi.mocked(requestApi).mockImplementationOnce(
      () =>
        new Promise<Notification[]>((resolve) => {
          resolveUpdate = resolve;
        }),
    );
    openActions();
    fireEvent.click(screen.getByRole('button', { name: 'Mark as Read' }));
    const signal = vi.mocked(requestApi).mock.calls[1][1]?.signal;
    context.revision++;
    installRequests([]);
    view.rerender(<NotificationsPage />);
    expect(await screen.findByText("You're all caught up")).toBeInTheDocument();
    await act(async () =>
      resolveUpdate([{ ...first, read_at: '2026-11-14T12:00:00' }]),
    );
    expect(signal?.aborted).toBe(true);
    expect(
      screen.queryByText('1 notification marked as read.'),
    ).not.toBeInTheDocument();
  });
});

describe('notification presentation helpers', () => {
  it('uses local calendar days rather than elapsed 24-hour windows', () => {
    const now = new Date(2026, 10, 14, 0, 5);
    const groups = groupNotifications(
      [
        { ...first, created_at: new Date(2026, 10, 13, 23, 55).toISOString() },
        { ...second, created_at: new Date(2026, 10, 14, 0, 1).toISOString() },
      ],
      now,
    );
    expect(groups.map(([label]) => label)).toEqual(['Today', 'Yesterday']);
    expect(relativeTime(new Date(2026, 10, 14, 0, 4).toISOString(), now)).toBe(
      '1 minute ago',
    );
  });

  it('keeps account notices in the selected workspace and never links admin to personal messages', () => {
    expect(
      notificationHref({ ...first, workspace: 'account' }, 'vendor', 'shop-2'),
    ).toBe('/vendor/orders?workspace=vendor&shop_id=shop-2');
    expect(notificationHref(second, 'admin', null)).toBeNull();
    expect(
      notificationHref({ ...first, order_id: null }, 'customer', null),
    ).toBeNull();
  });
});
