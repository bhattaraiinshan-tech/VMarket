'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';

import {
  AdminOrder,
  AdminPayment,
  FraudReport,
  OperationsDashboard,
  PlatformSettings,
  Promotion,
  requestApi,
} from '@/lib/api';

type AuditEntry = {
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string;
  details: string | null;
  created_at: string;
};

const fieldClass =
  'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900';

export default function AdminOperationsPage() {
  const [dashboard, setDashboard] = useState<OperationsDashboard | null>(null);
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [commission, setCommission] = useState('3.00');
  const [returnDays, setReturnDays] = useState('7');
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [payments, setPayments] = useState<AdminPayment[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [reports, setReports] = useState<FraudReport[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [promoCode, setPromoCode] = useState('');
  const [promoTitle, setPromoTitle] = useState('');
  const [promoType, setPromoType] = useState<'percent' | 'fixed'>('percent');
  const [promoValue, setPromoValue] = useState('');
  const [promoStartsAt, setPromoStartsAt] = useState('');
  const [promoEndsAt, setPromoEndsAt] = useState('');
  const [promoMaxRedemptions, setPromoMaxRedemptions] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const loadData = useCallback(async () => {
    setError('');
    try {
      const [
        dashboardData,
        settingsData,
        orderData,
        paymentData,
        promotionData,
        reportData,
        auditData,
      ] = await Promise.all([
        requestApi<OperationsDashboard>('/admin/dashboard'),
        requestApi<PlatformSettings>('/admin/settings'),
        requestApi<AdminOrder[]>('/admin/orders?limit=50'),
        requestApi<AdminPayment[]>('/admin/payments?limit=50'),
        requestApi<Promotion[]>('/admin/promotions'),
        requestApi<FraudReport[]>('/admin/fraud-reports?limit=50'),
        requestApi<AuditEntry[]>('/admin/audit-logs?limit=20'),
      ]);
      setDashboard(dashboardData);
      setSettings(settingsData);
      setCommission((settingsData.commission_rate_bps / 100).toFixed(2));
      setReturnDays(String(settingsData.return_window_days));
      setOrders(orderData);
      setPayments(paymentData);
      setPromotions(promotionData);
      setReports(reportData);
      setAudit(auditData);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Operations data could not be loaded.',
      );
    }
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.all([
      requestApi<OperationsDashboard>('/admin/dashboard'),
      requestApi<PlatformSettings>('/admin/settings'),
      requestApi<AdminOrder[]>('/admin/orders?limit=50'),
      requestApi<AdminPayment[]>('/admin/payments?limit=50'),
      requestApi<Promotion[]>('/admin/promotions'),
      requestApi<FraudReport[]>('/admin/fraud-reports?limit=50'),
      requestApi<AuditEntry[]>('/admin/audit-logs?limit=20'),
    ])
      .then(
        ([
          dashboardData,
          settingsData,
          orderData,
          paymentData,
          promotionData,
          reportData,
          auditData,
        ]) => {
          if (!active) return;
          setDashboard(dashboardData);
          setSettings(settingsData);
          setCommission((settingsData.commission_rate_bps / 100).toFixed(2));
          setReturnDays(String(settingsData.return_window_days));
          setOrders(orderData);
          setPayments(paymentData);
          setPromotions(promotionData);
          setReports(reportData);
          setAudit(auditData);
        },
      )
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Operations data could not be loaded.',
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function runAction(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The requested operation could not be completed.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function updateSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction(async () => {
      const updated = await requestApi<PlatformSettings>('/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          commission_rate_bps: Math.round(Number(commission) * 100),
          return_window_days: Number(returnDays),
        }),
      });
      setSettings(updated);
      setMessage('Platform policy settings saved.');
      await loadData();
    });
  }

  async function createPromotion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction(async () => {
      await requestApi<Promotion>('/admin/promotions', {
        method: 'POST',
        body: JSON.stringify({
          code: promoCode,
          title: promoTitle,
          discount_type: promoType,
          discount_value: promoValue,
          starts_at: promoStartsAt ? new Date(promoStartsAt).toISOString() : null,
          ends_at: promoEndsAt ? new Date(promoEndsAt).toISOString() : null,
          max_redemptions: promoMaxRedemptions
            ? Number(promoMaxRedemptions)
            : null,
        }),
      });
      setPromoCode('');
      setPromoTitle('');
      setPromoValue('');
      setPromoStartsAt('');
      setPromoEndsAt('');
      setPromoMaxRedemptions('');
      setMessage('Platform-funded promotion created.');
      await loadData();
    });
  }

  async function togglePromotion(promotion: Promotion) {
    await runAction(async () => {
      await requestApi<Promotion>(`/admin/promotions/${promotion.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: !promotion.is_active }),
      });
      await loadData();
      setMessage('Promotion status updated.');
    });
  }

  async function updateReport(
    event: FormEvent<HTMLFormElement>,
    report: FraudReport,
  ) {
    event.preventDefault();
    await runAction(async () => {
      await requestApi<FraudReport>(`/admin/fraud-reports/${report.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'investigating',
          investigation_notes: notes[report.id] || 'Investigation started.',
        }),
      });
      setMessage('Fraud report investigation was updated and audited.');
      await loadData();
    });
  }

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-5 py-8 sm:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <Link className="text-sm font-semibold text-emerald-800" href="/">
            Your account
          </Link>
          <h1 className="mt-2 text-3xl font-bold text-slate-950">
            Operations dashboard
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Owner-only oversight; all operational changes are recorded in the
            audit trail.
          </p>
        </div>
        <nav className="flex flex-wrap gap-4 text-sm font-semibold text-emerald-800">
          <Link href="/admin/catalog">Catalogue and products</Link>
          <Link href="/admin/communications">Reviews, tickets, and disputes</Link>
          <Link href="/">Account and vendor verification</Link>
        </nav>
      </header>

      {(error || message) && (
        <p
          className={`mt-5 rounded-lg px-4 py-3 text-sm ${error ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-900'}`}
          role={error ? 'alert' : 'status'}
        >
          {error || message}
        </p>
      )}

      {dashboard && (
        <section
          aria-label="Operational metrics"
          className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        >
          {[
            ['Accounts', dashboard.users_total],
            ['Active vendors', dashboard.active_vendors],
            ['Pending verifications', dashboard.pending_vendor_applications],
            ['Products to review', dashboard.pending_products],
            ['Orders / open', `${dashboard.orders_total} / ${dashboard.open_orders}`],
            ['Open disputes', dashboard.open_disputes],
            ['Payments needing review', dashboard.pending_payments],
            ['Fraud investigations', dashboard.pending_fraud_reports],
            ['Cash collected', `NPR ${dashboard.collected_npr}`],
            ['Refunds due', `NPR ${dashboard.refunds_due_npr}`],
            ['Commission accrued', `NPR ${dashboard.commission_accrued_npr}`],
          ].map(([label, value]) => (
            <article
              className="rounded-xl border border-slate-200 bg-white p-4"
              key={String(label)}
            >
              <p className="text-sm text-slate-600">{label}</p>
              <p className="mt-1 text-xl font-bold text-slate-950">{value}</p>
            </article>
          ))}
        </section>
      )}

      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <form
          className="rounded-2xl border border-slate-200 bg-white p-5"
          onSubmit={(event) => void updateSettings(event)}
        >
          <h2 className="text-xl font-bold">Platform policies and fees</h2>
          <label className="mt-4 block text-sm font-medium">
            Vendor commission (% of item subtotal; 3%–5%)
            <input
              className={fieldClass}
              max="5"
              min="3"
              onChange={(event) => setCommission(event.target.value)}
              required
              step="0.01"
              type="number"
              value={commission}
            />
          </label>
          <label className="mt-3 block text-sm font-medium">
            Customer return window (days)
            <input
              className={fieldClass}
              max="30"
              min="1"
              onChange={(event) => setReturnDays(event.target.value)}
              required
              step="1"
              type="number"
              value={returnDays}
            />
          </label>
          <p className="mt-2 text-xs text-slate-600">
            Policy updates affect new orders and future return requests; order
            commission rates are snapshotted at checkout.
          </p>
          <button
            className="mt-4 rounded-lg bg-emerald-800 px-4 py-2 font-semibold text-white disabled:opacity-50"
            disabled={busy || !settings}
            type="submit"
          >
            Save policies
          </button>
        </form>

        <form
          className="rounded-2xl border border-slate-200 bg-white p-5"
          onSubmit={(event) => void createPromotion(event)}
        >
          <h2 className="text-xl font-bold">Platform-funded promotion</h2>
          <p className="mt-1 text-sm text-slate-600">
            Codes are single-use per checkout and cannot be stacked.
          </p>
          <label className="mt-3 block text-sm font-medium">
            Code
            <input
              className={fieldClass}
              maxLength={40}
              minLength={3}
              onChange={(event) => setPromoCode(event.target.value)}
              required
              value={promoCode}
            />
          </label>
          <label className="mt-3 block text-sm font-medium">
            Promotion name
            <input
              className={fieldClass}
              maxLength={160}
              minLength={2}
              onChange={(event) => setPromoTitle(event.target.value)}
              required
              value={promoTitle}
            />
          </label>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="text-sm font-medium">
              Discount type
              <select
                className={fieldClass}
                onChange={(event) =>
                  setPromoType(event.target.value as 'percent' | 'fixed')
                }
                value={promoType}
              >
                <option value="percent">Percent</option>
                <option value="fixed">Fixed NPR</option>
              </select>
            </label>
            <label className="text-sm font-medium">
              Discount value
              <input
                className={fieldClass}
                min="0.01"
                onChange={(event) => setPromoValue(event.target.value)}
                required
                step="0.01"
                type="number"
                value={promoValue}
              />
            </label>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="text-sm font-medium">
              Starts at (optional)
              <input
                className={fieldClass}
                onChange={(event) => setPromoStartsAt(event.target.value)}
                type="datetime-local"
                value={promoStartsAt}
              />
            </label>
            <label className="text-sm font-medium">
              Ends at (optional)
              <input
                className={fieldClass}
                onChange={(event) => setPromoEndsAt(event.target.value)}
                type="datetime-local"
                value={promoEndsAt}
              />
            </label>
            <label className="text-sm font-medium">
              Redemption limit (optional)
              <input
                className={fieldClass}
                min="1"
                onChange={(event) =>
                  setPromoMaxRedemptions(event.target.value)
                }
                type="number"
                value={promoMaxRedemptions}
              />
            </label>
          </div>
          <button
            className="mt-4 rounded-lg bg-emerald-800 px-4 py-2 font-semibold text-white disabled:opacity-50"
            disabled={busy}
            type="submit"
          >
            Create promotion
          </button>
        </form>
      </section>

      <section className="mt-8">
        <h2 className="text-2xl font-bold">Promotions</h2>
        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[700px] text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="p-3">Code</th>
                <th className="p-3">Discount</th>
                <th className="p-3">Funding</th>
                <th className="p-3">Redemptions</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {promotions.map((promotion) => (
                <tr className="border-t border-slate-100" key={promotion.id}>
                  <td className="p-3">
                    <strong>{promotion.code}</strong>
                    <span className="block text-xs text-slate-600">
                      {promotion.title}
                    </span>
                  </td>
                  <td className="p-3">
                    {promotion.discount_value}
                    {promotion.discount_type === 'percent' ? '%' : ' NPR'}
                  </td>
                  <td className="p-3">
                    {promotion.sponsor_type === 'platform'
                      ? 'Platform'
                      : `Vendor shop ${promotion.shop_id}`}
                  </td>
                  <td className="p-3">
                    {promotion.redemption_count}
                    {promotion.max_redemptions
                      ? ` / ${promotion.max_redemptions}`
                      : ''}
                  </td>
                  <td className="p-3">
                    <button
                      className="font-semibold text-emerald-800 underline disabled:opacity-50"
                      disabled={busy}
                      onClick={() => void togglePromotion(promotion)}
                      type="button"
                    >
                      {promotion.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
              {!promotions.length && (
                <tr>
                  <td className="p-4 text-slate-600" colSpan={5}>
                    No promotion codes have been created.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-2xl font-bold">Order oversight</h2>
        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="p-3">Order</th>
                <th className="p-3">Customer</th>
                <th className="p-3">Status</th>
                <th className="p-3">Promo / discount</th>
                <th className="p-3">Total due</th>
                <th className="p-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr className="border-t border-slate-100" key={order.id}>
                  <td className="p-3 font-semibold">{order.order_number}</td>
                  <td className="p-3">{order.customer_email}</td>
                  <td className="p-3">{order.status.replaceAll('_', ' ')}</td>
                  <td className="p-3">
                    {order.promotion_code ?? '—'} / NPR {order.discount_total}
                  </td>
                  <td className="p-3">NPR {order.total}</td>
                  <td className="p-3">
                    {new Date(order.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-2xl font-bold">Payment and refund oversight</h2>
        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="p-3">Order / shop</th>
                <th className="p-3">Customer</th>
                <th className="p-3">Type</th>
                <th className="p-3">Status</th>
                <th className="p-3">Amount</th>
                <th className="p-3">Updated</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr className="border-t border-slate-100" key={payment.id}>
                  <td className="p-3">
                    {payment.order_number}
                    <span className="block text-xs text-slate-600">
                      {payment.shop_name}
                    </span>
                  </td>
                  <td className="p-3">{payment.customer_email}</td>
                  <td className="p-3">{payment.transaction_type}</td>
                  <td className="p-3">{payment.status.replaceAll('_', ' ')}</td>
                  <td className="p-3">NPR {payment.amount}</td>
                  <td className="p-3">
                    {new Date(payment.updated_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-2xl font-bold">Fraud investigation queue</h2>
        <ul className="mt-3 space-y-3">
          {reports.map((report) => (
            <li
              className="rounded-xl border border-amber-200 bg-white p-4"
              key={report.id}
            >
              <p className="font-semibold">
                {report.target_type} · {report.target_id} · {report.reason}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                Reported by {report.reporter_email ?? report.reporter_id} on{' '}
                {new Date(report.created_at).toLocaleString()} · {report.status}
              </p>
              {report.details && (
                <p className="mt-2 whitespace-pre-wrap text-sm">
                  {report.details}
                </p>
              )}
              {report.status !== 'resolved' && report.status !== 'dismissed' && (
                <form
                  className="mt-3 flex flex-wrap gap-2"
                  onSubmit={(event) => void updateReport(event, report)}
                >
                  <label className="sr-only" htmlFor={`notes-${report.id}`}>
                    Investigation notes for report {report.id}
                  </label>
                  <input
                    className="min-w-60 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    id={`notes-${report.id}`}
                    minLength={3}
                    onChange={(event) =>
                      setNotes((current) => ({
                        ...current,
                        [report.id]: event.target.value,
                      }))
                    }
                    placeholder="Investigation notes"
                    required
                    value={notes[report.id] ?? report.investigation_notes ?? ''}
                  />
                  <button
                    className="rounded-lg bg-emerald-800 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    disabled={busy}
                    type="submit"
                  >
                    Mark investigating
                  </button>
                  <button
                    className="rounded-lg border border-slate-400 px-3 py-2 text-sm font-semibold disabled:opacity-50"
                    disabled={busy}
                    onClick={() =>
                      void runAction(async () => {
                        await requestApi<FraudReport>(
                          `/admin/fraud-reports/${report.id}`,
                          {
                            method: 'PATCH',
                            body: JSON.stringify({
                              status: 'resolved',
                              investigation_notes:
                                notes[report.id] ||
                                report.investigation_notes ||
                                'Investigation completed.',
                            }),
                          },
                        );
                        await loadData();
                        setMessage('Fraud report was resolved and audited.');
                      })
                    }
                    type="button"
                  >
                    Resolve
                  </button>
                  <button
                    className="rounded-lg border border-slate-400 px-3 py-2 text-sm font-semibold disabled:opacity-50"
                    disabled={busy}
                    onClick={() =>
                      void runAction(async () => {
                        await requestApi<FraudReport>(
                          `/admin/fraud-reports/${report.id}`,
                          {
                            method: 'PATCH',
                            body: JSON.stringify({
                              status: 'dismissed',
                              investigation_notes:
                                notes[report.id] ||
                                report.investigation_notes ||
                                'Report reviewed and dismissed.',
                            }),
                          },
                        );
                        await loadData();
                        setMessage('Fraud report was dismissed and audited.');
                      })
                    }
                    type="button"
                  >
                    Dismiss
                  </button>
                </form>
              )}
            </li>
          ))}
          {!reports.length && (
            <li className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
              No fraud reports are waiting for investigation.
            </li>
          )}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-2xl font-bold">Recent audit trail</h2>
        <ol className="mt-3 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
          {audit.map((entry, index) => (
            <li className="p-3 text-sm" key={`${entry.action}-${index}`}>
              <strong>{entry.action}</strong> · {entry.target_type} {entry.target_id}
              <span className="block text-xs text-slate-600">
                {entry.details ?? 'No additional details'} ·{' '}
                {new Date(entry.created_at).toLocaleString()}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
