'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';

import { ProductReview, SupportTicket, requestApi } from '@/lib/api';

type ReviewReport = {
  id: string;
  review_id: string;
  reporter_id: string;
  reason: string;
  details: string | null;
  status: string;
  created_at: string;
  review: ProductReview;
};

export default function AdminCommunicationsPage() {
  const [reviews, setReviews] = useState<ProductReview[]>([]);
  const [reports, setReports] = useState<ReviewReport[]>([]);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [statuses, setStatuses] = useState<
    Record<string, SupportTicket['status']>
  >({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busyId, setBusyId] = useState('');

  const loadData = useCallback(async (): Promise<boolean> => {
    setError('');
    try {
      const [reviewItems, reportItems, ticketItems] = await Promise.all([
        requestApi<ProductReview[]>('/admin/reviews?status=pending'),
        requestApi<ReviewReport[]>('/admin/review-reports?status=pending'),
        requestApi<SupportTicket[]>('/admin/support-tickets'),
      ]);
      setReviews(reviewItems);
      setReports(reportItems);
      setTickets(ticketItems);
      return true;
    } catch (cause: unknown) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Communication and support queues could not be loaded.',
      );
      return false;
    }
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.all([
      requestApi<ProductReview[]>('/admin/reviews?status=pending'),
      requestApi<ReviewReport[]>('/admin/review-reports?status=pending'),
      requestApi<SupportTicket[]>('/admin/support-tickets'),
    ])
      .then(([reviewItems, reportItems, ticketItems]) => {
        if (!active) return;
        setReviews(reviewItems);
        setReports(reportItems);
        setTickets(ticketItems);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Communication and support queues could not be loaded.',
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function moderateReview(
    reviewId: string,
    status: 'visible' | 'hidden' | undefined,
    reportStatus?: 'resolved' | 'rejected',
  ) {
    setBusyId(reviewId);
    setError('');
    setMessage('');
    try {
      await requestApi<ProductReview>(`/admin/reviews/${reviewId}/moderation`, {
        method: 'PATCH',
        body: JSON.stringify({ status, report_status: reportStatus }),
      });
      if (await loadData()) setMessage('Review moderation was recorded.');
    } catch (cause: unknown) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The review could not be moderated.',
      );
    } finally {
      setBusyId('');
    }
  }

  async function resolveReport(
    report: ReviewReport,
    action: 'resolved' | 'rejected',
  ) {
    await moderateReview(
      report.review_id,
      action === 'resolved' ? 'hidden' : undefined,
      action,
    );
  }

  async function updateTicket(
    event: FormEvent<HTMLFormElement>,
    ticket: SupportTicket,
  ) {
    event.preventDefault();
    setBusyId(ticket.id);
    setError('');
    setMessage('');
    try {
      await requestApi<SupportTicket>(`/admin/support-tickets/${ticket.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: statuses[ticket.id] ?? ticket.status,
          admin_response: responses[ticket.id] ?? ticket.admin_response ?? '',
        }),
      });
      if (await loadData()) {
        setMessage('The requester was notified of the support update.');
      }
    } catch (cause: unknown) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The support ticket could not be updated.',
      );
    } finally {
      setBusyId('');
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-5 py-8 sm:px-8">
      <header className="border-b border-slate-200 pb-5">
        <Link
          className="text-sm font-semibold text-emerald-800 underline"
          href="/admin/catalog"
        >
          ← Admin catalogue
        </Link>
        <h1 className="mt-2 text-3xl font-bold text-slate-950">
          Communications and support
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
      {message && (
        <p
          className="mt-5 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-900"
          role="status"
        >
          {message}
        </p>
      )}

      <section className="mt-8">
        <h2 className="text-2xl font-bold text-slate-950">
          Reviews awaiting moderation
        </h2>
        {reviews.length ? (
          <ul className="mt-4 space-y-3">
            {reviews.map((review) => (
              <li
                className="rounded-xl border border-slate-200 bg-white p-5"
                key={review.id}
              >
                <p className="text-xs font-semibold uppercase text-emerald-800">
                  {review.product_name}
                </p>
                <h3 className="mt-2 font-semibold">{review.title}</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                  {review.body}
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  {review.customer_name} · {review.rating} / 5
                </p>
                <div className="mt-3 flex gap-4">
                  <button
                    className="text-sm font-semibold text-emerald-800 underline disabled:opacity-50"
                    disabled={busyId === review.id}
                    onClick={() =>
                      void moderateReview(review.id, 'visible', 'resolved')
                    }
                    type="button"
                  >
                    Publish
                  </button>
                  <button
                    className="text-sm font-semibold text-red-700 underline disabled:opacity-50"
                    disabled={busyId === review.id}
                    onClick={() =>
                      void moderateReview(review.id, 'hidden', 'resolved')
                    }
                    type="button"
                  >
                    Hide
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-slate-600">
            No reviews are awaiting moderation.
          </p>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-2xl font-bold text-slate-950">Reported reviews</h2>
        {reports.length ? (
          <ul className="mt-4 space-y-3">
            {reports.map((report) => (
              <li
                className="rounded-xl border border-amber-200 bg-white p-5"
                key={report.id}
              >
                <p className="font-semibold">{report.reason}</p>
                <p className="mt-2 text-sm font-semibold text-slate-900">
                  {report.review.product_name}: {report.review.title} (
                  {report.review.rating} / 5)
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
                  {report.review.body}
                </p>
                {report.details && (
                  <p className="mt-2 text-sm text-slate-700">
                    {report.details}
                  </p>
                )}
                <p className="mt-2 text-xs text-slate-500">
                  Reported {new Date(report.created_at).toLocaleString()}
                </p>
                <div className="mt-3 flex gap-4">
                  <button
                    className="text-sm font-semibold text-red-700 underline disabled:opacity-50"
                    disabled={busyId === report.review_id}
                    onClick={() => void resolveReport(report, 'resolved')}
                    type="button"
                  >
                    Hide review and resolve
                  </button>
                  <button
                    className="text-sm font-semibold text-emerald-800 underline disabled:opacity-50"
                    disabled={busyId === report.review_id}
                    onClick={() => void resolveReport(report, 'rejected')}
                    type="button"
                  >
                    Reject report
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-slate-600">
            No review reports are awaiting moderation.
          </p>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-2xl font-bold text-slate-950">
          Support tickets and disputes
        </h2>
        {tickets.length ? (
          <ul className="mt-4 space-y-4">
            {tickets.map((ticket) => (
              <li
                className="rounded-xl border border-slate-200 bg-white p-5"
                key={ticket.id}
              >
                <div className="flex flex-wrap justify-between gap-2">
                  <h3 className="font-semibold">{ticket.subject}</h3>
                  <span className="text-sm font-semibold capitalize text-emerald-900">
                    {ticket.kind} · {ticket.status.replaceAll('_', ' ')}
                  </span>
                </div>
                {ticket.order_id && (
                  <p className="mt-2 text-xs text-slate-500">
                    Order: {ticket.order_id}
                  </p>
                )}
                <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">
                  {ticket.body}
                </p>
                <form
                  className="mt-4 grid gap-3 border-t border-slate-100 pt-4"
                  onSubmit={(event) => void updateTicket(event, ticket)}
                >
                  <label className="text-sm font-semibold text-slate-800">
                    Status
                    <select
                      className="mt-1 block rounded-lg border border-slate-300 p-2"
                      onChange={(event) =>
                        setStatuses((current) => ({
                          ...current,
                          [ticket.id]: event.target
                            .value as SupportTicket['status'],
                        }))
                      }
                      value={statuses[ticket.id] ?? ticket.status}
                    >
                      <option value="open">Open</option>
                      <option value="in_progress">In progress</option>
                      <option value="resolved">Resolved</option>
                      <option value="closed">Closed</option>
                    </select>
                  </label>
                  <label className="text-sm font-semibold text-slate-800">
                    Response to requester
                    <textarea
                      className="mt-1 block w-full rounded-lg border border-slate-300 p-3 font-normal"
                      maxLength={5000}
                      onChange={(event) =>
                        setResponses((current) => ({
                          ...current,
                          [ticket.id]: event.target.value,
                        }))
                      }
                      rows={3}
                      value={
                        responses[ticket.id] ?? ticket.admin_response ?? ''
                      }
                    />
                  </label>
                  <button
                    className="justify-self-start rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    disabled={busyId === ticket.id}
                    type="submit"
                  >
                    Save and notify requester
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-slate-600">
            No open support requests.
          </p>
        )}
      </section>
    </main>
  );
}
