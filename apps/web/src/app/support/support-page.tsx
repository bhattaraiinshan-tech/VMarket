'use client';

import Link from 'next/link';
import { type FormEvent, useEffect, useRef, useState } from 'react';

import { type SupportTicket, requestApi } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace-context';
import SupportShell from './support-shell';
import {
  SupportChannels,
  SupportFaq,
  SupportRequestHistory,
  SupportTicketForm,
  type TicketKind,
} from './support-components';

type SupportPageProps = {
  orderId: string;
  initialKind: TicketKind;
};

export default function SupportPage(props: SupportPageProps) {
  const { workspace, user, shopId, revision } = useWorkspace();
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
    <SupportCenter
      key={`${user?.id}:${workspace}:${shopId}:${revision}:${props.orderId}:${props.initialKind}`}
      {...props}
    />
  );
}

function SupportCenter({ orderId, initialKind }: SupportPageProps) {
  const [search, setSearch] = useState('');
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [kind, setKind] = useState(initialKind);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [ticketsLoaded, setTicketsLoaded] = useState(false);
  const [loadingTickets, setLoadingTickets] = useState(true);
  const [historyAttempt, setHistoryAttempt] = useState(0);
  const submissionController = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => submissionController.current?.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void requestApi<SupportTicket[]>('/me/support-tickets', {
      signal: controller.signal,
    })
      .then((items) => {
        if (controller.signal.aborted) return;
        setTickets((current) => [
          ...current.filter(
            (ticket) => !items.some((item) => item.id === ticket.id),
          ),
          ...items,
        ]);
        setTicketsLoaded(true);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        if (cause instanceof DOMException && cause.name === 'AbortError')
          return;
        setHistoryError(
          cause instanceof Error
            ? cause.message
            : 'Your support requests could not be loaded.',
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingTickets(false);
      });
    return () => controller.abort();
  }, [historyAttempt]);

  async function submitTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      submissionController.current &&
      !submissionController.current.signal.aborted
    )
      return;
    setError('');
    setStatusMessage('');
    if (!subject.trim() || !body.trim()) {
      setError('Enter a subject and message with more than just spaces.');
      return;
    }
    if (kind === 'dispute' && !orderId) {
      setError('Open the relevant order to start a dispute.');
      return;
    }
    const controller = new AbortController();
    submissionController.current = controller;
    setSubmitting(true);
    try {
      const ticket = await requestApi<SupportTicket>('/me/support-tickets', {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({
          kind,
          order_id: orderId || null,
          subject: subject.trim(),
          body: body.trim(),
        }),
      });
      if (controller.signal.aborted) return;
      setTickets((current) => [
        ticket,
        ...current.filter((item) => item.id !== ticket.id),
      ]);
      setSubject('');
      setBody('');
      setStatusMessage('Your request was sent to the support team.');
    } catch (cause: unknown) {
      if (controller.signal.aborted) return;
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setError(
        cause instanceof Error
          ? cause.message
          : 'Your support request could not be sent.',
      );
    } finally {
      if (!controller.signal.aborted) setSubmitting(false);
      controller.abort();
    }
  }

  return (
    <SupportShell search={search} onSearch={setSearch}>
      <div className="mb-6">
        <h1 className="text-xl font-bold tracking-tight text-slate-950">
          Support Center
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Get help and find answers to your questions
        </p>
      </div>
      <SupportChannels />
      <div className="mt-5 grid items-start gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <SupportFaq search={search} onSearch={setSearch} />
        <SupportTicketForm
          orderId={orderId}
          kind={kind}
          onKindChange={setKind}
          subject={subject}
          onSubjectChange={setSubject}
          body={body}
          onBodyChange={setBody}
          submitting={submitting}
          onSubmit={submitTicket}
        >
          {error && (
            <p
              className="mt-4 rounded-lg bg-red-50 p-3 text-xs leading-5 text-red-800"
              role="alert"
            >
              {error}
            </p>
          )}
          {statusMessage && (
            <p
              className="mt-4 rounded-lg bg-emerald-50 p-3 text-xs leading-5 text-emerald-900"
              role="status"
            >
              {statusMessage}
            </p>
          )}
        </SupportTicketForm>
      </div>
      <SupportRequestHistory
        tickets={tickets}
        loading={loadingTickets}
        loaded={ticketsLoaded}
        error={historyError}
        onRetry={() => {
          setHistoryError('');
          setLoadingTickets(true);
          setHistoryAttempt((current) => current + 1);
        }}
      />
    </SupportShell>
  );
}
