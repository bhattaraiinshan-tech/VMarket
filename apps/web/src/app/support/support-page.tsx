'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';

import { SupportTicket, requestApi } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace-context';

export default function SupportPage({
  orderId,
  initialKind,
}: {
  orderId: string;
  initialKind: 'support' | 'dispute';
}) {
  const { workspace } = useWorkspace();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [kind, setKind] = useState(initialKind);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [ticketsLoaded, setTicketsLoaded] = useState(false);
  const [loadingTickets, setLoadingTickets] = useState(true);

  useEffect(() => {
    if (workspace === 'admin') return;
    let active = true;
    void requestApi<SupportTicket[]>('/me/support-tickets')
      .then((items) => {
        if (active) {
          setTickets((current) => [
            ...current.filter(
              (ticket) => !items.some((item) => item.id === ticket.id),
            ),
            ...items,
          ]);
          setTicketsLoaded(true);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Your support requests could not be loaded.',
          );
        }
      })
      .finally(() => {
        if (active) setLoadingTickets(false);
      });
    return () => {
      active = false;
    };
  }, [workspace]);

  async function submitTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    setStatusMessage('');
    try {
      const ticket = await requestApi<SupportTicket>('/me/support-tickets', {
        method: 'POST',
        body: JSON.stringify({
          kind,
          order_id: orderId || null,
          subject,
          body,
        }),
      });
      setTickets((current) => [ticket, ...current]);
      setSubject('');
      setBody('');
      setStatusMessage('Your request was sent to the support team.');
    } catch (cause: unknown) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Your support request could not be sent.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (workspace === 'admin')
    return (
      <main className="mx-auto max-w-4xl px-5 py-8">
        <h1 className="text-2xl font-bold">Administrator support</h1>
        <p className="mt-3">
          Personal support tickets require Customer or Vendor workspace.
        </p>
        <Link
          className="mt-3 block text-emerald-800 underline"
          href="/admin/communications"
        >
          Open platform support and moderation queue
        </Link>
      </main>
    );
  return (
    <main className="mx-auto min-h-screen max-w-4xl px-5 py-8 sm:px-8">
      <header className="border-b border-slate-200 pb-5">
        <Link
          className="text-sm font-bold text-emerald-800"
          href="/marketplace"
        >
          Vendor&apos;s Market
        </Link>
        <h1 className="mt-2 text-3xl font-bold text-slate-950">
          Support and disputes
        </h1>
      </header>
      {error && (
        <p
          className="mt-5 rounded-lg bg-red-50 p-4 text-sm text-red-800"
          role="alert"
        >
          {error}
        </p>
      )}
      {statusMessage && (
        <p
          className="mt-5 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-900"
          role="status"
        >
          {statusMessage}
        </p>
      )}
      <form
        className="mt-6 grid gap-4 rounded-2xl border border-slate-200 bg-white p-5"
        onSubmit={submitTicket}
      >
        <label className="text-sm font-semibold text-slate-800">
          Request type
          <select
            className="mt-1 block w-full rounded-lg border border-slate-300 p-2"
            onChange={(event) =>
              setKind(event.target.value as 'support' | 'dispute')
            }
            value={kind}
          >
            <option value="support">General support</option>
            <option value="dispute">Order dispute</option>
          </select>
        </label>
        {orderId && (
          <p className="text-sm text-slate-600">
            Order reference: <span className="font-mono">{orderId}</span>
          </p>
        )}
        {kind === 'dispute' && !orderId && (
          <p className="text-sm text-amber-800" role="alert">
            Start an order dispute from the relevant order page so the order can
            be securely linked.
          </p>
        )}
        <label className="text-sm font-semibold text-slate-800">
          Subject
          <input
            className="mt-1 block w-full rounded-lg border border-slate-300 p-2"
            maxLength={160}
            onChange={(event) => setSubject(event.target.value)}
            required
            value={subject}
          />
        </label>
        <label className="text-sm font-semibold text-slate-800">
          Details
          <textarea
            className="mt-1 block w-full rounded-lg border border-slate-300 p-2 font-normal"
            maxLength={5000}
            onChange={(event) => setBody(event.target.value)}
            required
            rows={5}
            value={body}
          />
        </label>
        <button
          className="justify-self-start rounded-lg bg-emerald-800 px-4 py-2 font-semibold text-white disabled:opacity-50"
          disabled={submitting || (kind === 'dispute' && !orderId)}
          type="submit"
        >
          {submitting ? 'Sending…' : 'Send to support'}
        </button>
      </form>
      <section className="mt-10">
        <h2 className="text-2xl font-bold text-slate-950">Your requests</h2>
        {loadingTickets ? (
          <p className="mt-3 text-sm text-slate-600" role="status">
            Loading your requests…
          </p>
        ) : !ticketsLoaded && tickets.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">
            Your request history is unavailable.
          </p>
        ) : tickets.length ? (
          <>
            {!ticketsLoaded && (
              <p className="mt-3 text-sm text-slate-600">
                Earlier request history is unavailable.
              </p>
            )}
            <ul className="mt-4 space-y-3">
              {tickets.map((ticket) => (
                <li
                  className="rounded-xl border border-slate-200 bg-white p-5"
                  key={ticket.id}
                >
                  <div className="flex flex-wrap justify-between gap-2">
                    <h3 className="font-semibold">{ticket.subject}</h3>
                    <span className="text-sm font-semibold capitalize text-emerald-900">
                      {ticket.status.replaceAll('_', ' ')}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                    {ticket.body}
                  </p>
                  {ticket.admin_response && (
                    <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-800">
                      Support response: {ticket.admin_response}
                    </p>
                  )}
                  <p className="mt-3 text-xs capitalize text-slate-500">
                    {ticket.kind} ·{' '}
                    {new Date(ticket.created_at).toLocaleString()}
                  </p>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-3 text-sm text-slate-600">
            You have no support requests.
          </p>
        )}
      </section>
    </main>
  );
}
