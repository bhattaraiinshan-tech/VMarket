'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';

import { Promotion, requestApi } from '@/lib/api';

const fieldClass =
  'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900';

export default function VendorPromotionsPage() {
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [discountType, setDiscountType] = useState<'percent' | 'fixed'>(
    'percent',
  );
  const [discountValue, setDiscountValue] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [maxRedemptions, setMaxRedemptions] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);

  async function loadPromotions() {
    setPromotions(await requestApi<Promotion[]>('/vendor/promotions'));
    setLoaded(true);
  }

  useEffect(() => {
    let active = true;
    void requestApi<Promotion[]>('/vendor/promotions')
      .then((items) => {
        if (active) {
          setPromotions(items);
          setLoaded(true);
        }
      })
      .catch((cause: unknown) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Your promotions could not be loaded.',
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function createPromotion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await requestApi<Promotion>('/vendor/promotions', {
        method: 'POST',
        body: JSON.stringify({
          code,
          title,
          discount_type: discountType,
          discount_value: discountValue,
          starts_at: startsAt ? new Date(startsAt).toISOString() : null,
          ends_at: endsAt ? new Date(endsAt).toISOString() : null,
          max_redemptions: maxRedemptions ? Number(maxRedemptions) : null,
        }),
      });
      setCode('');
      setTitle('');
      setDiscountValue('');
      setStartsAt('');
      setEndsAt('');
      setMaxRedemptions('');
      await loadPromotions();
      setMessage('Your shop-funded promotion is active.');
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The promotion could not be created.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-5 py-8 sm:px-8">
      <header className="border-b border-slate-200 pb-5">
        <Link
          className="text-sm font-semibold text-emerald-800 underline"
          href="/vendor"
        >
          ← Vendor workspace
        </Link>
        <h1 className="mt-2 text-3xl font-bold text-slate-950">
          Shop promotions
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Shop-funded discounts apply only to items from the selected shop. One
          code may be used per order; discounts do not stack.
        </p>
      </header>
      {(error || message) && (
        <p
          className={`mt-5 rounded-lg p-4 text-sm ${error ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-900'}`}
          role={error ? 'alert' : 'status'}
        >
          {error || message}
        </p>
      )}
      <form
        className="mt-6 grid grid-cols-1 gap-4 rounded-2xl border border-slate-200 bg-white p-6 sm:grid-cols-2"
        onSubmit={(event) => void createPromotion(event)}
      >
        <label className="text-sm font-medium">
          Discount code
          <input
            className={fieldClass}
            maxLength={40}
            minLength={3}
            onChange={(event) => setCode(event.target.value)}
            required
            value={code}
          />
        </label>
        <label className="text-sm font-medium">
          Promotion title
          <input
            className={fieldClass}
            maxLength={160}
            minLength={2}
            onChange={(event) => setTitle(event.target.value)}
            required
            value={title}
          />
        </label>
        <label className="text-sm font-medium">
          Discount type
          <select
            className={fieldClass}
            onChange={(event) =>
              setDiscountType(event.target.value as 'percent' | 'fixed')
            }
            value={discountType}
          >
            <option value="percent">Percent (up to 100%)</option>
            <option value="fixed">Fixed NPR amount</option>
          </select>
        </label>
        <label className="text-sm font-medium">
          Starts at (optional)
          <input
            className={fieldClass}
            onChange={(event) => setStartsAt(event.target.value)}
            type="datetime-local"
            value={startsAt}
          />
        </label>
        <label className="text-sm font-medium">
          Ends at (optional)
          <input
            className={fieldClass}
            onChange={(event) => setEndsAt(event.target.value)}
            type="datetime-local"
            value={endsAt}
          />
        </label>
        <label className="text-sm font-medium">
          Redemption limit (optional)
          <input
            className={fieldClass}
            min="1"
            onChange={(event) => setMaxRedemptions(event.target.value)}
            type="number"
            value={maxRedemptions}
          />
        </label>
        <label className="text-sm font-medium">
          Discount value
          <input
            className={fieldClass}
            min="0.01"
            onChange={(event) => setDiscountValue(event.target.value)}
            required
            step="0.01"
            type="number"
            value={discountValue}
          />
        </label>
        <button
          className="w-fit rounded-lg bg-emerald-800 px-4 py-2 font-semibold text-white disabled:opacity-50 sm:col-span-2"
          disabled={busy}
          type="submit"
        >
          Create shop promotion
        </button>
      </form>
      <section className="mt-8">
        <h2 className="text-2xl font-bold">Your shop’s promotion codes</h2>
        {loading ? (
          <p className="mt-3 text-sm text-slate-600" role="status">
            Loading promotions…
          </p>
        ) : !loaded ? (
          <p className="mt-3 text-sm text-slate-600">
            Your promotion history is unavailable.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {promotions.map((promotion) => (
              <li
                className="rounded-xl border border-slate-200 bg-white p-4"
                key={promotion.id}
              >
                <p className="font-semibold">
                  {promotion.code} · {promotion.title}
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  {promotion.discount_value}
                  {promotion.discount_type === 'percent' ? '%' : ' NPR'} ·{' '}
                  {promotion.redemption_count} redemption
                  {promotion.redemption_count === 1 ? '' : 's'} ·{' '}
                  {promotion.is_active ? 'Active' : 'Inactive'}
                </p>
              </li>
            ))}
            {!promotions.length && (
              <li className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                No promotions have been created for this shop.
              </li>
            )}
          </ul>
        )}
      </section>
    </main>
  );
}
