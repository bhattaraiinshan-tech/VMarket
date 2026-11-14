import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceProvider } from '@/lib/workspace-context';
import { getWorkspaceSnapshot, selectWorkspace } from '@/lib/workspace-state';
import { testUser } from '@/test-workspace';
import ConversationPage from './messages/[conversationId]/conversation-page';

const navigation = vi.hoisted(() => ({ path: '/vendor' }));
vi.mock('next/navigation', () => ({ usePathname: () => navigation.path }));

function installFetch(
  shops = [{ id: 'shop-1', name: 'First shop', is_active: true }],
) {
  let owned = shops;
  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/me')) return Response.json(testUser);
      if (url.endsWith('/me/notifications')) return Response.json([]);
      if (url.endsWith('/vendor/shops')) {
        if (init?.method === 'POST')
          owned = [
            ...owned,
            { id: 'new-shop', name: 'New shop', is_active: true },
          ];
        return Response.json(
          init?.method === 'POST' ? owned[owned.length - 1] : owned,
        );
      }
      if (url.endsWith('/messages')) return Response.json([]);
      if (url.endsWith('/me/conversations')) return Response.json([]);
      if (url.includes('/me/conversations/'))
        return Response.json({
          id: 'conversation-1',
          current_user_id: testUser.id,
          shop_id: 'shop-1',
          shop_owner_id: 'owner-1',
          shop_name: 'Local shop',
          customer_id: testUser.id,
          customer_name: 'Test customer',
          product_id: null,
          product_name: null,
          order_id: null,
          unread_count: 0,
          last_message: null,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        });
      throw new Error(`Unexpected request: ${url}`);
    });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  navigation.path = '/vendor';
  window.history.replaceState(null, '', '/');
});

describe('workspace selection', () => {
  it.each(['/', '/orders', '/messages'])(
    'restores the standard header brand and bell when leaving notifications for %s',
    async (path) => {
      navigation.path = '/notifications';
      installFetch();
      const view = render(
        <WorkspaceProvider>
          <main>Page content</main>
        </WorkspaceProvider>,
      );
      await screen.findByText('Page content');
      expect(
        screen.queryByRole('link', { name: "Vendor's Market" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /^Notifications,/ }),
      ).not.toBeInTheDocument();

      navigation.path = path;
      view.rerender(
        <WorkspaceProvider>
          <main>Page content</main>
        </WorkspaceProvider>,
      );
      expect(
        await screen.findByRole('button', { name: 'Notifications, 0 unread' }),
      ).toHaveAttribute('aria-expanded', 'false');
      expect(
        screen.getByRole('link', { name: "Vendor's Market" }),
      ).toHaveAttribute('href', '/');

      navigation.path = '/notifications';
      view.rerender(
        <WorkspaceProvider>
          <main>Page content</main>
        </WorkspaceProvider>,
      );
      await screen.findByText('Page content');
      expect(
        screen.queryByRole('link', { name: "Vendor's Market" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /^Notifications,/ }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole('combobox', { name: 'Workspace' }),
      ).toBeInTheDocument();
    },
  );

  it.each(['/notifications', '/support'])(
    'keeps workspace and explicit shop controls while %s owns navigation',
    async (path) => {
      navigation.path = path;
      installFetch();
      render(
        <WorkspaceProvider>
          <main>Notification center content</main>
        </WorkspaceProvider>,
      );
      expect(
        await screen.findByText('Notification center content'),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('combobox', { name: 'Workspace' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('link', { name: "Vendor's Market" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /^Notifications,/ }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('navigation', { name: 'customer navigation' }),
      ).not.toBeInTheDocument();
      fireEvent.change(screen.getByRole('combobox', { name: 'Workspace' }), {
        target: { value: 'vendor' },
      });
      const shopSelector = await screen.findByRole('combobox', {
        name: 'Shop',
      });
      expect(shopSelector).toHaveValue('');
      expect(
        screen.getByRole('button', { name: 'Create shop' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('navigation', { name: 'vendor navigation' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText('Notification center content'),
      ).not.toBeInTheDocument();
    },
  );

  it('guards wrong modes, requires explicit shop selection and remounts scoped state', async () => {
    installFetch([
      { id: 'shop-1', name: 'First shop', is_active: true },
      { id: 'shop-2', name: 'Second shop', is_active: true },
    ]);
    function ScopedChild() {
      const [note, setNote] = useState('');
      return (
        <>
          <p>Scoped business data</p>
          <label>
            Private note
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
        </>
      );
    }
    render(
      <WorkspaceProvider>
        <ScopedChild />
      </WorkspaceProvider>,
    );
    expect(
      screen.getByRole('link', { name: 'Skip to content' }),
    ).toHaveAttribute('href', '#main-content');
    await screen.findByText('Select Vendor workspace to open this page.');
    expect(screen.queryByText('Scoped business data')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Workspace'), {
      target: { value: 'vendor' },
    });

    await screen.findByRole('option', { name: 'First shop' });
    expect(getWorkspaceSnapshot().shopId).toBeNull();
    expect(screen.queryByText('Scoped business data')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Shop'), {
      target: { value: 'shop-1' },
    });
    expect(await screen.findByText('Scoped business data')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Private note'), {
      target: { value: 'First shop draft' },
    });
    fireEvent.change(screen.getByLabelText('Shop'), {
      target: { value: 'shop-2' },
    });
    expect(screen.getByLabelText('Private note')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Workspace'), {
      target: { value: 'customer' },
    });
    expect(screen.queryByText('Scoped business data')).not.toBeInTheDocument();
  });

  it('moves skip-link focus past navigation to the page main content', () => {
    navigation.path = '/';
    installFetch();
    render(
      <WorkspaceProvider>
        <nav>Page navigation</nav>
        <main>Page content</main>
      </WorkspaceProvider>,
    );
    fireEvent.click(screen.getByRole('link', { name: 'Skip to content' }));
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('counts inactive shops at the three-shop cap', async () => {
    installFetch([
      { id: 'shop-1', name: 'First shop', is_active: false },
      { id: 'shop-2', name: 'Second shop', is_active: true },
      { id: 'shop-3', name: 'Third shop', is_active: true },
    ]);
    render(
      <WorkspaceProvider>
        <p>Business data</p>
      </WorkspaceProvider>,
    );
    await screen.findByLabelText('Workspace');
    fireEvent.change(screen.getByLabelText('Workspace'), {
      target: { value: 'vendor' },
    });
    expect(
      await screen.findByText('3/3 shops (inactive shops count)'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create shop' })).toBeDisabled();
  });

  it('creates a shop without a selected shop and still requires explicit selection', async () => {
    const fetch = installFetch([]);
    render(
      <WorkspaceProvider>
        <p>Business data</p>
      </WorkspaceProvider>,
    );
    await screen.findByLabelText('Workspace');
    fireEvent.change(screen.getByLabelText('Workspace'), {
      target: { value: 'vendor' },
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Create shop' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create shop' }));
    fireEvent.change(screen.getByLabelText('Shop name'), {
      target: { value: 'New shop' },
    });
    fireEvent.change(screen.getByLabelText('City'), {
      target: { value: 'Kathmandu' },
    });
    fireEvent.change(screen.getByLabelText('Province'), {
      target: { value: 'Bagmati' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save new shop' }));
    await screen.findByRole('option', { name: 'New shop' });
    expect(getWorkspaceSnapshot().shopId).toBeNull();
    const call = fetch.mock.calls.find(([, init]) => init?.method === 'POST');
    const headers = new Headers(call?.[1]?.headers);
    expect(headers.get('X-VMarket-Workspace')).toBe('vendor');
    expect(headers.has('X-VMarket-Shop-Id')).toBe(false);
  });

  it('does not follow another tab storage events', async () => {
    installFetch();
    render(
      <WorkspaceProvider>
        <p>Business data</p>
      </WorkspaceProvider>,
    );
    await screen.findByLabelText('Workspace');
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'vmarket.workspace',
        newValue: JSON.stringify({ userId: testUser.id, workspace: 'admin' }),
      }),
    );
    expect(getWorkspaceSnapshot().workspace).toBe('customer');
  });

  it('validates notification deep-link workspace and shop before mounting protected content', async () => {
    navigation.path = '/messages/conversation-1';
    window.history.replaceState(
      null,
      '',
      '/messages/conversation-1?workspace=vendor&shop_id=shop-1',
    );
    installFetch();
    render(
      <WorkspaceProvider>
        <p>Scoped messages</p>
      </WorkspaceProvider>,
    );
    expect(await screen.findByText('Scoped messages')).toBeInTheDocument();
    expect(getWorkspaceSnapshot().workspace).toBe('vendor');
    expect(getWorkspaceSnapshot().shopId).toBe('shop-1');
  });

  it('blocks forged notification shop links without mounting protected content', async () => {
    navigation.path = '/messages/conversation-1';
    window.history.replaceState(
      null,
      '',
      '/messages/conversation-1?workspace=vendor&shop_id=someone-else',
    );
    installFetch();
    render(
      <WorkspaceProvider>
        <p>Scoped messages</p>
      </WorkspaceProvider>,
    );
    await screen.findByText('Select a shop owned by your vendor profile.');
    expect(screen.queryByText('Scoped messages')).not.toBeInTheDocument();
    expect(getWorkspaceSnapshot().shopId).toBeNull();
  });

  it('uses cookie-authenticated workspace socket selectors and closes the old socket on switch', async () => {
    navigation.path = '/messages/conversation-1';
    installFetch();
    const sockets: { url: URL; close: ReturnType<typeof vi.fn> }[] = [];
    class Socket {
      close = vi.fn();
      constructor(url: URL) {
        sockets.push({ url, close: this.close });
      }
    }
    vi.stubGlobal('WebSocket', Socket);
    render(
      <WorkspaceProvider>
        <ConversationPage conversationId="conversation-1" />
      </WorkspaceProvider>,
    );
    await waitFor(() => expect(sockets.length).toBeGreaterThan(0));
    expect(sockets[0].url.searchParams.get('workspace')).toBe('customer');
    expect(sockets[0].url.searchParams.has('shop_id')).toBe(false);
    act(() => selectWorkspace('vendor'));
    await waitFor(() => expect(sockets[0].close).toHaveBeenCalled());
    await screen.findByRole('option', { name: 'First shop' });
    fireEvent.change(screen.getByLabelText('Shop'), {
      target: { value: 'shop-1' },
    });
    await waitFor(() =>
      expect(
        sockets.some(
          (socket) => socket.url.searchParams.get('shop_id') === 'shop-1',
        ),
      ).toBe(true),
    );
    expect(sockets[sockets.length - 1].url.searchParams.get('workspace')).toBe(
      'vendor',
    );
  });
});
