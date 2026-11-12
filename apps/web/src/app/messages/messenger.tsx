'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import {
  requestApi,
  type Conversation,
  type ConversationMessage,
} from '@/lib/api';
import { conversationSocketUrl } from '@/lib/network';
import { useWorkspace } from '@/lib/workspace-context';
import { MessageIcon } from './message-icons';
import styles from './messenger.module.css';

function Avatar({ name, small = false }: { name: string; small?: boolean }) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('');
  return (
    <span
      aria-hidden="true"
      className={`${styles.avatar} ${small ? styles.smallAvatar : ''}`}
    >
      {initials || '?'}
    </span>
  );
}

function conversationName(conversation: Conversation, customer: boolean) {
  return customer ? conversation.shop_name : conversation.customer_name;
}

function previewTime(value: string) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
  });
}

function mergeMessages(
  current: ConversationMessage[],
  incoming: ConversationMessage[],
) {
  const messages = new Map(current.map((message) => [message.id, message]));
  incoming.forEach((message) => {
    const previous = messages.get(message.id);
    messages.set(message.id, {
      ...message,
      read_at: message.read_at ?? previous?.read_at ?? null,
    });
  });
  return Array.from(messages.values()).sort(
    (a, b) =>
      a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  );
}

function isMessage(
  value: unknown,
  conversationId: string,
): value is ConversationMessage {
  if (!value || typeof value !== 'object') return false;
  return (
    'id' in value &&
    typeof value.id === 'string' &&
    'conversation_id' in value &&
    value.conversation_id === conversationId &&
    'sender_id' in value &&
    typeof value.sender_id === 'string' &&
    'content' in value &&
    typeof value.content === 'string' &&
    'created_at' in value &&
    typeof value.created_at === 'string' &&
    !Number.isNaN(Date.parse(value.created_at)) &&
    'read_at' in value &&
    (value.read_at === null ||
      (typeof value.read_at === 'string' &&
        !Number.isNaN(Date.parse(value.read_at))))
  );
}

export default function Messenger({
  conversationId,
}: {
  conversationId?: string;
}) {
  const { user, workspace, shopId, revision } = useWorkspace();
  return (
    <MessengerWorkspace
      key={`${user?.id}:${workspace}:${shopId}:${revision}`}
      conversationId={conversationId}
    />
  );
}

function MessengerWorkspace({ conversationId }: { conversationId?: string }) {
  const { workspace } = useWorkspace();
  const customer = workspace === 'customer';
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void requestApi<Conversation[]>('/me/conversations', {
      signal: controller.signal,
    })
      .then((items) => {
        if (controller.signal.aborted) return;
        setConversations((current) => [
          ...current,
          ...items.filter(
            (item) => !current.some((existing) => existing.id === item.id),
          ),
        ]);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Conversations could not be loaded.',
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [attempt]);

  const updateConversation = useCallback((conversation: Conversation) => {
    setConversations((current) => [
      conversation,
      ...current.filter((item) => item.id !== conversation.id),
    ]);
  }, []);

  const updateMessage = useCallback((message: ConversationMessage) => {
    setConversations((current) =>
      current.map((item) =>
        item.id === message.conversation_id
          ? {
              ...item,
              unread_count: 0,
              last_message:
                !item.last_message ||
                message.created_at >= item.last_message.created_at
                  ? message
                  : item.last_message,
              updated_at:
                message.created_at > item.updated_at
                  ? message.created_at
                  : item.updated_at,
            }
          : item,
      ),
    );
  }, []);

  const filtered = conversations
    .filter((item) =>
      [
        conversationName(item, customer),
        item.last_message?.content,
        item.product_name,
      ].some((text) =>
        text?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
      ),
    )
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  return (
    <main className={styles.messenger}>
      <nav aria-label="Marketplace shortcuts" className={styles.topNav}>
        <Link href="/marketplace">
          <MessageIcon name="shop" /> Vendor&apos;s Market
        </Link>
        <span className={styles.topLinks}>
          <Link href={customer ? '/' : '/vendor'}>
            {customer ? 'My Account' : 'My Shop'}
          </Link>
          <Link href="/marketplace">Marketplace</Link>
          <Link href="/support">Need help?</Link>
        </span>
        <span className={styles.workspaceLabel}>
          {customer ? 'Customer' : 'Vendor'} workspace
        </span>
      </nav>
      <div className={styles.dashboard}>
        <div
          className={`${styles.panels} ${conversationId ? styles.hasConversation : ''}`}
        >
          <section aria-label="Conversations" className={styles.conversations}>
            <header className={styles.listHeader}>
              <h1>Messages</h1>
              {customer ? (
                <Link
                  className={styles.iconButton}
                  href="/marketplace"
                  aria-label="New chat: choose a product to message a vendor"
                  title="Start a conversation from a product page"
                >
                  <MessageIcon name="compose" />
                </Link>
              ) : (
                <span className={styles.shopLabel}>Shop inbox</span>
              )}
            </header>
            <div className={styles.search}>
              <MessageIcon name="search" width="19" height="19" />
              <input
                aria-label="Search conversations"
                type="search"
                placeholder="Search conversations..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className={styles.conversationItems}>
              {loading && (
                <p className={styles.state} role="status">
                  Loading conversations...
                </p>
              )}
              {error && (
                <div className={styles.error} role="alert">
                  {error}
                  <button
                    type="button"
                    onClick={() => {
                      setError('');
                      setLoading(true);
                      setAttempt((value) => value + 1);
                    }}
                  >
                    Try again
                  </button>
                </div>
              )}
              {!loading && !error && !conversations.length && (
                <p className={styles.state}>
                  {customer
                    ? 'No conversations yet. Message a vendor from a product page.'
                    : 'No conversations yet. Customer messages will appear here.'}
                </p>
              )}
              {!loading &&
                !error &&
                conversations.length > 0 &&
                !filtered.length && (
                  <p className={styles.state} role="status">
                    No conversations match your search.
                  </p>
                )}
              <ul>
                {filtered.map((conversation) => {
                  const name = conversationName(conversation, customer);
                  return (
                    <li key={conversation.id}>
                      <Link
                        href={`/messages/${conversation.id}`}
                        className={`${styles.conversationItem} ${conversation.id === conversationId ? styles.selected : ''} ${conversation.unread_count > 0 ? styles.unread : ''}`}
                        aria-current={
                          conversation.id === conversationId
                            ? 'page'
                            : undefined
                        }
                      >
                        <Avatar name={name} />
                        <span className={styles.conversationCopy}>
                          <span className={styles.conversationTitle}>
                            {name}
                          </span>
                          <span className={styles.preview}>
                            {conversation.last_message?.content ??
                              (conversation.product_name
                                ? `About ${conversation.product_name}`
                                : 'Conversation started')}
                          </span>
                        </span>
                        <span className={styles.conversationMeta}>
                          <time dateTime={conversation.updated_at}>
                            {previewTime(conversation.updated_at)}
                          </time>
                          {conversation.unread_count > 0 && (
                            <span
                              className={styles.badge}
                              aria-label={`${conversation.unread_count} unread messages`}
                            >
                              {conversation.unread_count}
                            </span>
                          )}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
            <p className={styles.listFooter}>
              Your conversations, all in one place.
            </p>
          </section>
          {conversationId ? (
            <ChatThread
              key={conversationId}
              conversationId={conversationId}
              onRead={updateConversation}
              onMessage={updateMessage}
            />
          ) : (
            <section className={styles.emptyThread} aria-label="Chat detail">
              <span className={styles.emptyIcon}>
                <MessageIcon name="message" width="38" height="38" />
              </span>
              <h2>A little conversation goes a long way.</h2>
              <p>
                Choose a conversation to view messages, ask a question, or keep
                up with an order.
              </p>
              {customer && (
                <Link href="/marketplace">
                  Find something local{' '}
                  <MessageIcon name="arrow" width="18" height="18" />
                </Link>
              )}
              <span className={styles.emptyFootnote}>
                Connected to your {customer ? 'customer' : 'selected shop'}{' '}
                workspace
              </span>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}

function ChatThread({
  conversationId,
  onRead,
  onMessage,
}: {
  conversationId: string;
  onRead: (conversation: Conversation) => void;
  onMessage: (message: ConversationMessage) => void;
}) {
  const { workspace, shopId, user } = useWorkspace();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [connection, setConnection] = useState<
    'connecting' | 'live' | 'offline' | 'denied'
  >('connecting');
  const [sending, setSending] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLOListElement>(null);
  const followLatest = useRef(true);
  const sendController = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let socket: WebSocket | undefined;
    let reconnectTimer: number | undefined;
    let refreshVersion = 0;
    async function refresh() {
      const version = ++refreshVersion;
      const result = await requestApi<ConversationMessage[]>(
        `/me/conversations/${conversationId}/messages`,
        { signal: controller.signal },
      );
      if (controller.signal.aborted || version !== refreshVersion) return;
      setMessages((current) => mergeMessages(current, result));
    }
    function reportError(cause: unknown) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : 'Messages could not be loaded.',
        );
    }
    function connect() {
      if (
        controller.signal.aborted ||
        (workspace !== 'customer' && workspace !== 'vendor')
      )
        return;
      const url = conversationSocketUrl(conversationId, window.location.origin);
      url.searchParams.set('workspace', workspace);
      if (workspace === 'vendor') {
        if (!shopId) return;
        url.searchParams.set('shop_id', shopId);
      }
      setConnection('connecting');
      socket = new WebSocket(url);
      socket.onopen = () => {
        if (controller.signal.aborted) return;
        setConnection('live');
        void refresh().catch(reportError);
      };
      socket.onmessage = (event) => {
        if (controller.signal.aborted) return;
        let payload: unknown;
        try {
          payload = JSON.parse(event.data);
        } catch {
          setError(
            'A live message could not be read. Reload the conversation.',
          );
          return;
        }
        if (!isMessage(payload, conversationId)) {
          setError(
            'A live message could not be read. Reload the conversation.',
          );
          return;
        }
        setMessages((current) => mergeMessages(current, [payload]));
        onMessage(payload);
        void refresh().catch(reportError);
      };
      socket.onclose = (event) => {
        if (controller.signal.aborted) return;
        const denied = event.code === 4401 || event.code === 4403;
        setConnection(denied ? 'denied' : 'offline');
        if (!denied) reconnectTimer = window.setTimeout(connect, 1500);
      };
      socket.onerror = () => socket?.close();
    }
    void Promise.all([
      requestApi<Conversation>(`/me/conversations/${conversationId}`, {
        signal: controller.signal,
      }),
      requestApi<ConversationMessage[]>(
        `/me/conversations/${conversationId}/messages`,
        { signal: controller.signal },
      ),
    ])
      .then(([detail, history]) => {
        if (controller.signal.aborted) return;
        setConversation(detail);
        setMessages(history);
        onRead({ ...detail, unread_count: 0 });
        connect();
      })
      .catch(reportError)
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      sendController.current?.abort();
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [conversationId, workspace, shopId, attempt, onRead, onMessage]);

  useEffect(() => {
    const thread = threadRef.current;
    if (thread && followLatest.current) thread.scrollTop = thread.scrollHeight;
  }, [messages]);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = content.trim();
    if (
      !normalized ||
      sending ||
      loading ||
      !conversation ||
      connection === 'denied'
    )
      return;
    const controller = new AbortController();
    sendController.current = controller;
    setSending(true);
    setError('');
    try {
      const message = await requestApi<ConversationMessage>(
        `/me/conversations/${conversationId}/messages`,
        {
          method: 'POST',
          body: JSON.stringify({ content: normalized }),
          signal: controller.signal,
        },
      );
      if (controller.signal.aborted) return;
      followLatest.current = true;
      setMessages((current) => mergeMessages(current, [message]));
      onMessage(message);
      setContent('');
      setEmojiOpen(false);
    } catch (cause: unknown) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : 'The message could not be sent.',
        );
    } finally {
      if (!controller.signal.aborted) {
        setSending(false);
        inputRef.current?.focus();
      }
    }
  }

  const name = conversation
    ? conversationName(conversation, workspace === 'customer')
    : 'Conversation';
  const ownName =
    user?.profile?.full_name ?? user?.vendor_profile?.business_name ?? 'You';
  return (
    <section className={styles.chat} aria-label="Chat detail">
      <header className={styles.chatHeader}>
        <Link
          className={`${styles.iconButton} ${styles.mobileBack}`}
          href="/messages"
          aria-label="All messages"
        >
          <MessageIcon name="back" />
        </Link>
        <Avatar name={name} />
        <div className={styles.chatIdentity}>
          <h2>{name}</h2>
          <p role="status">
            <span
              className={`${styles.connectionDot} ${connection === 'live' ? styles.live : ''}`}
            />
            {loading
              ? 'Loading conversation...'
              : !conversation
                ? 'Conversation unavailable'
                : connection === 'live'
                  ? 'Live connection'
                  : connection === 'denied'
                    ? 'Live access denied. Reload to check your session.'
                    : connection === 'offline'
                      ? 'Connection lost. Reconnecting...'
                      : 'Connecting to live messages...'}
          </p>
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.iconButton}
            disabled
            title="Voice calls are not supported"
            aria-label="Voice calls unavailable"
          >
            <MessageIcon name="phone" />
          </button>
          <button
            type="button"
            className={styles.iconButton}
            disabled
            title="Video calls are not supported"
            aria-label="Video calls unavailable"
          >
            <MessageIcon name="video" />
          </button>
          <details className={styles.options}>
            <summary
              aria-label="Conversation options"
              className={styles.iconButton}
            >
              <MessageIcon name="more" strokeWidth="3" />
            </summary>
            <div className={styles.optionsPanel}>
              <strong>About this conversation</strong>
              <p>
                Text messages are supported. Calls, attachments and image
                uploads are not available.
              </p>
              <p>
                Live connection indicates message delivery connectivity, not
                whether the other person is online. Read receipts reflect the
                latest server update.
              </p>
              {conversation?.product_name && (
                <p>Product: {conversation.product_name}</p>
              )}
              {conversation?.order_id && <p>Order reference attached</p>}
              <Link href="/support">
                Contact support{' '}
                <MessageIcon name="arrow" width="16" height="16" />
              </Link>
            </div>
          </details>
        </div>
      </header>
      {error && (
        <div role="alert" className={styles.error}>
          {error}
          <button
            type="button"
            disabled={sending}
            onClick={() => {
              setError('');
              setLoading(true);
              setAttempt((value) => value + 1);
            }}
          >
            Reload conversation
          </button>
        </div>
      )}
      <ol
        ref={threadRef}
        aria-label="Conversation messages"
        aria-busy={loading}
        aria-live="polite"
        aria-relevant="additions text"
        className={styles.thread}
        onScroll={() => {
          const thread = threadRef.current;
          if (thread)
            followLatest.current =
              thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;
        }}
      >
        {!loading && conversation && !messages.length && (
          <li className={styles.state}>
            Start the conversation. Send a message below.
          </li>
        )}
        {messages.map((message, index) => {
          const own = message.sender_id === conversation?.current_user_id;
          const date = new Date(message.created_at);
          const newDay =
            index === 0 ||
            date.toDateString() !==
              new Date(messages[index - 1].created_at).toDateString();
          return (
            <li key={message.id}>
              {newDay && (
                <div className={styles.dateDivider}>
                  <time dateTime={message.created_at}>
                    {date.toDateString() === new Date().toDateString()
                      ? 'Today, '
                      : ''}
                    {date.toLocaleDateString([], {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </time>
                </div>
              )}
              <div
                className={`${styles.messageRow} ${own ? styles.outgoing : ''}`}
              >
                <Avatar name={own ? ownName : name} small />
                <div className={styles.bubble}>
                  <p>{message.content}</p>
                  <div className={styles.messageTime}>
                    <time
                      dateTime={message.created_at}
                      title={date.toLocaleString()}
                    >
                      {date.toLocaleTimeString([], {
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </time>
                    {own && (
                      <span
                        className={message.read_at ? styles.read : ''}
                        aria-label={message.read_at ? 'Read' : 'Sent'}
                        title={
                          message.read_at
                            ? `Read ${new Date(message.read_at).toLocaleString()}`
                            : 'Sent'
                        }
                      >
                        <MessageIcon
                          name={message.read_at ? 'doubleCheck' : 'check'}
                          width="19"
                          height="16"
                        />
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {conversation?.order_id && workspace === 'customer' && (
        <div className={styles.orderContext}>
          <MessageIcon name="orders" width="17" height="17" />
          <span>Order linked to this conversation</span>
          <Link href={`/orders/${conversation.order_id}`}>
            Track Order <MessageIcon name="arrow" width="16" height="16" />
          </Link>
        </div>
      )}
      <form className={styles.composer} onSubmit={sendMessage}>
        <div className={styles.composerRow}>
          <div className={styles.inputContainer}>
            <div className={styles.emojiPicker}>
              <button
                type="button"
                className={styles.iconButton}
                aria-label="Choose emoji"
                aria-expanded={emojiOpen}
                aria-controls="message-emoji-picker"
                disabled={!conversation || loading || sending}
                onClick={() => setEmojiOpen((value) => !value)}
              >
                <MessageIcon name="smile" />
              </button>
              {emojiOpen && (
                <div
                  id="message-emoji-picker"
                  className={styles.emojiPanel}
                  role="group"
                  aria-label="Emoji picker"
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      setEmojiOpen(false);
                      event.currentTarget.parentElement
                        ?.querySelector('button')
                        ?.focus();
                    }
                  }}
                >
                  {[
                    ['😊', 'Smile'],
                    ['❤️', 'Heart'],
                    ['👍', 'Thumbs up'],
                    ['🙏', 'Thank you'],
                    ['👋', 'Wave'],
                    ['🎉', 'Celebrate'],
                  ].map(([emoji, label]) => (
                    <button
                      key={label}
                      type="button"
                      aria-label={label}
                      onClick={() => {
                        const input = inputRef.current;
                        const start = input?.selectionStart ?? content.length;
                        const end = input?.selectionEnd ?? start;
                        if (
                          content.length - (end - start) + emoji.length >
                          5000
                        ) {
                          setError(
                            'Messages can contain up to 5,000 characters.',
                          );
                          return;
                        }
                        setContent(
                          content.slice(0, start) + emoji + content.slice(end),
                        );
                        setEmojiOpen(false);
                        input?.focus();
                      }}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <label htmlFor="message-content" className="sr-only">
              Message
            </label>
            <textarea
              id="message-content"
              ref={inputRef}
              placeholder="Type a message..."
              maxLength={5000}
              required
              rows={1}
              value={content}
              readOnly={sending}
              disabled={!conversation || loading || connection === 'denied'}
              onChange={(event) => setContent(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
                if (event.key === 'Escape') setEmojiOpen(false);
              }}
              aria-describedby="message-composer-help"
            />
            <button
              type="button"
              className={styles.iconButton}
              disabled
              title="Attachments are not supported"
              aria-label="Attachments unavailable"
            >
              <MessageIcon name="clip" />
            </button>
            <button
              type="button"
              className={styles.iconButton}
              disabled
              title="Image uploads are not supported"
              aria-label="Image uploads unavailable"
            >
              <MessageIcon name="image" />
            </button>
          </div>
          <button
            className={styles.sendButton}
            type="submit"
            aria-label={sending ? 'Sending message' : 'Send message'}
            disabled={
              !conversation ||
              loading ||
              sending ||
              !content.trim() ||
              connection === 'denied'
            }
          >
            <MessageIcon name="send" width="24" height="24" />
          </button>
        </div>
        <p id="message-composer-help" className={styles.composerHelp}>
          Text messages only. Calls and uploads unavailable.{' '}
          <span>Enter to send · Shift + Enter for a new line</span>
        </p>
      </form>
    </section>
  );
}
