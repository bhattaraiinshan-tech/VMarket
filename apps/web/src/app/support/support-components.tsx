'use client';

import { useId, useState, type FormEvent, type ReactNode } from 'react';

import type { SupportTicket } from '@/lib/api';
import { Icon } from '@/components/notifications/notification-ui';

export type TicketKind = 'support' | 'dispute';
type SupportSymbolName = 'chat' | 'email' | 'phone' | 'help' | 'send';

function SupportSymbol({ name }: { name: SupportSymbolName }) {
  const paths: Record<SupportSymbolName, string> = {
    chat: 'M21 11.5a8.5 8.5 0 0 1-12 7.7L3 21l1.8-6A8.5 8.5 0 1 1 21 11.5Z',
    email: 'M3 5h18v14H3z m0 1 9 7 9-7',
    phone:
      'm8 3 2 5-3 2a14 14 0 0 0 7 7l2-3 5 2v3a2 2 0 0 1-2 2A18 18 0 0 1 3 5a2 2 0 0 1 2-2h3Z',
    help: 'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2-3 4 M12 17h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
    send: 'm22 2-7 20-4-9-9-4 20-7Z M22 2 11 13',
  };
  return (
    <svg
      aria-hidden="true"
      className="h-5 w-5 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  );
}

function CardHeading({
  icon,
  title,
  subtitle,
  tone,
}: {
  icon: SupportSymbolName;
  title: string;
  subtitle: string;
  tone: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span
        className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${tone}`}
      >
        <SupportSymbol name={icon} />
      </span>
      <div>
        <h2 className="text-sm font-semibold text-slate-950">{title}</h2>
        <p className="mt-1 text-xs leading-5 text-slate-600">{subtitle}</p>
      </div>
    </div>
  );
}

export function SupportChannels() {
  const channels = [
    {
      icon: 'chat',
      title: 'Live Chat',
      description: 'Live chat is not available.',
      action: 'Start Chat',
      tone: 'bg-violet-50 text-violet-700',
    },
    {
      icon: 'email',
      title: 'Email Support',
      description: 'No verified support email yet.',
      action: 'Send Email',
      tone: 'bg-emerald-50 text-emerald-700',
    },
    {
      icon: 'phone',
      title: 'Phone Support',
      description: 'No verified support number yet.',
      action: 'Call Now',
      tone: 'bg-blue-50 text-blue-700',
    },
  ] satisfies {
    icon: SupportSymbolName;
    title: string;
    description: string;
    action: string;
    tone: string;
  }[];

  return (
    <section
      aria-label="Support channels"
      className="grid gap-4 md:grid-cols-3"
    >
      {channels.map((channel) => (
        <article
          key={channel.icon}
          className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-900/[0.02] xl:p-5"
        >
          <CardHeading
            icon={channel.icon}
            title={channel.title}
            subtitle={channel.description}
            tone={channel.tone}
          />
          <div className="mt-3 flex flex-wrap items-center gap-3 pl-[52px]">
            <button
              type="button"
              disabled
              aria-describedby={`channel-${channel.icon}-status`}
              className="min-h-9 rounded-md border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-500 disabled:cursor-not-allowed"
            >
              {channel.action}
            </button>
            <span
              id={`channel-${channel.icon}-status`}
              className="text-[11px] text-slate-500"
            >
              Unavailable
            </span>
          </div>
        </article>
      ))}
      <p className="text-xs leading-5 text-slate-600 md:col-span-3">
        Need help now?{' '}
        <a
          href="#support-ticket"
          className="font-semibold text-violet-700 underline underline-offset-2"
        >
          Submit a ticket
        </a>{' '}
        to contact our support team.
      </p>
    </section>
  );
}

const faqs = [
  {
    id: 'tracking',
    question: 'How do I track my order?',
    answer:
      'Open My orders, select your order, and check each shop shipment for its latest status, courier details, and tracking number when supplied by the vendor. Updates are recorded by the vendor, not a live courier feed.',
  },
  {
    id: 'dispute',
    question: 'How do I report a problem with an order?',
    answer:
      'Open the relevant order and follow its support or dispute link. This securely links your request to the order. Include the issue and any useful details, then check Your requests here for a reply.',
  },
  {
    id: 'payment',
    question: 'Which payment methods are available?',
    answer:
      'Checkout currently supports cash on delivery only. The order summary shows the amount due and delivery charges before you place your order.',
  },
  {
    id: 'returns',
    question: 'Can I cancel or return an order?',
    answer:
      'Customers can cancel before dispatch and request a return after delivery within the applicable return window. Open the order to see the actions and eligibility supplied by the current policy. Exchanges are not currently available.',
  },
  {
    id: 'shops',
    question: 'How do I switch between my shops?',
    answer:
      'Select Vendor in the workspace selector, then explicitly select a shop. Orders, messages, notifications, and support requests are scoped to that shop. You can own up to three shops, including inactive shops.',
  },
  {
    id: 'password',
    question: 'How do I reset my password?',
    answer:
      'Open Your account and use the password recovery option on the sign-in screen. Follow the password-reset link sent to your registered email address to choose a new password.',
  },
];

export function SupportFaq({
  search,
  onSearch,
}: {
  search: string;
  onSearch: (value: string) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>('tracking');
  const id = useId();
  const query = search.trim().toLowerCase();
  const filtered = faqs.filter((faq) =>
    `${faq.question} ${faq.answer}`.toLowerCase().includes(query),
  );

  return (
    <section
      aria-label="Frequently Asked Questions"
      className="min-w-0 rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-900/[0.02] sm:p-5"
    >
      <CardHeading
        icon="help"
        title="Frequently Asked Questions"
        subtitle="Find quick answers to common questions"
        tone="bg-rose-50 text-rose-600"
      />
      <label className="mt-5 flex items-center gap-2 rounded-lg bg-slate-50 px-3 text-slate-500">
        <Icon name="search" className="h-4 w-4 shrink-0" />
        <span className="sr-only">Search FAQs</span>
        <input
          type="search"
          placeholder="Search FAQs..."
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          className="min-w-0 flex-1 bg-transparent py-3 text-xs text-slate-900 placeholder:text-slate-500"
        />
      </label>
      <div className="mt-4 space-y-2">
        {filtered.map((faq) => {
          const open = expanded === faq.id;
          const answerId = `${id}-${faq.id}-answer`;
          const questionId = `${id}-${faq.id}-question`;
          return (
            <div key={faq.id} className="rounded-lg border border-slate-200">
              <h3>
                <button
                  type="button"
                  id={questionId}
                  aria-expanded={open}
                  aria-controls={answerId}
                  onClick={() => setExpanded(open ? null : faq.id)}
                  className="flex min-h-12 w-full items-center justify-between gap-3 rounded-lg px-3.5 py-3 text-left text-xs font-medium leading-5 text-slate-950 hover:bg-slate-50"
                >
                  {faq.question}
                  <Icon
                    name="arrow"
                    className={`h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform motion-reduce:transition-none ${open ? '-rotate-90' : 'rotate-90'}`}
                  />
                </button>
              </h3>
              <div
                id={answerId}
                role="region"
                aria-labelledby={questionId}
                hidden={!open}
              >
                <p className="px-3.5 pb-3.5 text-xs leading-relaxed text-slate-600">
                  {faq.answer}
                </p>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <p
            role="status"
            className="rounded-lg border border-dashed border-slate-200 p-5 text-sm text-slate-600"
          >
            No FAQs match your search. Try another term or submit a ticket.
          </p>
        )}
      </div>
    </section>
  );
}

export function SupportTicketForm({
  orderId,
  kind,
  onKindChange,
  subject,
  onSubjectChange,
  body,
  onBodyChange,
  submitting,
  onSubmit,
  children,
}: {
  orderId: string;
  kind: TicketKind;
  onKindChange: (value: TicketKind) => void;
  subject: string;
  onSubjectChange: (value: string) => void;
  body: string;
  onBodyChange: (value: string) => void;
  submitting: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
}) {
  const inputStyle =
    'mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-xs font-normal text-slate-900 shadow-sm placeholder:text-slate-500 disabled:bg-slate-50';
  return (
    <section
      id="support-ticket"
      aria-label="Submit a Ticket"
      className="min-w-0 scroll-mt-6 self-start rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-900/[0.02] sm:p-5"
    >
      <CardHeading
        icon="chat"
        title="Submit a Ticket"
        subtitle="Our team will reply to your request here"
        tone="bg-orange-50 text-orange-600"
      />
      {children}
      <form
        className="mt-5 space-y-4"
        onSubmit={onSubmit}
        aria-busy={submitting}
      >
        <label className="block text-xs font-medium text-slate-800">
          Request type
          <select
            className={inputStyle}
            disabled={submitting}
            value={kind}
            onChange={(event) =>
              onKindChange(
                event.target.value === 'dispute' ? 'dispute' : 'support',
              )
            }
          >
            <option value="support">General support</option>
            <option value="dispute">Order dispute</option>
          </select>
        </label>
        {orderId && (
          <p className="break-all text-xs text-slate-600">
            Order reference: <span className="font-mono">{orderId}</span>
          </p>
        )}
        {kind === 'dispute' && !orderId && (
          <p
            className="rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900"
            role="alert"
          >
            Start an order dispute from the relevant order page so the order can
            be securely linked.
          </p>
        )}
        <label className="block text-xs font-medium text-slate-800">
          Subject
          <input
            className={inputStyle}
            placeholder="Brief description of your issue"
            maxLength={160}
            onChange={(event) => onSubjectChange(event.target.value)}
            required
            disabled={submitting}
            value={subject}
          />
        </label>
        <label className="block text-xs font-medium text-slate-800">
          Message
          <textarea
            className={`${inputStyle} min-h-36 resize-y`}
            placeholder="Describe your issue in detail..."
            maxLength={5000}
            onChange={(event) => onBodyChange(event.target.value)}
            required
            disabled={submitting}
            rows={6}
            value={body}
          />
        </label>
        <button
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-3 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
          disabled={submitting || (kind === 'dispute' && !orderId)}
          type="submit"
        >
          <SupportSymbol name="send" />
          {submitting ? 'Submitting...' : 'Submit Ticket'}
        </button>
      </form>
      <p className="mt-4 flex items-start gap-2 border-t border-slate-200 pt-4 text-[11px] leading-5 text-slate-600">
        <span
          aria-hidden="true"
          className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500"
        />
        Follow replies and status updates in Your requests below.
      </p>
    </section>
  );
}

export function SupportRequestHistory({
  tickets,
  loading,
  loaded,
  error,
  onRetry,
}: {
  tickets: SupportTicket[];
  loading: boolean;
  loaded: boolean;
  error: string;
  onRetry: () => void;
}) {
  return (
    <section
      aria-labelledby="support-history-heading"
      className="mt-7 rounded-xl border border-slate-200/80 bg-white p-5"
    >
      <h2
        id="support-history-heading"
        className="text-sm font-semibold text-slate-950"
      >
        Your requests
      </h2>
      <p className="mt-1 text-xs text-slate-600">
        View your tickets and replies from the support team.
      </p>
      {error && (
        <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">
          <p role="alert">{error}</p>
          <button
            type="button"
            disabled={loading}
            onClick={onRetry}
            className="mt-2 min-h-9 font-semibold underline disabled:opacity-50"
          >
            Try again
          </button>
        </div>
      )}
      {loading ? (
        <p className="mt-4 text-sm text-slate-600" role="status">
          Loading your requests...
        </p>
      ) : !loaded && !tickets.length ? (
        <p className="mt-4 text-sm text-slate-600">
          Your request history is unavailable.
        </p>
      ) : loaded && !tickets.length ? (
        <p className="mt-4 text-sm text-slate-600">
          You have no support requests.
        </p>
      ) : null}
      {tickets.length > 0 && (
        <ul className="mt-4 space-y-3">
          {tickets.map((ticket) => (
            <li
              className="rounded-lg border border-slate-200 p-4"
              key={ticket.id}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="min-w-0 break-words text-sm font-semibold">
                  {ticket.subject}
                </h3>
                <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-semibold capitalize text-violet-800">
                  {ticket.status.replaceAll('_', ' ')}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-600">
                {ticket.body}
              </p>
              {ticket.admin_response && (
                <p className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-800">
                  Support response: {ticket.admin_response}
                </p>
              )}
              <p className="mt-3 text-[11px] capitalize text-slate-500">
                {ticket.kind} &middot;{' '}
                <time dateTime={ticket.created_at}>
                  {new Date(ticket.created_at).toLocaleString()}
                </time>
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
