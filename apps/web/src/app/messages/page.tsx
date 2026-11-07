'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Conversation, requestApi } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace-context';

export default function MessagesPage() {
  const { workspace } = useWorkspace();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void requestApi<Conversation[]>('/me/conversations')
      .then((items) => {
        setConversations(items);
        setLoaded(true);
      })
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error
            ? cause.message
            : 'Conversations could not be loaded.',
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-5 py-8 sm:px-8">
      <header className="border-b border-slate-200 pb-5">
        <Link
          className="text-sm font-bold text-emerald-800"
          href="/marketplace"
        >
          Vendor&apos;s Market
        </Link>
        <h1 className="mt-2 text-3xl font-bold text-slate-950">Messages</h1>
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
          Loading conversations…
        </p>
      ) : !loaded ? null : conversations.length ? (
        <ul className="mt-6 space-y-3">
          {conversations.map((conversation) => {
            const isCustomer = workspace === 'customer';
            return (
              <li key={conversation.id}>
                <Link
                  className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 hover:border-emerald-700"
                  href={`/messages/${conversation.id}`}
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-950">
                      {isCustomer
                        ? conversation.shop_name
                        : conversation.customer_name}
                    </p>
                    <p className="mt-1 truncate text-sm text-slate-600">
                      {conversation.last_message?.content ??
                        (conversation.product_name
                          ? `About ${conversation.product_name}`
                          : 'Conversation started')}
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                      {new Date(conversation.updated_at).toLocaleString()}
                    </p>
                  </div>
                  {conversation.unread_count > 0 && (
                    <span
                      aria-label={`${conversation.unread_count} unread messages`}
                      className="rounded-full bg-emerald-800 px-2.5 py-1 text-xs font-bold text-white"
                    >
                      {conversation.unread_count}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-6 rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-600">
          {workspace === 'customer'
            ? 'No conversations yet. Message a vendor from a product page.'
            : 'No conversations yet. Customer messages will appear here.'}
        </p>
      )}
    </main>
  );
}
