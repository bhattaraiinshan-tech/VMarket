'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';

import { requestApi, type Shop } from './api';
import {
  getWorkspaceSnapshot,
  getServerWorkspaceSnapshot,
  subscribeWorkspace,
  selectWorkspace,
  selectShop,
  availableWorkspaces,
  type Workspace,
  type WorkspaceUser,
} from './workspace-state';
import WorkspaceSwitcher from '@/app/workspace-switcher';

const ShopContext = createContext<{
  shops: Shop[];
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
}>({ shops: [], loading: false, error: '', refresh: async () => {} });

export function useWorkspace() {
  return useSyncExternalStore(
    subscribeWorkspace,
    getWorkspaceSnapshot,
    getServerWorkspaceSnapshot,
  );
}

export const useWorkspaceShops = () => useContext(ShopContext);

export function workspaceRouteRequirement(path: string) {
  if (path === '/vendor' || path.startsWith('/vendor/')) return 'vendor';
  if (path === '/admin' || path.startsWith('/admin/')) return 'admin';
  if (
    path === '/cart' ||
    path === '/wishlist' ||
    path === '/orders' ||
    path.startsWith('/orders/')
  )
    return 'customer';
  if (path === '/messages' || path.startsWith('/messages/')) return 'messages';
  if (path === '/notifications' || path === '/support') return 'shared';
  return null;
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const context = useWorkspace();
  const path = usePathname();
  const [readyForPath, setReadyForPath] = useState<string | null>(null);
  const [routeError, setRouteError] = useState('');
  const [shops, setShops] = useState<Shop[]>([]);
  const [shopsFor, setShopsFor] = useState<string | null>(null);
  const [shopError, setShopError] = useState('');
  const [loadingShops, setLoadingShops] = useState(false);

  useEffect(() => {
    let active = true;
    let applyLink = true;
    async function refreshIdentity() {
      try {
        const account = await requestApi<WorkspaceUser>('/me');
        if (!active) return;
        const selectors = new URLSearchParams(
          applyLink ? window.location.search : '',
        );
        applyLink = false;
        const target = selectors.get('workspace');
        if (target) {
          if (!availableWorkspaces(account).includes(target as Workspace)) {
            throw new Error(
              'The linked workspace is not available for your account.',
            );
          }
          selectWorkspace(target as Workspace);
          if (target === 'vendor' && selectors.has('shop_id')) {
            const owned = await requestApi<Shop[]>('/vendor/shops');
            if (!active) return;
            selectShop(
              selectors.get('shop_id'),
              owned.map((shop) => shop.id),
            );
            setShops(owned);
            setShopsFor(account.id);
          }
        }
        setRouteError('');
      } catch (cause) {
        if (
          active &&
          cause instanceof Error &&
          !(cause instanceof DOMException && cause.name === 'AbortError')
        ) {
          setRouteError(cause.message);
        }
      } finally {
        if (active) setReadyForPath(path);
      }
    }
    void refreshIdentity();
    window.addEventListener('focus', refreshIdentity);
    return () => {
      active = false;
      window.removeEventListener('focus', refreshIdentity);
    };
  }, [path]);

  const userId = context.user?.id;
  const mode = context.workspace;
  async function refreshShops() {
    setLoadingShops(true);
    setShopError('');
    try {
      const result = await requestApi<Shop[]>('/vendor/shops');
      setShops(result);
      setShopsFor(getWorkspaceSnapshot().user?.id ?? null);
      const selected = getWorkspaceSnapshot().shopId;
      if (selected && !result.some((shop) => shop.id === selected)) {
        selectShop(null, []);
      }
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
        setShopError(
          cause instanceof Error ? cause.message : 'Shops could not be loaded.',
        );
      }
    } finally {
      setLoadingShops(false);
    }
  }

  useEffect(() => {
    if (mode !== 'vendor' || !userId) return;
    let active = true;
    void requestApi<Shop[]>('/vendor/shops')
      .then((result) => {
        if (!active) return;
        setShops(result);
        setShopsFor(userId);
        setShopError('');
        const selected = getWorkspaceSnapshot().shopId;
        if (selected && !result.some((shop) => shop.id === selected))
          selectShop(null, []);
      })
      .catch((cause: unknown) => {
        if (
          active &&
          !(cause instanceof DOMException && cause.name === 'AbortError')
        )
          setShopError(
            cause instanceof Error
              ? cause.message
              : 'Shops could not be loaded.',
          );
      });
    return () => {
      active = false;
    };
  }, [mode, userId]);

  const requirement = workspaceRouteRequirement(path);
  const needsShop =
    requirement === 'vendor' ||
    ((requirement === 'shared' || requirement === 'messages') &&
      mode === 'vendor');
  let blocked = '';
  if (requirement) {
    if (readyForPath !== path) blocked = 'Loading your account…';
    else if (!context.user)
      blocked = 'Sign in from Your account to use this workspace.';
    else if (routeError) blocked = routeError;
    else if (
      ['customer', 'vendor', 'admin'].includes(requirement) &&
      mode !== requirement
    ) {
      blocked = `Select ${requirement.charAt(0).toUpperCase() + requirement.slice(1)} workspace to open this page.`;
    } else if (!mode) blocked = 'Select an available workspace.';
    else if (requirement === 'messages' && mode === 'admin')
      blocked = 'Messages require Customer or Vendor workspace.';
    else if (
      needsShop &&
      (shopsFor !== userId ||
        !context.shopId ||
        !shops.some((shop) => shop.id === context.shopId))
    ) {
      blocked =
        'Select a shop above to continue. You can create up to three shops, including inactive shops.';
    }
  }

  return (
    <ShopContext.Provider
      value={{
        shops: mode === 'vendor' && shopsFor === userId ? shops : [],
        loading: loadingShops || (mode === 'vendor' && shopsFor !== userId),
        error: shopError,
        refresh: refreshShops,
      }}
    >
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          const main =
            document.querySelector<HTMLElement>('#main-content main');
          if (main) {
            event.preventDefault();
            main.tabIndex = -1;
            main.focus();
          }
        }}
      >
        Skip to content
      </a>
      {!(
        ((path === '/marketplace' || path.startsWith('/marketplace/')) &&
          (!context.user || mode === 'customer')) ||
        (path === '/cart' && !!context.user && mode === 'customer')
      ) && (
        <WorkspaceSwitcher
          key={`${context.user?.id}:${mode}:${context.shopId}`}
          accountHeader={
            mode === 'customer' &&
            (path === '/' ||
              path === '/orders' ||
              path.startsWith('/orders/') ||
              path === '/wishlist' ||
              path === '/messages' ||
              path.startsWith('/messages/'))
          }
        />
      )}
      <div id="main-content" tabIndex={-1}>
        {blocked ? (
          <main className="mx-auto max-w-4xl px-5 py-12 sm:px-8">
            <div className="rounded-2xl border border-emerald-100 bg-white p-6 shadow-sm sm:p-8">
              <p className="text-xs font-bold uppercase tracking-widest text-emerald-800">
                Workspace access
              </p>
              <p className="mt-3 text-base text-slate-800" role="status">
                {blocked}
              </p>
              <Link
                className="mt-4 inline-block font-semibold text-emerald-800 underline underline-offset-4"
                href="/"
              >
                Your account
              </Link>
            </div>
          </main>
        ) : (
          <div
            key={`${context.user?.id ?? 'guest'}:${mode}:${context.shopId}:${context.revision}`}
          >
            {children}
          </div>
        )}
      </div>
    </ShopContext.Provider>
  );
}

export { selectWorkspace };
