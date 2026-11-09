'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { ApiError, requestApi as request } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace-context';
import { browserStorageUrl } from '@/lib/network';
import {
  setWorkspaceUser as setUser,
  type WorkspaceUser as UserProfile,
} from '@/lib/workspace-state';

type Address = {
  id: string;
  label: string;
  recipient_name: string;
  phone: string;
  province: string;
  city: string;
  area: string | null;
  street_address: string;
  postal_code: string | null;
  is_default: boolean;
};

type AuthSession = {
  id: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  user_agent: string | null;
  current: boolean;
};

type AdminAccount = {
  id: string;
  email: string;
  account_status: string;
  roles: string[];
  created_at: string;
};

type AuditEvent = {
  id: string;
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string;
  details: string | null;
  created_at: string;
};

type VendorApplication = {
  id: string;
  user_id: string;
  email?: string;
  business_name: string;
  business_type: string;
  registration_number: string | null;
  business_address: string;
  status: string;
  review_notes: string | null;
};

type VerificationDocument = {
  id: string;
  document_type: string;
  original_filename: string;
  content_type: string;
  file_size: number;
};

type AddressDraft = Omit<Address, 'id' | 'area' | 'postal_code'> & {
  area: string;
  postal_code: string;
};

const emptyAddress: AddressDraft = {
  label: 'Home',
  recipient_name: '',
  phone: '',
  province: '',
  city: '',
  area: '',
  street_address: '',
  postal_code: '',
  is_default: true,
};

function inputClassName() {
  return 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100';
}

export default function IdentityPortal({
  adminOnly = false,
}: {
  adminOnly?: boolean;
}) {
  const { user, workspace } = useWorkspace();
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [sessions, setSessions] = useState<AuthSession[]>([]);
  const [applications, setApplications] = useState<VendorApplication[]>([]);
  const [adminUsers, setAdminUsers] = useState<AdminAccount[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [suspensionReasons, setSuspensionReasons] = useState<
    Record<string, string>
  >({});
  const [pendingApplications, setPendingApplications] = useState<
    VendorApplication[]
  >([]);
  const [adminDocuments, setAdminDocuments] = useState<
    Record<string, VerificationDocument[]>
  >({});
  const [adminDocumentUrls, setAdminDocumentUrls] = useState<
    Record<string, string>
  >({});
  const [documents, setDocuments] = useState<VerificationDocument[]>([]);
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [profileName, setProfileName] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [deactivationPassword, setDeactivationPassword] = useState('');
  const [addressDraft, setAddressDraft] = useState(emptyAddress);
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [businessAddress, setBusinessAddress] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [documentType, setDocumentType] = useState('business_registration');
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    const { signal } = controller;
    void Promise.all([
      !adminOnly && workspace === 'customer'
        ? request<Address[]>('/me/addresses', { signal })
        : Promise.resolve([]),
      !adminOnly && workspace === 'customer'
        ? request<VendorApplication[]>('/vendors/applications/me', { signal })
        : Promise.resolve([]),
      adminOnly
        ? Promise.resolve([])
        : request<AuthSession[]>('/auth/sessions', { signal }),
    ])
      .then(async ([savedAddresses, savedApplications, activeSessions]) => {
        if (signal.aborted) return;
        setProfileName(user.profile?.full_name ?? '');
        setProfilePhone(user.profile?.phone ?? '');
        setAddresses(savedAddresses);
        setApplications(savedApplications);
        setSessions(activeSessions);
        if (workspace === 'admin' && user.roles.includes('admin')) {
          const [pending, accounts, events] = await Promise.all([
            request<VendorApplication[]>(
              '/admin/vendor-applications?status=pending',
              { signal },
            ),
            request<AdminAccount[]>('/admin/users', { signal }),
            request<AuditEvent[]>('/admin/audit-logs', { signal }),
          ]);
          if (signal.aborted) return;
          setPendingApplications(pending);
          setAdminUsers(accounts);
          setAuditEvents(events);
        } else {
          setPendingApplications([]);
          setAdminUsers([]);
          setAuditEvents([]);
        }
      })
      .catch((cause: unknown) => {
        if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Account data could not be loaded.',
          );
        }
      });
    return () => controller.abort();
  }, [adminOnly, user, workspace]);

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    let resetTimeout: number | undefined;
    function handleResetLink() {
      const currentHash = window.location.hash.slice(1);
      if (!currentHash.startsWith('reset=')) return;
      const token = currentHash.slice('reset='.length);
      window.clearTimeout(resetTimeout);
      resetTimeout = window.setTimeout(() => {
        if (window.location.hash.slice(1) !== currentHash) return;
        window.history.replaceState(
          null,
          '',
          window.location.pathname + window.location.search,
        );
        setError('');
        setMessage('');
        setNewPassword('');
        setResetToken(token);
        setMode('reset');
      }, 0);
    }

    if (hash.startsWith('verify=')) {
      const token = hash.slice('verify='.length);
      window.history.replaceState(null, '', window.location.pathname);
      void request<{ message: string }>('/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ token }),
      })
        .then((result) => setMessage(result.message))
        .catch((cause: unknown) =>
          setError(
            cause instanceof Error
              ? cause.message
              : 'Email verification failed.',
          ),
        );
    } else handleResetLink();

    window.addEventListener('hashchange', handleResetLink);
    void request<UserProfile>('/me').catch(() => undefined);
    return () => {
      window.removeEventListener('hashchange', handleResetLink);
      if (resetTimeout !== undefined) window.clearTimeout(resetTimeout);
    };
  }, []);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    setBusy(true);
    try {
      if (mode === 'register') {
        const result = await request<{ message: string }>('/auth/register', {
          method: 'POST',
          body: JSON.stringify({ email, password, full_name: fullName }),
        });
        setMessage(result.message);
        setMode('login');
      } else if (mode === 'reset') {
        const result = await request<{ message: string }>(
          '/auth/password/reset',
          {
            method: 'POST',
            body: JSON.stringify({ token: resetToken, password: newPassword }),
          },
        );
        setUser(null);
        setMessage(result.message);
        setMode('login');
        setPassword('');
        setNewPassword('');
        setResetToken('');
      } else {
        const account = await request<UserProfile>('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        });
        setUser(account);
        setMessage('');
      }
    } catch (cause: unknown) {
      if (
        mode === 'register' &&
        cause instanceof ApiError &&
        cause.code === 'email_delivery_unavailable'
      ) {
        setMode('login');
        setError(
          'Your account was created, but the verification email could not be delivered. Resend verification email to continue.',
        );
      } else {
        setError(
          cause instanceof Error ? cause.message : 'The request failed.',
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function runAction(action: () => Promise<void>) {
    setError('');
    setMessage('');
    setBusy(true);
    try {
      await action();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'The request failed.');
    } finally {
      setBusy(false);
    }
  }

  async function updateProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction(async () => {
      const account = await request<UserProfile>('/me', {
        method: 'PATCH',
        body: JSON.stringify({
          full_name: profileName,
          phone: profilePhone || null,
        }),
      });
      setUser(account);
      setMessage('Your profile has been updated.');
    });
  }

  async function addAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction(async () => {
      await request<Address>(
        editingAddressId
          ? `/me/addresses/${editingAddressId}`
          : '/me/addresses',
        {
          method: editingAddressId ? 'PUT' : 'POST',
          body: JSON.stringify(addressDraft),
        },
      );
      setAddresses(await request<Address[]>('/me/addresses'));
      setAddressDraft(emptyAddress);
      setEditingAddressId(null);
      setMessage(
        editingAddressId
          ? 'Delivery address updated.'
          : 'Delivery address saved.',
      );
    });
  }

  function editAddress(address: Address) {
    setEditingAddressId(address.id);
    setAddressDraft({
      label: address.label,
      recipient_name: address.recipient_name,
      phone: address.phone,
      province: address.province,
      city: address.city,
      area: address.area ?? '',
      street_address: address.street_address,
      postal_code: address.postal_code ?? '',
      is_default: address.is_default,
    });
  }

  async function removeAddress(address: Address) {
    await runAction(async () => {
      await request(`/me/addresses/${address.id}`, { method: 'DELETE' });
      setAddresses(await request<Address[]>('/me/addresses'));
      if (editingAddressId === address.id) {
        setEditingAddressId(null);
        setAddressDraft(emptyAddress);
      }
      setMessage('Delivery address deleted.');
    });
  }

  async function revokeSession(authSession: AuthSession) {
    await runAction(async () => {
      if (authSession.current) {
        await request('/auth/logout', { method: 'POST' });
        setUser(null);
        setAddresses([]);
        setSessions([]);
        setApplications([]);
        return;
      }
      await request(`/auth/sessions/${authSession.id}`, { method: 'DELETE' });
      setSessions(await request<AuthSession[]>('/auth/sessions'));
      setMessage('Session revoked.');
    });
  }

  async function setAccountSuspension(
    account: AdminAccount,
    suspended: boolean,
  ) {
    const reason = suspensionReasons[account.id]?.trim() ?? '';
    await runAction(async () => {
      await request(`/admin/users/${account.id}/suspension`, {
        method: 'POST',
        body: JSON.stringify({ suspended, reason }),
      });
      const [accounts, events] = await Promise.all([
        request<AdminAccount[]>('/admin/users'),
        request<AuditEvent[]>('/admin/audit-logs'),
      ]);
      setAdminUsers(accounts);
      setAuditEvents(events);
      setSuspensionReasons((current) => ({ ...current, [account.id]: '' }));
      setMessage(
        suspended
          ? 'The account has been suspended.'
          : 'The account has been reactivated.',
      );
    });
  }

  async function applyAsVendor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction(async () => {
      const application = await request<VendorApplication>(
        '/vendors/applications',
        {
          method: 'POST',
          body: JSON.stringify({
            business_name: businessName,
            business_type: businessType,
            registration_number: registrationNumber || null,
            business_address: businessAddress,
          }),
        },
      );
      setApplications((current) => [application, ...current]);
      setMessage('Vendor application submitted for review.');
    });
  }

  async function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const application = applications.find((item) => item.status === 'pending');
    if (!application || !documentFile) return;
    await runAction(async () => {
      const formData = new FormData();
      formData.set('file', documentFile);
      const document = await request<VerificationDocument>(
        `/vendors/applications/${application.id}/documents?document_type=${encodeURIComponent(documentType)}`,
        { method: 'POST', body: formData },
      );
      setDocuments((current) => [document, ...current]);
      setDocumentFile(null);
      setMessage('Private verification document uploaded.');
    });
  }

  async function reviewApplication(
    application: VendorApplication,
    decision: 'approved' | 'rejected',
  ) {
    await runAction(async () => {
      await request<VendorApplication>(
        `/admin/vendor-applications/${application.id}/decision`,
        {
          method: 'POST',
          body: JSON.stringify({
            status: decision,
            review_notes:
              decision === 'rejected'
                ? 'Please contact support for details.'
                : null,
          }),
        },
      );
      setAuditEvents(await request<AuditEvent[]>('/admin/audit-logs'));
      setPendingApplications((current) =>
        current.filter((item) => item.id !== application.id),
      );
      setMessage(`Application ${decision}.`);
    });
  }

  async function loadAdminDocuments(application: VendorApplication) {
    await runAction(async () => {
      const submitted = await request<VerificationDocument[]>(
        `/admin/vendor-applications/${application.id}/documents`,
      );
      setAdminDocuments((current) => ({
        ...current,
        [application.id]: submitted,
      }));
    });
  }

  async function createAdminDocumentUrl(
    application: VendorApplication,
    document: VerificationDocument,
  ) {
    await runAction(async () => {
      const result = await request<{ url: string }>(
        `/admin/vendor-applications/${application.id}/documents/${document.id}/url`,
      );
      setAdminDocumentUrls((current) => ({
        ...current,
        [document.id]: browserStorageUrl(result.url),
      }));
      setAuditEvents(await request<AuditEvent[]>('/admin/audit-logs'));
    });
  }

  async function exportAccountData() {
    await runAction(async () => {
      const data = await request<Record<string, unknown>>('/me/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const download = document.createElement('a');
      download.href = url;
      download.download = 'vendors-market-account-data.json';
      download.click();
      URL.revokeObjectURL(url);
      setMessage('Your personal data export has been downloaded.');
    });
  }

  async function deactivateAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction(async () => {
      await request('/me/deactivate', {
        method: 'POST',
        body: JSON.stringify({
          email: user?.email,
          password: deactivationPassword,
        }),
      });
      setUser(null);
      setAddresses([]);
      setApplications([]);
      setMessage('Your account has been deactivated.');
    });
  }

  if (adminOnly && (workspace !== 'admin' || !user?.roles.includes('admin'))) {
    return (
      <main className="mx-auto max-w-4xl px-5 py-12 sm:px-8">
        <p role="status">Select Admin workspace to continue.</p>
      </main>
    );
  }

  if (user && mode !== 'reset') {
    const pendingApplication = applications.find(
      (application) => application.status === 'pending',
    );
    const hasVendorApplication = applications.some(
      (application) =>
        application.status === 'pending' || application.status === 'approved',
    );

    return (
      <main className="mx-auto min-h-screen w-full max-w-5xl px-5 py-8 sm:px-8">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
          <div>
            <p className="text-sm font-bold text-emerald-800">
              Vendor&apos;s Market
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight">
              {adminOnly ? 'Platform administration' : 'Your account'}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!adminOnly && user.roles.includes('vendor') && (
              <Link
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50"
                href="/vendor"
              >
                Vendor catalogue
              </Link>
            )}
            {user.roles.includes('admin') && (
              <>
                <Link
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50"
                  href="/admin/catalog"
                >
                  Catalogue admin
                </Link>
                <Link
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50"
                  href="/admin/operations"
                >
                  Operations
                </Link>
              </>
            )}
            <button
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50"
              disabled={busy}
              onClick={() =>
                void runAction(async () => {
                  await request('/auth/logout', { method: 'POST' });
                  setUser(null);
                  setAddresses([]);
                  setApplications([]);
                })
              }
              type="button"
            >
              Sign out
            </button>
          </div>
        </header>

        {(message || error) && (
          <p
            className={`mt-5 rounded-lg px-4 py-3 text-sm ${error ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800'}`}
            role={error ? 'alert' : 'status'}
          >
            {error || message}
          </p>
        )}

        {!adminOnly && workspace === 'customer' && (
          <section className="mt-8 grid gap-6 lg:grid-cols-2">
            <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold">Profile</h2>
              <p className="mt-1 text-sm text-slate-600">{user.email}</p>
              <p className="mt-1 text-xs text-emerald-800">
                {user.email_verified ? 'Email verified' : 'Email not verified'}{' '}
                | {user.roles.join(', ')}
              </p>
              <form className="mt-5 space-y-4" onSubmit={updateProfile}>
                <label className="block text-sm font-medium">
                  Full name
                  <input
                    autoComplete="name"
                    className={inputClassName()}
                    maxLength={120}
                    onChange={(event) => setProfileName(event.target.value)}
                    required
                    value={profileName}
                  />
                </label>
                <label className="block text-sm font-medium">
                  Phone number
                  <input
                    autoComplete="tel"
                    className={inputClassName()}
                    maxLength={32}
                    onChange={(event) => setProfilePhone(event.target.value)}
                    value={profilePhone}
                  />
                </label>
                <button
                  className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
                  disabled={busy || workspace !== 'customer'}
                  type="submit"
                >
                  Save profile
                </button>
              </form>
              <button
                className="mt-4 text-sm font-medium text-emerald-800 underline underline-offset-2"
                disabled={busy}
                onClick={() => void exportAccountData()}
                type="button"
              >
                Download my personal data
              </button>
              <form
                className="mt-5 border-t border-slate-200 pt-4"
                onSubmit={deactivateAccount}
              >
                <label className="block text-sm font-medium">
                  Deactivate account
                  <input
                    autoComplete="current-password"
                    className={inputClassName()}
                    onChange={(event) =>
                      setDeactivationPassword(event.target.value)
                    }
                    placeholder="Confirm your password"
                    required
                    type="password"
                    value={deactivationPassword}
                  />
                </label>
                <button
                  className="mt-3 rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-800 hover:bg-red-50 disabled:opacity-60"
                  disabled={busy || user.roles.includes('admin')}
                  type="submit"
                >
                  Deactivate account
                </button>
              </form>
            </article>

            {workspace === 'customer' && (
              <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-lg font-semibold">Delivery addresses</h2>
                {addresses.length > 0 ? (
                  <ul className="mt-3 space-y-2">
                    {addresses.map((address) => (
                      <li
                        className="rounded-lg bg-slate-50 p-3 text-sm"
                        key={address.id}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <span className="font-semibold">
                              {address.label}
                              {address.is_default ? ' - Default' : ''}
                            </span>
                            <p className="mt-1 text-slate-600">
                              {address.recipient_name}, {address.street_address}
                              , {address.city}, {address.province}
                            </p>
                          </div>
                          <div className="flex gap-3">
                            <button
                              className="font-medium text-emerald-800 underline"
                              disabled={busy}
                              onClick={() => editAddress(address)}
                              type="button"
                            >
                              Edit
                            </button>
                            <button
                              className="font-medium text-red-800 underline"
                              disabled={busy}
                              onClick={() => void removeAddress(address)}
                              type="button"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-slate-600">
                    Add an address to make future checkout faster.
                  </p>
                )}
                <form
                  className="mt-5 grid gap-3 sm:grid-cols-2"
                  onSubmit={addAddress}
                >
                  {(
                    [
                      ['label', 'Label'],
                      ['recipient_name', 'Recipient name'],
                      ['phone', 'Phone'],
                      ['province', 'Province'],
                      ['city', 'City / municipality'],
                      ['area', 'Area'],
                      ['street_address', 'Street address'],
                      ['postal_code', 'Postal code'],
                    ] as const
                  ).map(([field, label]) => (
                    <label className="text-sm font-medium" key={field}>
                      {label}
                      <input
                        className={inputClassName()}
                        onChange={(event) =>
                          setAddressDraft((current) => ({
                            ...current,
                            [field]: event.target.value,
                          }))
                        }
                        required={field !== 'area' && field !== 'postal_code'}
                        value={addressDraft[field]}
                      />
                    </label>
                  ))}
                  <label className="flex items-center gap-2 text-sm sm:col-span-2">
                    <input
                      checked={addressDraft.is_default}
                      onChange={(event) =>
                        setAddressDraft((current) => ({
                          ...current,
                          is_default: event.target.checked,
                        }))
                      }
                      type="checkbox"
                    />
                    Make this my default address
                  </label>
                  <button
                    className="w-fit rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60 sm:col-span-2"
                    disabled={busy}
                    type="submit"
                  >
                    {editingAddressId ? 'Save address' : 'Add address'}
                  </button>
                  {editingAddressId && (
                    <button
                      className="w-fit rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50 sm:col-span-2"
                      disabled={busy}
                      onClick={() => {
                        setEditingAddressId(null);
                        setAddressDraft(emptyAddress);
                      }}
                      type="button"
                    >
                      Cancel editing
                    </button>
                  )}
                </form>
              </article>
            )}
          </section>
        )}

        {!adminOnly && (
          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold">Signed-in sessions</h2>
            {sessions.length === 0 ? (
              <p className="mt-2 text-sm text-slate-600">
                No active sessions were found.
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {sessions.map((authSession) => (
                  <li
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 p-3 text-sm"
                    key={authSession.id}
                  >
                    <div>
                      <p className="font-semibold">
                        {authSession.user_agent || 'Unknown device'}
                        {authSession.current ? ' - This device' : ''}
                      </p>
                      <p className="mt-1 text-slate-600">
                        Signed in{' '}
                        {new Date(authSession.created_at).toLocaleString()} |
                        Last active{' '}
                        {new Date(authSession.last_seen_at).toLocaleString()}
                      </p>
                    </div>
                    <button
                      className="font-medium text-red-800 underline"
                      disabled={busy}
                      onClick={() => void revokeSession(authSession)}
                      type="button"
                    >
                      {authSession.current ? 'Sign out' : 'Revoke session'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {!adminOnly && workspace === 'customer' && (
          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold">Vendor workspace access</h2>
            {applications.map((application) => (
              <p className="mt-2 text-sm text-slate-700" key={application.id}>
                {application.business_name}:{' '}
                <strong>{application.status}</strong>
                {application.review_notes
                  ? ` - ${application.review_notes}`
                  : ''}
              </p>
            ))}
            {!user.vendor_profile && !hasVendorApplication && (
              <form
                className="mt-5 grid gap-4 sm:grid-cols-2"
                onSubmit={applyAsVendor}
              >
                <label className="text-sm font-medium">
                  Business name
                  <input
                    className={inputClassName()}
                    onChange={(event) => setBusinessName(event.target.value)}
                    required
                    value={businessName}
                  />
                </label>
                <label className="text-sm font-medium">
                  Business type
                  <input
                    className={inputClassName()}
                    onChange={(event) => setBusinessType(event.target.value)}
                    placeholder="Retail, wholesale, supplier..."
                    required
                    value={businessType}
                  />
                </label>
                <label className="text-sm font-medium">
                  Registration number
                  <input
                    className={inputClassName()}
                    onChange={(event) =>
                      setRegistrationNumber(event.target.value)
                    }
                    value={registrationNumber}
                  />
                </label>
                <label className="text-sm font-medium">
                  Business address
                  <input
                    className={inputClassName()}
                    onChange={(event) => setBusinessAddress(event.target.value)}
                    required
                    value={businessAddress}
                  />
                </label>
                <button
                  className="w-fit rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60 sm:col-span-2"
                  disabled={busy}
                  type="submit"
                >
                  Submit vendor application
                </button>
              </form>
            )}
            {pendingApplication && (
              <form
                className="mt-5 flex flex-wrap items-end gap-3 border-t border-slate-200 pt-5"
                onSubmit={uploadDocument}
              >
                <label className="text-sm font-medium">
                  Document type
                  <select
                    className={inputClassName()}
                    onChange={(event) => setDocumentType(event.target.value)}
                    value={documentType}
                  >
                    <option value="business_registration">
                      Business registration
                    </option>
                    <option value="pan_vat">PAN / VAT</option>
                    <option value="citizenship">Citizenship</option>
                  </select>
                </label>
                <label className="text-sm font-medium">
                  Private document (PDF, PNG, JPEG; max 10 MB)
                  <input
                    accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                    className="mt-1 block w-full text-sm"
                    onChange={(event) =>
                      setDocumentFile(event.target.files?.[0] ?? null)
                    }
                    required
                    type="file"
                  />
                </label>
                <button
                  className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-60"
                  disabled={busy || !documentFile}
                  type="submit"
                >
                  Upload securely
                </button>
              </form>
            )}
            {documents.length > 0 && (
              <ul className="mt-3 text-sm text-slate-600">
                {documents.map((document) => (
                  <li key={document.id}>
                    {document.document_type}: {document.original_filename}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {workspace === 'admin' && user.roles.includes('admin') && (
          <div className="mt-6 space-y-6">
            <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
              <h2 className="text-lg font-semibold">
                Administrator review queue
              </h2>
              {pendingApplications.length === 0 ? (
                <p className="mt-2 text-sm text-slate-600">
                  There are no pending vendor applications.
                </p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {pendingApplications.map((application) => (
                    <li
                      className="rounded-xl border border-emerald-100 bg-white p-4"
                      key={application.id}
                    >
                      <p className="font-semibold">
                        {application.business_name}
                      </p>
                      <p className="mt-1 text-sm text-slate-600">
                        {application.email} | {application.business_type} |{' '}
                        {application.business_address}
                      </p>
                      <div className="mt-3 flex gap-2">
                        <button
                          className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white"
                          disabled={busy}
                          onClick={() =>
                            void reviewApplication(application, 'approved')
                          }
                          type="button"
                        >
                          Approve
                        </button>
                        <button
                          className="rounded-lg border border-red-300 px-3 py-2 text-sm font-semibold text-red-800"
                          disabled={busy}
                          onClick={() =>
                            void reviewApplication(application, 'rejected')
                          }
                          type="button"
                        >
                          Reject
                        </button>
                      </div>
                      <button
                        className="mt-3 text-sm font-medium text-emerald-800 underline underline-offset-2"
                        disabled={busy}
                        onClick={() => void loadAdminDocuments(application)}
                        type="button"
                      >
                        Load submitted documents
                      </button>
                      {adminDocuments[application.id]?.map((document) => (
                        <p className="mt-2 text-sm" key={document.id}>
                          {document.document_type}: {document.original_filename}{' '}
                          {adminDocumentUrls[document.id] ? (
                            <a
                              className="font-medium text-emerald-800 underline"
                              href={adminDocumentUrls[document.id]}
                              rel="noreferrer"
                              target="_blank"
                            >
                              Open secure link
                            </a>
                          ) : (
                            <button
                              className="font-medium text-emerald-800 underline"
                              disabled={busy}
                              onClick={() =>
                                void createAdminDocumentUrl(
                                  application,
                                  document,
                                )
                              }
                              type="button"
                            >
                              Create 5-minute link
                            </button>
                          )}
                        </p>
                      ))}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold">Account access controls</h2>
              <ul className="mt-4 space-y-3">
                {adminUsers.map((account) => {
                  const canChangeStatus =
                    account.id !== user.id &&
                    account.account_status !== 'deactivated';
                  const suspended = account.account_status === 'suspended';
                  return (
                    <li className="rounded-lg bg-slate-50 p-3" key={account.id}>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="font-semibold">{account.email}</p>
                          <p className="text-sm text-slate-600">
                            {account.roles.join(', ')} |{' '}
                            {account.account_status}
                          </p>
                        </div>
                        {canChangeStatus && (
                          <button
                            className={`rounded-lg px-3 py-2 text-sm font-semibold ${suspended ? 'bg-emerald-700 text-white' : 'border border-red-300 text-red-800'}`}
                            disabled={
                              busy ||
                              (suspensionReasons[account.id]?.trim().length ??
                                0) < 5
                            }
                            onClick={() =>
                              void setAccountSuspension(account, !suspended)
                            }
                            type="button"
                          >
                            {suspended ? 'Reactivate' : 'Suspend'}
                          </button>
                        )}
                      </div>
                      {canChangeStatus && (
                        <label className="mt-3 block text-sm font-medium">
                          Reason for {suspended ? 'reactivation' : 'suspension'}
                          <input
                            className={inputClassName()}
                            minLength={5}
                            onChange={(event) =>
                              setSuspensionReasons((current) => ({
                                ...current,
                                [account.id]: event.target.value,
                              }))
                            }
                            required
                            value={suspensionReasons[account.id] ?? ''}
                          />
                        </label>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold">
                Administrative audit history
              </h2>
              {auditEvents.length === 0 ? (
                <p className="mt-2 text-sm text-slate-600">
                  No administrative events have been recorded.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {auditEvents.map((event) => (
                    <li
                      className="rounded-lg bg-slate-50 p-3 text-sm"
                      key={event.id}
                    >
                      <p className="font-semibold">{event.action}</p>
                      <p className="mt-1 text-slate-600">
                        {event.target_type} {event.target_id} |{' '}
                        {new Date(event.created_at).toLocaleString()}
                      </p>
                      {event.details && (
                        <p className="mt-1 text-slate-600">{event.details}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col px-5 py-8 sm:px-8">
      <header className="flex items-center justify-between">
        <Link
          className="text-sm font-semibold text-emerald-800 underline underline-offset-4"
          href="/marketplace"
        >
          Explore the marketplace
        </Link>
        <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
          Identity &amp; access
        </span>
      </header>

      <section className="grid flex-1 items-center gap-8 py-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16 lg:py-16">
        <div className="rounded-3xl bg-emerald-950 px-6 py-10 text-white sm:px-10 sm:py-14">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-200">
            A trusted market for Nepal
          </p>
          <h1 className="mt-4 max-w-2xl text-4xl font-bold leading-tight tracking-tight sm:text-6xl">
            One account for shopping and business.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-8 text-emerald-50">
            Create a customer profile, manage delivery addresses, or apply to
            join the marketplace as a verified vendor.
          </p>
          <ul className="mt-8 space-y-3 border-t border-emerald-800 pt-6 text-sm leading-6 text-emerald-50">
            <li>Private, verified sign-in sessions</li>
            <li>Secure account recovery and email verification</li>
            <li>Vendor onboarding with private business documents</li>
          </ul>
        </div>

        <section className="rounded-3xl border border-emerald-100 bg-white p-6 shadow-lg shadow-emerald-950/5 sm:p-8">
          <div className="flex gap-2 border-b border-slate-200 pb-4">
            <button
              aria-pressed={mode === 'login'}
              className={`rounded-lg px-3 py-2 text-sm font-semibold ${mode === 'login' ? 'bg-emerald-100 text-emerald-900' : 'text-slate-600 hover:bg-slate-100'}`}
              onClick={() => {
                setMode('login');
                setError('');
                setMessage('');
              }}
              type="button"
            >
              Sign in
            </button>
            <button
              aria-pressed={mode === 'register'}
              className={`rounded-lg px-3 py-2 text-sm font-semibold ${mode === 'register' ? 'bg-emerald-100 text-emerald-900' : 'text-slate-600 hover:bg-slate-100'}`}
              onClick={() => {
                setMode('register');
                setError('');
                setMessage('');
              }}
              type="button"
            >
              Create account
            </button>
          </div>

          <h2 className="mt-5 text-xl font-semibold">
            {mode === 'register'
              ? 'Create your account'
              : mode === 'reset'
                ? 'Choose a new password'
                : 'Welcome back'}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {mode === 'register'
              ? 'We will email you a verification link.'
              : mode === 'reset'
                ? 'Use at least 12 characters for your new password.'
                : 'Use your verified email address to continue.'}
          </p>

          {(message || error) && (
            <p
              className={`mt-4 rounded-lg px-3 py-2 text-sm ${error ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800'}`}
              role={error ? 'alert' : 'status'}
            >
              {error || message}
            </p>
          )}

          <form className="mt-5 space-y-4" onSubmit={submitAuth}>
            {mode === 'register' && (
              <label className="block text-sm font-medium">
                Full name
                <input
                  autoComplete="name"
                  className={inputClassName()}
                  maxLength={120}
                  onChange={(event) => setFullName(event.target.value)}
                  required
                  value={fullName}
                />
              </label>
            )}
            {mode !== 'reset' && (
              <label className="block text-sm font-medium">
                Email
                <input
                  autoComplete="email"
                  className={inputClassName()}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  type="email"
                  value={email}
                />
              </label>
            )}
            {mode === 'reset' ? (
              <label className="block text-sm font-medium">
                New password
                <input
                  autoComplete="new-password"
                  className={inputClassName()}
                  minLength={12}
                  onChange={(event) => setNewPassword(event.target.value)}
                  required
                  type="password"
                  value={newPassword}
                />
              </label>
            ) : (
              <label className="block text-sm font-medium">
                Password
                <input
                  autoComplete={
                    mode === 'register' ? 'new-password' : 'current-password'
                  }
                  className={inputClassName()}
                  minLength={mode === 'register' ? 12 : 1}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  type="password"
                  value={password}
                />
                {mode === 'register' && (
                  <span className="mt-1 block text-xs font-normal text-slate-500">
                    Use at least 12 characters.
                  </span>
                )}
              </label>
            )}
            <button
              className="w-full rounded-lg bg-emerald-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={busy}
              type="submit"
            >
              {busy
                ? 'Please wait...'
                : mode === 'register'
                  ? 'Create account'
                  : mode === 'reset'
                    ? 'Reset password'
                    : 'Sign in'}
            </button>
          </form>

          {mode === 'login' && (
            <button
              className="mt-4 text-sm font-medium text-emerald-800 underline underline-offset-2"
              disabled={busy || !email}
              onClick={() =>
                void runAction(async () => {
                  const result = await request<{ message: string }>(
                    '/auth/password/forgot',
                    {
                      method: 'POST',
                      body: JSON.stringify({ email }),
                    },
                  );
                  setMessage(result.message);
                })
              }
              type="button"
            >
              Forgot password?
            </button>
          )}
          {mode === 'login' && (
            <button
              className="mt-3 block text-sm font-medium text-emerald-800 underline underline-offset-2"
              disabled={busy || !email}
              onClick={() =>
                void runAction(async () => {
                  const result = await request<{ message: string }>(
                    '/auth/resend-verification',
                    {
                      method: 'POST',
                      body: JSON.stringify({ email }),
                    },
                  );
                  setMessage(result.message);
                })
              }
              type="button"
            >
              Resend verification email
            </button>
          )}
        </section>
      </section>

      <footer className="border-t border-slate-200 pt-5 text-sm text-slate-600">
        Account controls are protected by the Vendor&apos;s Market API.
      </footer>
    </main>
  );
}
