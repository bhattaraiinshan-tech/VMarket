'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';

import {
  API_BASE_URL,
  Conversation,
  ConversationMessage,
  requestApi,
} from '@/lib/api';
import { useWorkspace } from '@/lib/workspace-context';

export default function ConversationPage({
  conversationId,
}: {
  conversationId: string;
}) {
  const { workspace, shopId, revision } = useWorkspace();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const [sending, setSending] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);

  const loadMessages = useCallback(async () => {
    const result = await requestApi<ConversationMessage[]>(
      `/me/conversations/${conversationId}/messages`,
    );
    setMessages(result);
  }, [conversationId]);

  useEffect(() => {
    let active = true;
    let reconnectTimer: number | undefined;
    void Promise.all([
      requestApi<Conversation>(`/me/conversations/${conversationId}`),
      requestApi<ConversationMessage[]>(
        `/me/conversations/${conversationId}/messages`,
      ),
    ])
      .then(([conversationResult, messageResults]) => {
        if (!active) return;
        setConversation(conversationResult);
        setMessages(messageResults);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : 'The conversation could not be loaded.',
          );
      });

    function connect() {
      if (!active) return;
      const url = new URL(
        `${API_BASE_URL}/communications/ws/${conversationId}`,
      );
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      if (workspace !== 'customer' && workspace !== 'vendor') return;
      url.searchParams.set('workspace', workspace);
      if (workspace === 'vendor') {
        if (!shopId) return;
        url.searchParams.set('shop_id', shopId);
      }
      const socket = new WebSocket(url);
      socketRef.current = socket;
      socket.onopen = () => {
        if (!active) return;
        setConnected(true);
        void loadMessages().catch((cause: unknown) =>
          setError(
            cause instanceof Error
              ? cause.message
              : 'Messages could not be refreshed.',
          ),
        );
      };
      socket.onmessage = (event) => {
        if (!active) return;
        try {
          const message = JSON.parse(event.data) as ConversationMessage;
          setMessages((current) =>
            current.some((item) => item.id === message.id)
              ? current
              : [...current, message],
          );
          if (message.sender_id !== conversation?.current_user_id) {
            void loadMessages().catch((cause: unknown) =>
              setError(
                cause instanceof Error
                  ? cause.message
                  : 'Messages could not be refreshed.',
              ),
            );
          }
        } catch (cause: unknown) {
          if (!(cause instanceof SyntaxError)) throw cause;
          setError(
            'A live message could not be read. Reload the conversation.',
          );
        }
      };
      socket.onclose = (event) => {
        if (active) setConnected(false);
        if (active && event.code !== 4401 && event.code !== 4403) {
          reconnectTimer = window.setTimeout(connect, 1500);
        }
      };
      socket.onerror = () => socket.close();
    }

    connect();
    return () => {
      active = false;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      socketRef.current?.close();
    };
  }, [
    conversationId,
    conversation?.current_user_id,
    loadMessages,
    workspace,
    shopId,
    revision,
  ]);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = content.trim();
    if (!normalized || sending) return;
    setSending(true);
    setError('');
    try {
      const message = await requestApi<ConversationMessage>(
        `/me/conversations/${conversationId}/messages`,
        {
          method: 'POST',
          body: JSON.stringify({ content: normalized }),
        },
      );
      setMessages((current) =>
        current.some((item) => item.id === message.id)
          ? current
          : [...current, message],
      );
      setContent('');
    } catch (cause: unknown) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The message could not be sent.',
      );
    } finally {
      setSending(false);
    }
  }

  const isCustomer = workspace === 'customer';

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col px-5 py-8 sm:px-8">
      <header className="flex items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <Link
            className="text-sm font-semibold text-emerald-800 underline"
            href="/messages"
          >
            ← All messages
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-slate-950">
            {conversation
              ? isCustomer
                ? conversation.shop_name
                : conversation.customer_name
              : 'Conversation'}
          </h1>
          {conversation?.product_name && (
            <p className="mt-1 text-sm text-slate-600">
              Product: {conversation.product_name}
            </p>
          )}
          {conversation?.order_id && (
            <p className="mt-1 text-sm text-slate-600">
              Order reference attached
            </p>
          )}
        </div>
        <span className="text-xs text-slate-500" role="status">
          {connected ? 'Live' : 'Reconnecting…'}
        </span>
      </header>
      {error && (
        <p
          className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800"
          role="alert"
        >
          {error}
        </p>
      )}
      <ol
        aria-label="Conversation messages"
        className="my-5 flex-1 space-y-3 overflow-y-auto"
      >
        {messages.map((message) => {
          const isOwnMessage =
            message.sender_id === conversation?.current_user_id;
          return (
            <li
              className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                isOwnMessage
                  ? 'ml-auto bg-emerald-800 text-white'
                  : 'bg-slate-100 text-slate-900'
              }`}
              key={message.id}
            >
              <p className="whitespace-pre-wrap break-words text-sm">
                {message.content}
              </p>
              <time
                className={`mt-2 block text-right text-[11px] ${
                  isOwnMessage ? 'text-emerald-100' : 'text-slate-500'
                }`}
                dateTime={message.created_at}
              >
                {new Date(message.created_at).toLocaleString()}
              </time>
            </li>
          );
        })}
      </ol>
      <form
        className="flex items-end gap-3 border-t border-slate-200 pt-4"
        onSubmit={sendMessage}
      >
        <label className="flex-1 text-sm font-semibold text-slate-800">
          Message
          <textarea
            className="mt-1 block w-full resize-y rounded-xl border border-slate-300 p-3 font-normal"
            maxLength={5000}
            onChange={(event) => setContent(event.target.value)}
            required
            rows={3}
            value={content}
          />
        </label>
        <button
          className="rounded-lg bg-emerald-800 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
          disabled={sending || !content.trim()}
          type="submit"
        >
          Send
        </button>
      </form>
    </main>
  );
}
