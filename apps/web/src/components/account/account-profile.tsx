'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { API_BASE_URL, requestApi, type Shop } from '@/lib/api';
import { browserStorageUrl } from '@/lib/network';
import { useWorkspace, useWorkspaceShops } from '@/lib/workspace-context';
import type { AccountWorkspace } from './account-shell';

export type AccountDetails = {
  workspace: AccountWorkspace;
  first_name: string;
  last_name: string;
  email: string;
  email_verified: boolean;
  phone: string | null;
  avatar_url: string | null;
  preferred_categories: string[];
  communication_email: boolean;
  communication_sms: boolean;
  business_name: string | null;
  business_category: string | null;
  registration_number: string | null;
  payout_preference: 'manual' | 'bank_transfer' | null;
  business_description: string | null;
};

const fieldClass =
  'mt-2 block w-full rounded-none border border-slate-400 bg-white px-3 py-3 text-base text-slate-950 disabled:bg-slate-100 disabled:text-slate-600';
const buttonClass =
  'inline-flex min-h-11 items-center justify-center bg-slate-950 px-7 py-3 text-sm font-bold uppercase tracking-wider text-white hover:bg-teal-900 disabled:cursor-not-allowed disabled:opacity-60';

function isAbort(cause: unknown) {
  return cause instanceof DOMException && cause.name === 'AbortError';
}

export function AccountProfile({ workspace }: { workspace: AccountWorkspace }) {
  const [details, setDetails] = useState<AccountDetails | null>(null);
  const [categories, setCategories] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [photoRevision, setPhotoRevision] = useState(0);
  const alive = useRef(true);
  const photoInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    void requestApi<AccountDetails>('/me/account-details', {
      signal: controller.signal,
    })
      .then((result) => {
        if (controller.signal.aborted) return;
        setDetails(result);
        setCategories(result.preferred_categories.join(', '));
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted && !isAbort(cause))
          setError(
            cause instanceof Error
              ? cause.message
              : 'Your details could not be loaded.',
          );
      });
    return () => {
      alive.current = false;
      controller.abort();
    };
  }, [attempt]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!details) return;
    if (
      [details.first_name.trim(), details.last_name.trim()]
        .filter(Boolean)
        .join(' ').length > 120
    ) {
      setMessage('');
      setError(
        'Your first and last name together must be 120 characters or fewer.',
      );
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await requestApi<AccountDetails>('/me/account-details', {
        method: 'PATCH',
        body: JSON.stringify({
          first_name: details.first_name.trim(),
          last_name: details.last_name.trim(),
          phone: details.phone?.trim() || null,
          communication_email: details.communication_email,
          communication_sms: details.communication_sms,
          ...(workspace === 'customer'
            ? {
                preferred_categories: categories
                  .split(',')
                  .map((category) => category.trim())
                  .filter(Boolean),
              }
            : {
                business_category: details.business_category?.trim() || null,
                registration_number:
                  details.registration_number?.trim() || null,
                payout_preference: details.payout_preference,
                business_description:
                  details.business_description?.trim() || null,
              }),
        }),
      });
      if (!alive.current) return;
      setDetails(result);
      setCategories(result.preferred_categories.join(', '));
      await requestApi('/me');
      if (alive.current) setMessage('Your profile has been updated.');
    } catch (cause: unknown) {
      if (alive.current && !isAbort(cause))
        setError(
          cause instanceof Error
            ? cause.message
            : 'Your changes could not be saved.',
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function changePhoto(file: File | null) {
    if (!file) return;
    setError('');
    setMessage('');
    if (
      !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
      file.size > 2 * 1024 * 1024
    ) {
      setError('Choose a PNG, JPEG or WebP image no larger than 2 MB.');
      if (photoInput.current) photoInput.current.value = '';
      return;
    }
    const body = new FormData();
    body.append('file', file);
    await photoAction({ method: 'POST', body });
  }

  async function photoAction(init: RequestInit) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await requestApi<AccountDetails>(
        '/me/account-details/avatar',
        init,
      );
      if (alive.current) {
        // Updating the photo must not discard unsaved profile fields.
        setDetails(
          (current) => current && { ...current, avatar_url: result.avatar_url },
        );
        setPhotoRevision((revision) => revision + 1);
        setMessage(
          init.method === 'DELETE'
            ? 'Profile photo removed.'
            : 'Profile photo updated.',
        );
      }
    } catch (cause: unknown) {
      if (alive.current && !isAbort(cause))
        setError(
          cause instanceof Error
            ? cause.message
            : 'Your photo could not be updated.',
        );
    } finally {
      if (photoInput.current) photoInput.current.value = '';
      if (alive.current) setBusy(false);
    }
  }

  function update<K extends keyof AccountDetails>(
    key: K,
    value: AccountDetails[K],
  ) {
    setDetails((current) => current && { ...current, [key]: value });
  }

  const avatarUrl = details?.avatar_url?.startsWith('/api/v1/')
    ? `${API_BASE_URL}${details.avatar_url.slice('/api/v1'.length)}`
    : details?.avatar_url;

  return (
    <section
      aria-labelledby="profile-title"
      className="account-card"
      id="my-details"
    >
      <h2
        className="text-xl font-bold uppercase tracking-wider"
        id="profile-title"
      >
        Profile
      </h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        Your personal details, kept separate from your public shop information.
      </p>
      {error && (
        <p
          className="mt-4 border-l-4 border-red-700 bg-red-50 p-4 text-sm text-red-900"
          role="alert"
        >
          {error}
        </p>
      )}
      {message && (
        <p className="mt-4 bg-teal-50 p-4 text-sm text-teal-900" role="status">
          {message}
        </p>
      )}
      {!details ? (
        error ? (
          <button
            className={`${buttonClass} mt-4`}
            onClick={() => {
              setError('');
              setAttempt((value) => value + 1);
            }}
            type="button"
          >
            Retry loading details
          </button>
        ) : (
          <p className="mt-5 text-sm text-slate-600" role="status">
            Loading your details...
          </p>
        )
      ) : (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-5 border-b border-slate-200 pb-6">
            {details.avatar_url ? (
              // User-uploaded storage URLs are not known to the Next image optimizer.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt="Your profile photo"
                className="size-20 rounded-full object-cover"
                height={80}
                src={`${browserStorageUrl(avatarUrl ?? details.avatar_url)}${(avatarUrl ?? details.avatar_url).includes('?') ? '&' : '?'}photo=${photoRevision}`}
                width={80}
              />
            ) : (
              <div
                aria-label="Profile initials"
                className="grid size-20 place-items-center rounded-full bg-slate-900 text-2xl font-bold text-white"
                role="img"
              >
                {(
                  details.first_name.charAt(0) + details.last_name.charAt(0)
                ).toUpperCase() || details.email.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <label
                className="inline-flex min-h-11 cursor-pointer items-center border border-slate-400 px-4 py-2 text-sm font-bold uppercase tracking-wide"
                htmlFor="account-photo"
              >
                Change photo
              </label>
              <input
                accept="image/png,image/jpeg,image/webp"
                aria-describedby="photo-help"
                className="mt-2 block w-full max-w-64 text-sm file:mr-2 file:border-0 file:bg-slate-100 file:p-2"
                disabled={busy}
                id="account-photo"
                onChange={(event) =>
                  void changePhoto(event.target.files?.[0] ?? null)
                }
                ref={photoInput}
                type="file"
              />
              <p className="mt-2 text-xs text-slate-600" id="photo-help">
                PNG, JPEG or WebP. Maximum 2 MB.
              </p>
              {details.avatar_url && (
                <button
                  className="mt-2 min-h-11 text-sm font-semibold text-red-800 underline"
                  disabled={busy}
                  onClick={() => void photoAction({ method: 'DELETE' })}
                  type="button"
                >
                  Remove photo
                </button>
              )}
            </div>
          </div>
          <form className="mt-6" onSubmit={(event) => void save(event)}>
            <fieldset disabled={busy}>
              <legend className="sr-only">Personal details</legend>
              <div className="grid gap-5 sm:grid-cols-2">
                <label className="text-sm font-bold">
                  First name
                  <input
                    autoComplete="given-name"
                    className={fieldClass}
                    maxLength={120}
                    onChange={(event) =>
                      update('first_name', event.target.value)
                    }
                    required
                    value={details.first_name}
                  />
                </label>
                <label className="text-sm font-bold">
                  Last name
                  <input
                    autoComplete="family-name"
                    className={fieldClass}
                    maxLength={120}
                    onChange={(event) =>
                      update('last_name', event.target.value)
                    }
                    value={details.last_name}
                  />
                </label>
                <div className="sm:col-span-2">
                  <label className="text-sm font-bold" htmlFor="account-email">
                    Email address
                  </label>
                  <input
                    aria-describedby="email-status"
                    autoComplete="email"
                    className={fieldClass}
                    id="account-email"
                    readOnly
                    type="email"
                    value={details.email}
                  />
                  <p
                    className={`mt-2 inline-flex px-2.5 py-1 text-xs font-semibold ${details.email_verified ? 'bg-teal-50 text-teal-900' : 'bg-amber-50 text-amber-900'}`}
                    id="email-status"
                  >
                    {details.email_verified
                      ? 'Email verified'
                      : 'Email not verified'}
                  </p>
                  <p className="mt-2 text-xs text-slate-600">
                    Your sign-in email cannot be changed here.
                  </p>
                </div>
                <label className="text-sm font-bold sm:col-span-2">
                  Phone number
                  <input
                    autoComplete="tel"
                    className={fieldClass}
                    maxLength={32}
                    onChange={(event) => update('phone', event.target.value)}
                    type="tel"
                    value={details.phone ?? ''}
                  />
                </label>
              </div>
              {workspace === 'customer' ? (
                <div className="mt-7 border-t border-slate-200 pt-6">
                  <h3 className="font-bold">Shopping preferences</h3>
                  <label className="mt-4 block text-sm font-bold">
                    Preferred shopping categories
                    <input
                      aria-describedby="category-help"
                      className={fieldClass}
                      maxLength={1000}
                      onChange={(event) => setCategories(event.target.value)}
                      value={categories}
                    />
                  </label>
                  <p className="mt-2 text-xs text-slate-600" id="category-help">
                    Separate category names with commas. These preferences do
                    not change product availability.
                  </p>
                  <a
                    className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-teal-900 underline"
                    href="#address-book"
                  >
                    Manage your shipping details
                  </a>
                </div>
              ) : (
                <fieldset className="mt-7 space-y-5 border-t border-slate-200 pt-6">
                  <legend className="mb-5 font-bold">Business details</legend>
                  <label className="block text-sm font-bold">
                    Registered business name
                    <input
                      className={fieldClass}
                      readOnly
                      value={details.business_name ?? ''}
                    />
                  </label>
                  <p className="text-xs text-slate-600">
                    Your approved business name is read-only. Contact support
                    for changes requiring verification.
                  </p>
                  <label className="block text-sm font-bold">
                    Business / vendor category
                    <input
                      className={fieldClass}
                      maxLength={120}
                      onChange={(event) =>
                        update('business_category', event.target.value)
                      }
                      value={details.business_category ?? ''}
                    />
                  </label>
                  <label className="block text-sm font-bold">
                    Business registration / Tax ID
                    <input
                      className={fieldClass}
                      maxLength={120}
                      onChange={(event) =>
                        update('registration_number', event.target.value)
                      }
                      value={details.registration_number ?? ''}
                    />
                  </label>
                  <p className="text-xs text-slate-600">
                    Saved for your records; changing this field does not verify
                    your registration or replace approved documents.
                  </p>
                  <label className="block text-sm font-bold">
                    Business description
                    <textarea
                      className={fieldClass}
                      maxLength={1000}
                      onChange={(event) =>
                        update('business_description', event.target.value)
                      }
                      rows={4}
                      value={details.business_description ?? ''}
                    />
                  </label>
                  <label className="block text-sm font-bold">
                    Payout preference
                    <select
                      className={fieldClass}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (
                          value === '' ||
                          value === 'manual' ||
                          value === 'bank_transfer'
                        )
                          update('payout_preference', value || null);
                      }}
                      value={details.payout_preference ?? ''}
                    >
                      <option value="">No preference</option>
                      <option value="manual">Manual settlement</option>
                      <option value="bank_transfer">Bank transfer</option>
                    </select>
                  </label>
                  <p className="text-xs leading-5 text-slate-600">
                    A preference only, not a connected payout method. No bank
                    details are collected and no automated payouts are enabled.
                  </p>
                </fieldset>
              )}
              <fieldset
                className="mt-7 space-y-4 border-t border-slate-200 pt-6"
                id="communication-preferences"
              >
                <legend className="mb-4 font-bold">
                  Communication preferences
                </legend>
                <label className="flex items-start gap-3 text-sm">
                  <input
                    checked={details.communication_email}
                    className="mt-0.5 size-4"
                    onChange={(event) =>
                      update('communication_email', event.target.checked)
                    }
                    type="checkbox"
                  />
                  Optional email updates
                </label>
                <label className="flex items-start gap-3 text-sm">
                  <input
                    checked={details.communication_sms}
                    className="mt-0.5 size-4"
                    onChange={(event) =>
                      update('communication_sms', event.target.checked)
                    }
                    type="checkbox"
                  />
                  Optional SMS updates
                </label>
                <p className="text-xs leading-5 text-slate-600">
                  We save your choices. Optional campaigns are not currently
                  sent. Essential security and order notifications are
                  unaffected.
                </p>
              </fieldset>
              <div className="mt-7 border-t border-slate-200 pt-6">
                <button
                  className={`${buttonClass} w-full sm:w-auto`}
                  type="submit"
                >
                  {busy ? 'Saving changes...' : 'Save changes'}
                </button>
              </div>
            </fieldset>
          </form>
        </>
      )}
    </section>
  );
}

export function ShopProfile() {
  const { shopId } = useWorkspace();
  const { shops, loading, error: shopError, refresh } = useWorkspaceShops();
  const shop = shops.find((entry) => entry.id === shopId);
  return (
    <section className="account-card" id="shop-details">
      <h2 className="text-lg font-bold">Selected shop</h2>
      {shopError ? (
        <p className="mt-3 text-sm text-red-900" role="alert">
          {shopError}
        </p>
      ) : loading ? (
        <p className="mt-3 text-sm text-slate-600" role="status">
          Loading shops...
        </p>
      ) : shop ? (
        <ShopDetailsForm key={shop.id} onSaved={refresh} shop={shop} />
      ) : (
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Select a shop in the workspace selector to edit its public name and
          description. No shop is selected automatically.
        </p>
      )}
      <Link
        className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-teal-900 underline"
        href="/vendor"
      >
        Manage shop catalogue and business location
      </Link>
    </section>
  );
}

function ShopDetailsForm({
  shop,
  onSaved,
}: {
  shop: Shop;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(shop.name);
  const [description, setDescription] = useState(shop.description ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await requestApi<Shop>('/vendor/shop', {
        method: 'PATCH',
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
        }),
      });
      if (!alive.current) return;
      await onSaved();
      if (alive.current) setMessage('Shop details updated.');
    } catch (cause: unknown) {
      if (alive.current && !isAbort(cause))
        setError(
          cause instanceof Error
            ? cause.message
            : 'Shop details could not be saved.',
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <form className="mt-5" onSubmit={(event) => void save(event)}>
      <fieldset className="space-y-5" disabled={busy}>
        <legend className="sr-only">Public shop details</legend>
        <label className="block text-sm font-bold">
          Shop name
          <input
            className={fieldClass}
            maxLength={160}
            onChange={(event) => setName(event.target.value)}
            required
            value={name}
          />
        </label>
        <label className="block text-sm font-bold">
          Public shop description
          <textarea
            className={fieldClass}
            maxLength={2000}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
            value={description}
          />
        </label>
        <button className={buttonClass} type="submit">
          {busy ? 'Saving shop...' : 'Save shop details'}
        </button>
      </fieldset>
      {error && (
        <p className="mt-4 text-sm text-red-900" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="mt-4 text-sm text-teal-900" role="status">
          {message}
        </p>
      )}
    </form>
  );
}

export function AccountSecurity({
  email,
  workspace,
  sessionsHref = '#security',
}: {
  email: string;
  workspace: AccountWorkspace;
  sessionsHref?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function sendReset() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await requestApi<{ message: string }>(
        '/auth/password/forgot',
        { method: 'POST', body: JSON.stringify({ email }) },
      );
      if (alive.current) setMessage(result.message);
    } catch (cause: unknown) {
      if (alive.current && !isAbort(cause))
        setError(
          cause instanceof Error
            ? cause.message
            : 'The reset link could not be requested.',
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <div className="grid items-start gap-6 md:grid-cols-2">
      <section className="account-card h-full" id="password">
        <h2 className="text-lg font-bold">Password and security</h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Use a secure email link to choose a new password. Never share the link
          with anyone.
        </p>
        <button
          className="mt-4 min-h-11 border border-slate-400 px-4 py-2 text-sm font-bold disabled:opacity-60"
          disabled={busy}
          onClick={() => void sendReset()}
          type="button"
        >
          {busy ? 'Requesting link...' : 'Send password reset link'}
        </button>
        <a
          className="mt-3 flex min-h-11 items-center text-sm font-semibold text-teal-900 underline"
          href={sessionsHref}
        >
          Review signed-in devices
        </a>
        {error && (
          <p className="mt-3 text-sm text-red-900" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="mt-3 text-sm text-teal-900" role="status">
            {message}
          </p>
        )}
      </section>
      {workspace === 'customer' ? (
        <section className="account-card h-full" id="payment-methods">
          <h2 className="text-lg font-bold">Payment methods</h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Cash on delivery is currently the only supported payment method. You
            do not need to save a card or bank account.
          </p>
          <a
            className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-teal-900 underline"
            href="#address-book"
          >
            Manage default shipping address
          </a>
        </section>
      ) : (
        <section className="account-card h-full">
          <h2 className="text-lg font-bold">Business support</h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            For shop-related support, select the relevant shop before opening a
            ticket.
          </p>
          <Link
            className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-teal-900 underline"
            href="/support"
          >
            Contact support
          </Link>
        </section>
      )}
    </div>
  );
}
