'use client';

import { FormEvent, useState } from 'react';

import { requestApi } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace-context';

export default function FraudReportForm({
  targetType,
  targetId,
}: {
  targetType: 'product' | 'shop';
  targetId: string;
}) {
  const { user, workspace } = useWorkspace();
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  if (!user || (workspace !== 'customer' && workspace !== 'vendor')) return null;

  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await requestApi('/me/fraud-reports', {
        method: 'POST',
        body: JSON.stringify({
          target_type: targetType,
          target_id: targetId,
          reason,
          details: details || null,
        }),
      });
      setReason('');
      setDetails('');
      setMessage('Your report was sent to the platform investigation queue.');
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'The report could not be sent.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="mt-8 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <summary className="cursor-pointer font-semibold text-amber-950">
        Report suspicious {targetType}
      </summary>
      <form className="mt-4 grid gap-3" onSubmit={submitReport}>
        <label className="text-sm font-medium text-slate-800">
          What is concerning?
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            maxLength={120}
            minLength={3}
            onChange={(event) => setReason(event.target.value)}
            required
            value={reason}
          />
        </label>
        <label className="text-sm font-medium text-slate-800">
          Details (optional)
          <textarea
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            maxLength={2000}
            onChange={(event) => setDetails(event.target.value)}
            rows={3}
            value={details}
          />
        </label>
        {error && (
          <p className="text-sm text-red-800" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="text-sm text-emerald-900" role="status">
            {message}
          </p>
        )}
        <button
          className="w-fit rounded-lg border border-amber-800 px-4 py-2 text-sm font-semibold text-amber-950 disabled:opacity-50"
          disabled={busy}
          type="submit"
        >
          {busy ? 'Sending…' : 'Submit report'}
        </button>
      </form>
    </details>
  );
}
