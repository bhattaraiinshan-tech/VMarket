import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  requestApi,
  type Conversation,
  type ConversationMessage,
} from '@/lib/api';
import { type Workspace } from '@/lib/workspace-state';
import Messenger from './messenger';

const context = vi.hoisted(() => ({
  workspace: 'customer' as Workspace,
  shopId: null as string | null,
  revision: 0,
  user: {
    id: 'customer-1',
    profile: { full_name: 'Test Customer' },
    vendor_profile: null,
  },
}));
vi.mock('@/lib/api', () => ({ requestApi: vi.fn(), API_BASE_URL: '/api/v1' }));
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => context }));

const incoming: ConversationMessage = {
  id: 'message-1',
  conversation_id: 'conversation-1',
  sender_id: 'seller-1',
  content: 'Your order is on the way.',
  read_at: null,
  created_at: '2026-11-12T08:30:00Z',
};
const outgoing: ConversationMessage = {
  ...incoming,
  id: 'message-2',
  sender_id: 'customer-1',
  content: 'Thank you for the update!',
  read_at: '2026-11-12T08:46:00Z',
  created_at: '2026-11-12T08:45:00Z',
};
const conversation: Conversation = {
  id: 'conversation-1',
  shop_id: 'shop-1',
  shop_owner_id: 'seller-1',
  shop_name: 'Local Kitchen',
  customer_id: 'customer-1',
  customer_name: 'Test Customer',
  current_user_id: 'customer-1',
  product_id: 'product-1',
  product_name: 'Local rice',
  order_id: 'order-1',
  unread_count: 2,
  last_message: incoming,
  created_at: incoming.created_at,
  updated_at: outgoing.created_at,
};
const secondConversation: Conversation = {
  ...conversation,
  id: 'conversation-2',
  shop_name: 'Mountain Books',
  unread_count: 0,
  last_message: null,
  product_name: null,
  order_id: null,
};

class Socket {
  static instances: Socket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor(public url: URL) {
    Socket.instances.push(this);
  }
}

function installRequests(
  history: ConversationMessage[] = [incoming, outgoing],
) {
  vi.mocked(requestApi).mockImplementation((path, options) => {
    if (path === '/me/conversations')
      return Promise.resolve([conversation, secondConversation]);
    if (options?.method === 'POST')
      return Promise.resolve({
        ...outgoing,
        id: 'sent-message',
        content: JSON.parse(String(options.body)).content,
        read_at: null,
      });
    if (path.endsWith('/messages')) return Promise.resolve(history);
    return Promise.resolve(
      path.endsWith('conversation-2') ? secondConversation : conversation,
    );
  });
}

beforeEach(() => {
  context.workspace = 'customer';
  context.shopId = null;
  context.revision = 0;
  Socket.instances = [];
  vi.stubGlobal('WebSocket', Socket);
  installRequests();
});
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe('messenger conversation list', () => {
  it('searches real conversations and links compose to the supported product flow', async () => {
    render(<Messenger />);
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('navigation', {
        name: 'Messages workspace navigation',
      }),
    ).not.toBeInTheDocument();
    const list = within(screen.getByRole('region', { name: 'Conversations' }));
    expect(await list.findByText('Local Kitchen')).toBeInTheDocument();
    expect(list.getByLabelText('2 unread messages')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /New chat/ })).toHaveAttribute(
      'href',
      '/marketplace',
    );
    fireEvent.change(list.getByRole('searchbox'), {
      target: { value: 'mountain' },
    });
    expect(list.queryByText('Local Kitchen')).not.toBeInTheDocument();
    expect(list.getByText('Mountain Books')).toBeInTheDocument();
    fireEvent.change(list.getByRole('searchbox'), {
      target: { value: 'not found' },
    });
    expect(list.getByRole('status')).toHaveTextContent(
      'No conversations match',
    );
    expect(
      screen.queryByText(/verified|Usually replies/i),
    ).not.toBeInTheDocument();
  });

  it('shows selected-shop customer names and keeps vendor shortcuts in vendor workspace', async () => {
    context.workspace = 'vendor';
    context.shopId = 'shop-1';
    render(<Messenger />);
    expect(await screen.findAllByText('Test Customer')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'My Shop' })).toHaveAttribute(
      'href',
      '/vendor',
    );
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'My Orders' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /New chat/ }),
    ).not.toBeInTheDocument();
  });

  it('shows request failure separately from empty state and supports retry', async () => {
    vi.mocked(requestApi).mockRejectedValueOnce(
      new Error('Network unavailable'),
    );
    render(<Messenger />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Network unavailable',
    );
    expect(screen.queryByText(/No conversations yet/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Local Kitchen')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('messenger thread', () => {
  it('renders actual read receipts, order context, unavailable actions, and sends emoji text', async () => {
    render(<Messenger conversationId="conversation-1" />);
    const thread = within(
      screen.getByRole('list', { name: 'Conversation messages' }),
    );
    expect(await thread.findByText(incoming.content)).toBeInTheDocument();
    expect(thread.getByLabelText('Read')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Track Order' })).toHaveAttribute(
      'href',
      '/orders/order-1',
    );
    expect(
      screen.getByRole('button', { name: 'Attachments unavailable' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Video calls unavailable' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Voice calls unavailable' }),
    ).toBeDisabled();
    const active = screen
      .getByRole('region', { name: 'Conversations' })
      .querySelector('[aria-current="page"]');
    expect(active).toHaveAttribute('href', '/messages/conversation-1');
    expect(
      within(active as HTMLElement).queryByLabelText('2 unread messages'),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'Great ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Choose emoji' }));
    fireEvent.click(screen.getByRole('button', { name: 'Smile' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await thread.findByText('Great 😊')).toBeInTheDocument();
    expect(thread.getByLabelText('Sent')).toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toHaveValue('');
    expect(screen.getByLabelText('Message')).toHaveFocus();
    expect(requestApi).toHaveBeenCalledWith(
      '/me/conversations/conversation-1/messages',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ content: 'Great 😊' }),
      }),
    );
  });

  it('retains the draft and reports an error when sending fails', async () => {
    render(<Messenger conversationId="conversation-1" />);
    await screen.findByText(outgoing.content);
    vi.mocked(requestApi).mockRejectedValueOnce(
      new Error('Message was not sent'),
    );
    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'Keep my draft' },
    });
    fireEvent.keyDown(screen.getByLabelText('Message'), {
      key: 'Enter',
      code: 'Enter',
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Message was not sent',
    );
    expect(screen.getByLabelText('Message')).toHaveValue('Keep my draft');
    expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled();
  });

  it('deduplicates socket echoes, rejects malformed events, and uses non-secret selectors', async () => {
    context.workspace = 'vendor';
    context.shopId = 'shop-1';
    render(<Messenger conversationId="conversation-1" />);
    await screen.findByText(outgoing.content);
    const socket = Socket.instances[0];
    expect(socket.url.searchParams.get('workspace')).toBe('vendor');
    expect(socket.url.searchParams.get('shop_id')).toBe('shop-1');
    expect(Array.from(socket.url.searchParams.keys()).sort()).toEqual([
      'shop_id',
      'workspace',
    ]);
    act(() => {
      socket.onopen?.();
    });
    expect(await screen.findByText('Live connection')).toBeInTheDocument();
    act(() => {
      socket.onmessage?.({ data: JSON.stringify(incoming) });
      socket.onmessage?.({ data: JSON.stringify(incoming) });
    });
    await waitFor(() =>
      expect(
        within(
          screen.getByRole('list', { name: 'Conversation messages' }),
        ).getAllByText(incoming.content),
      ).toHaveLength(1),
    );
    act(() =>
      socket.onmessage?.({ data: JSON.stringify({ content: 'Malformed' }) }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'A live message could not be read',
    );
    expect(
      screen.queryByRole('link', { name: 'Track Order' }),
    ).not.toBeInTheDocument();
  });

  it('closes the old socket and discards late sends when changing conversations', async () => {
    const { rerender } = render(<Messenger conversationId="conversation-1" />);
    await screen.findByText(outgoing.content);
    const socket = Socket.instances[0];
    let complete: (message: ConversationMessage) => void = () => {};
    vi.mocked(requestApi).mockImplementationOnce(
      () =>
        new Promise<ConversationMessage>((resolve) => {
          complete = resolve;
        }),
    );
    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'Private draft' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    rerender(<Messenger conversationId="conversation-2" />);
    await screen.findByRole('heading', { name: 'Mountain Books' });
    expect(socket.close).toHaveBeenCalled();
    await act(async () =>
      complete({ ...outgoing, id: 'late', content: 'Private draft' }),
    );
    expect(screen.getByLabelText('Message')).toHaveValue('');
    expect(screen.queryByText('Private draft')).not.toBeInTheDocument();
  });

  it('discards late history and clears drafts on shop changes', async () => {
    context.workspace = 'vendor';
    context.shopId = 'shop-1';
    const { rerender } = render(<Messenger conversationId="conversation-1" />);
    await screen.findByText(outgoing.content);
    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'Shop one draft' },
    });
    const oldSocket = Socket.instances[0];
    let complete: (messages: ConversationMessage[]) => void = () => {};
    vi.mocked(requestApi).mockImplementationOnce(
      () =>
        new Promise<ConversationMessage[]>((resolve) => {
          complete = resolve;
        }),
    );
    act(() => oldSocket.onopen?.());
    context.shopId = 'shop-2';
    context.revision += 1;
    rerender(<Messenger conversationId="conversation-1" />);
    await waitFor(() => expect(Socket.instances).toHaveLength(2));
    await act(async () =>
      complete([
        { ...incoming, id: 'private', content: 'Shop one private message' },
      ]),
    );
    expect(oldSocket.close).toHaveBeenCalled();
    expect(screen.getByLabelText('Message')).toHaveValue('');
    expect(
      screen.queryByText('Shop one private message'),
    ).not.toBeInTheDocument();
    expect(Socket.instances[1].url.searchParams.get('shop_id')).toBe('shop-2');
  });

  it('does not open a socket or allow sends when the conversation is forbidden', async () => {
    vi.mocked(requestApi).mockImplementation((path) =>
      path === '/me/conversations'
        ? Promise.resolve([])
        : Promise.reject(new Error('Conversation access denied')),
    );
    render(<Messenger conversationId="forbidden" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Conversation access denied',
    );
    expect(Socket.instances).toHaveLength(0);
    expect(screen.getByLabelText('Message')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    expect(screen.getByText('Conversation unavailable')).toBeInTheDocument();
  });
});
