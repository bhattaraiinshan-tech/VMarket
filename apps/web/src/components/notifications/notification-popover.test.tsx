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
import NotificationPopover from './notification-popover';

const state = vi.hoisted(() => ({
  workspace: 'customer' as Workspace | null,
  shopId: null as string | null,
  revision: 0,
  user: { id: 'user-1' } as { id: string } | null,
  push: vi.fn(),
}));
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => state }));
vi.mock('@/lib/api', () => ({ requestApi: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push }) }));

const notes: Notification[] = Array.from({ length: 6 }, (_, index) => ({
  id: `note-${index}`,
  workspace: 'customer',
  shop_id: null,
  order_id: index === 0 ? 'order-1' : null,
  conversation_id: index === 1 ? 'conversation-1' : null,
  fulfillment_order_id: null,
  title: `Update ${index}`,
  message: `Order #25484${index} has an update.`,
  read_at: index === 2 ? '2026-11-14T11:00:00Z' : null,
  created_at: `2026-11-14T0${9 - index}:00:00Z`,
}));

function installRequests(items: Notification[] = notes) {
  let saved = [...items];
  vi.mocked(requestApi).mockImplementation(async (_path, options) => {
    if (options?.method === 'POST') {
      const { ids } = JSON.parse(String(options.body)) as { ids: string[] };
      saved = saved.map((item) =>
        ids.includes(item.id)
          ? { ...item, read_at: '2026-11-14T12:00:00Z' }
          : item,
      );
      return saved.filter((item) => ids.includes(item.id));
    }
    return saved;
  });
}

async function openPopover() {
  const trigger = await screen.findByRole('button', {
    name: /^Notifications, \d+ unread/,
  });
  fireEvent.click(trigger);
  return within(screen.getByRole('region', { name: 'Recent notifications' }));
}

beforeEach(() => {
  state.workspace = 'customer';
  state.shopId = null;
  state.revision = 0;
  state.user = { id: 'user-1' };
  installRequests();
});
afterEach(() => vi.resetAllMocks());

describe('shared notification popover', () => {
  it('shows the latest five read and unread notifications, a badge, timestamps and scoped links', async () => {
    render(<NotificationPopover />);
    const panel = await openPopover();
    expect(panel.getAllByRole('listitem')).toHaveLength(5);
    expect(panel.getByText('Update 2')).toBeInTheDocument();
    expect(panel.queryByText('Update 5')).not.toBeInTheDocument();
    expect(panel.getAllByText('Unread')).toHaveLength(4);
    expect(panel.getByText('#254840')).toHaveClass('text-violet-700');
    expect(panel.getAllByRole('time')).toHaveLength(5);
    expect(
      panel.getByRole('link', { name: /View All Notifications/ }),
    ).toHaveAttribute('href', '/notifications?workspace=customer');
    const trigger = screen.getByRole('button', {
      name: 'Notifications, 5 unread',
    });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute(
      'aria-controls',
      screen.getByRole('region', { name: 'Recent notifications' }).id,
    );
  });

  it('toggles, dismisses outside clicks and Escape, restores focus, and closes on tabbing out', async () => {
    render(
      <>
        <NotificationPopover />
        <button>Other control</button>
      </>,
    );
    await openPopover();
    const trigger = screen.getByRole('button', {
      name: 'Notifications, 5 unread',
    });
    fireEvent.click(trigger);
    expect(
      screen.queryByRole('region', { name: 'Recent notifications' }),
    ).not.toBeInTheDocument();
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    fireEvent.pointerDown(
      screen.getByRole('button', { name: 'Other control' }),
    );
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    fireEvent.focusIn(screen.getByRole('button', { name: 'Other control' }));
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('waits for persistence before navigating and updates the badge', async () => {
    render(<NotificationPopover />);
    const panel = await openPopover();
    await waitFor(() => expect(requestApi).toHaveBeenCalledTimes(2));
    let resolve!: (items: Notification[]) => void;
    vi.mocked(requestApi).mockImplementationOnce(
      () =>
        new Promise<Notification[]>((done) => {
          resolve = done;
        }),
    );
    fireEvent.click(panel.getByRole('button', { name: /Update 0/ }));
    expect(state.push).not.toHaveBeenCalled();
    expect(panel.getByRole('button', { name: /Update 1/ })).toBeDisabled();
    await act(async () =>
      resolve([{ ...notes[0], read_at: '2026-11-14T12:00:00Z' }]),
    );
    expect(state.push).toHaveBeenCalledWith(
      '/orders/order-1?workspace=customer',
    );
    expect(
      screen.getByRole('button', { name: 'Notifications, 4 unread' }),
    ).toHaveAttribute('aria-expanded', 'false');
  });

  it('marks notices without a destination read in place and does not rewrite already-read notices', async () => {
    render(<NotificationPopover />);
    const panel = await openPopover();
    await waitFor(() => expect(requestApi).toHaveBeenCalledTimes(2));
    fireEvent.click(panel.getByRole('button', { name: /Update 3/ }));
    await screen.findByRole('button', { name: 'Notifications, 4 unread' });
    expect(state.push).not.toHaveBeenCalled();
    expect(panel.getAllByText('Unread')).toHaveLength(3);
    vi.mocked(requestApi).mockClear();
    fireEvent.click(panel.getByRole('button', { name: /Update 2/ }));
    expect(requestApi).not.toHaveBeenCalled();
  });

  it('does not navigate after the user dismisses a pending notification action', async () => {
    render(<NotificationPopover />);
    const panel = await openPopover();
    await waitFor(() => expect(requestApi).toHaveBeenCalledTimes(2));
    let resolve!: (items: Notification[]) => void;
    vi.mocked(requestApi).mockImplementationOnce(
      () =>
        new Promise<Notification[]>((done) => {
          resolve = done;
        }),
    );
    fireEvent.click(panel.getByRole('button', { name: /Update 0/ }));
    fireEvent.keyDown(document, { key: 'Escape' });
    await act(async () =>
      resolve([{ ...notes[0], read_at: '2026-11-14T12:00:00Z' }]),
    );
    expect(state.push).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Notifications, 4 unread' }),
    ).toHaveAttribute('aria-expanded', 'false');
  });

  it('does not let a delayed refresh overwrite a successful read', async () => {
    render(<NotificationPopover />);
    await screen.findByRole('button', { name: 'Notifications, 5 unread' });
    let resolve!: (items: Notification[]) => void;
    vi.mocked(requestApi).mockImplementationOnce(
      () =>
        new Promise<Notification[]>((done) => {
          resolve = done;
        }),
    );
    const panel = await openPopover();
    const signal = vi.mocked(requestApi).mock.calls[1][1]?.signal;
    fireEvent.click(panel.getByRole('button', { name: /Update 3/ }));
    await screen.findByRole('button', { name: 'Notifications, 4 unread' });
    await act(async () => resolve(notes));
    expect(signal?.aborted).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Notifications, 4 unread' }),
    ).toBeInTheDocument();
  });

  it('keeps failed mutations visible and does not navigate or clear unread status', async () => {
    render(<NotificationPopover />);
    const panel = await openPopover();
    await waitFor(() => expect(requestApi).toHaveBeenCalledTimes(2));
    vi.mocked(requestApi).mockRejectedValueOnce(new Error('Update denied.'));
    fireEvent.click(panel.getByRole('button', { name: /Update 0/ }));
    expect(await panel.findByRole('alert')).toHaveTextContent('Update denied.');
    expect(state.push).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Notifications, 5 unread' }),
    ).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows loading and fetch errors honestly and allows retry', async () => {
    vi.mocked(requestApi).mockRejectedValue(new Error('Inbox unavailable.'));
    render(<NotificationPopover />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Notifications, loading' }),
    );
    const panel = within(
      screen.getByRole('region', { name: 'Recent notifications' }),
    );
    expect(await panel.findByRole('alert')).toHaveTextContent(
      'Inbox unavailable.',
    );
    expect(panel.queryByText("You're all caught up.")).not.toBeInTheDocument();
    installRequests([]);
    fireEvent.click(panel.getByRole('button', { name: 'Try again' }));
    expect(await panel.findByText("You're all caught up.")).toBeInTheDocument();
    expect(
      screen
        .getByRole('button', { name: 'Notifications, 0 unread' })
        .querySelector('[aria-hidden="true"].absolute'),
    ).toBeNull();
  });

  it('requires an authenticated workspace and an explicit vendor shop before fetching', async () => {
    state.user = null;
    const view = render(<NotificationPopover />);
    expect(requestApi).not.toHaveBeenCalled();
    state.user = { id: 'user-1' };
    state.workspace = null;
    view.rerender(<NotificationPopover />);
    expect(requestApi).not.toHaveBeenCalled();
    state.workspace = 'vendor';
    view.rerender(<NotificationPopover />);
    expect(requestApi).not.toHaveBeenCalled();
    state.shopId = 'shop-2';
    state.revision++;
    view.rerender(<NotificationPopover />);
    const panel = await openPopover();
    expect(
      panel.getByRole('link', { name: /View All Notifications/ }),
    ).toHaveAttribute('href', '/notifications?workspace=vendor&shop_id=shop-2');
  });

  it('discards delayed reads and navigation when switching shop or account', async () => {
    state.workspace = 'vendor';
    state.shopId = 'shop-1';
    const view = render(<NotificationPopover />);
    const panel = await openPopover();
    await waitFor(() => expect(requestApi).toHaveBeenCalledTimes(2));
    let resolve!: (items: Notification[]) => void;
    vi.mocked(requestApi).mockImplementationOnce(
      () =>
        new Promise<Notification[]>((done) => {
          resolve = done;
        }),
    );
    fireEvent.click(panel.getByRole('button', { name: /Update 0/ }));
    const signal = vi.mocked(requestApi).mock.calls[2][1]?.signal;
    state.shopId = 'shop-2';
    state.user = { id: 'user-2' };
    state.revision++;
    installRequests([]);
    view.rerender(<NotificationPopover />);
    await screen.findByRole('button', { name: 'Notifications, 0 unread' });
    expect(signal?.aborted).toBe(true);
    await act(async () =>
      resolve([{ ...notes[0], read_at: '2026-11-14T12:00:00Z' }]),
    );
    expect(state.push).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('region', { name: 'Recent notifications' }),
    ).not.toBeInTheDocument();
  });

  it('does not expose an old inbox when a pending load finishes in another workspace', async () => {
    let resolve!: (items: Notification[]) => void;
    vi.mocked(requestApi).mockImplementationOnce(
      () =>
        new Promise<Notification[]>((done) => {
          resolve = done;
        }),
    );
    const view = render(<NotificationPopover />);
    const signal = vi.mocked(requestApi).mock.calls[0][1]?.signal;
    state.workspace = 'admin';
    state.revision++;
    installRequests([]);
    view.rerender(<NotificationPopover />);
    await screen.findByRole('button', { name: 'Notifications, 0 unread' });
    await act(async () => resolve(notes));
    expect(signal?.aborted).toBe(true);
    expect(
      screen.queryByRole('button', { name: 'Notifications, 5 unread' }),
    ).not.toBeInTheDocument();
  });

  it('updates another mounted header instance after a successful read', async () => {
    render(
      <>
        <NotificationPopover />
        <NotificationPopover />
      </>,
    );
    await screen.findAllByRole('button', { name: 'Notifications, 5 unread' });
    const triggers = screen.getAllByRole('button', {
      name: 'Notifications, 5 unread',
    });
    fireEvent.click(triggers[0]);
    const panel = within(
      screen.getByRole('region', { name: 'Recent notifications' }),
    );
    await waitFor(() => expect(requestApi).toHaveBeenCalledTimes(3));
    fireEvent.click(panel.getByRole('button', { name: /Update 3/ }));
    await waitFor(() =>
      expect(
        screen.getAllByRole('button', { name: 'Notifications, 4 unread' }),
      ).toHaveLength(2),
    );
  });

  it('refreshes on window focus, and aborts in-flight refreshes on unmount', async () => {
    const view = render(<NotificationPopover />);
    await screen.findByRole('button', { name: 'Notifications, 5 unread' });
    installRequests([]);
    fireEvent(window, new Event('focus'));
    await screen.findByRole('button', { name: 'Notifications, 0 unread' });
    let resolve!: (items: Notification[]) => void;
    vi.mocked(requestApi).mockImplementationOnce(
      () =>
        new Promise<Notification[]>((done) => {
          resolve = done;
        }),
    );
    fireEvent(window, new Event('focus'));
    const signal = vi.mocked(requestApi).mock.calls.at(-1)?.[1]?.signal;
    view.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => resolve(notes));
  });
});
