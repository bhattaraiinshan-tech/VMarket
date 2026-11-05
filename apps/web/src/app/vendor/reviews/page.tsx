'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';

import { ProductReview, requestApi } from '@/lib/api';

export default function VendorReviewsPage() {
  const [reviews, setReviews] = useState<ProductReview[]>([]);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busyId, setBusyId] = useState('');

  useEffect(() => {
    void requestApi<ProductReview[]>('/vendor/reviews')
      .then(setReviews)
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error
            ? cause.message
            : 'Reviews could not be loaded.',
        ),
      );
  }, []);

  async function submitResponse(
    event: FormEvent<HTMLFormElement>,
    review: ProductReview,
  ) {
    event.preventDefault();
    setBusyId(review.id);
    setError('');
    setMessage('');
    try {
      const updated = await requestApi<ProductReview>(
        `/vendor/reviews/${review.id}/response`,
        {
          method: 'POST',
          body: JSON.stringify({ response: responses[review.id] ?? '' }),
        },
      );
      setReviews((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setResponses((current) => ({ ...current, [review.id]: '' }));
      setMessage('Your response was published.');
    } catch (cause: unknown) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Your response could not be published.',
      );
    } finally {
      setBusyId('');
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
          Product reviews
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
      {reviews.length ? (
        <ul className="mt-6 space-y-4">
          {reviews.map((review) => (
            <li
              className="rounded-xl border border-slate-200 bg-white p-5"
              key={review.id}
            >
              <p className="text-xs font-semibold uppercase text-emerald-800">
                {review.product_name}
              </p>
              <div className="mt-2 flex flex-wrap justify-between gap-2">
                <h2 className="font-semibold">{review.title}</h2>
                <span className="font-semibold text-amber-700">
                  {review.rating} / 5
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                {review.body}
              </p>
              <p className="mt-2 text-xs text-slate-500">
                {review.customer_name} ·{' '}
                {new Date(review.created_at).toLocaleDateString()}
              </p>
              {review.vendor_response && (
                <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-950">
                  Your response: {review.vendor_response}
                </p>
              )}
              <form
                className="mt-4 grid gap-2"
                onSubmit={(event) => void submitResponse(event, review)}
              >
                <label className="text-sm font-semibold text-slate-800">
                  {review.vendor_response
                    ? 'Update your response'
                    : 'Respond publicly'}
                  <textarea
                    className="mt-1 block w-full rounded-lg border border-slate-300 p-3 font-normal"
                    maxLength={3000}
                    onChange={(event) =>
                      setResponses((current) => ({
                        ...current,
                        [review.id]: event.target.value,
                      }))
                    }
                    required
                    rows={3}
                    value={responses[review.id] ?? ''}
                  />
                </label>
                <button
                  className="justify-self-start rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  disabled={busyId === review.id}
                  type="submit"
                >
                  Publish response
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-6 rounded-xl border border-slate-200 bg-white p-7 text-center text-slate-600">
          Your shop has no published customer reviews yet.
        </p>
      )}
    </main>
  );
}
