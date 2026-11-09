export type Workspace = 'customer' | 'vendor' | 'admin';

export type WorkspaceUser = {
  id: string;
  email: string;
  email_verified: boolean;
  account_status: string;
  roles: string[];
  profile: { full_name: string; phone: string | null } | null;
  vendor_profile: { business_name: string } | null;
  owned_shop_ids?: string[];
};

type Snapshot = {
  user: WorkspaceUser | null;
  workspace: Workspace | null;
  shopId: string | null;
  revision: number;
};

const initial: Snapshot = {
  user: null,
  workspace: null,
  shopId: null,
  revision: 0,
};
let snapshot = initial;
const listeners = new Set<() => void>();
const requests = new Set<AbortController>();
const storageKey = 'vmarket.workspace';

export const getWorkspaceSnapshot = () => snapshot;
export const getServerWorkspaceSnapshot = () => initial;
export function subscribeWorkspace(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function availableWorkspaces(user: WorkspaceUser | null): Workspace[] {
  if (!user) return [];
  return [
    ...(user.profile ? ['customer' as const] : []),
    ...(user.vendor_profile ? ['vendor' as const] : []),
    ...(user.roles.includes('admin') ? ['admin' as const] : []),
  ];
}

function publish(next: Omit<Snapshot, 'revision'>) {
  const changed =
    snapshot.user?.id !== next.user?.id ||
    snapshot.workspace !== next.workspace ||
    snapshot.shopId !== next.shopId;
  if (changed) {
    requests.forEach((controller) => controller.abort());
    requests.clear();
  }
  snapshot = { ...next, revision: snapshot.revision + (changed ? 1 : 0) };
  try {
    if (next.user) {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({
          userId: next.user.id,
          workspace: next.workspace,
          shopId: next.shopId,
        }),
      );
    } else sessionStorage.removeItem(storageKey);
  } catch {
    /* Storage may be disabled; in-memory tab isolation still works. */
  }
  listeners.forEach((listener) => listener());
}

export function setWorkspaceUser(user: WorkspaceUser | null) {
  if (!user) {
    publish({ user: null, workspace: null, shopId: null });
    return;
  }
  const modes = availableWorkspaces(user);
  let workspace = snapshot.user?.id === user.id ? snapshot.workspace : null;
  let shopId = snapshot.user?.id === user.id ? snapshot.shopId : null;
  if (!snapshot.user) {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
      if (saved?.userId === user.id && modes.includes(saved.workspace)) {
        workspace = saved.workspace;
        shopId = typeof saved.shopId === 'string' ? saved.shopId : null;
      }
    } catch {
      /* Ignore malformed or unavailable tab storage. */
    }
  }
  if (!workspace || !modes.includes(workspace)) {
    workspace = modes.includes('customer') ? 'customer' : null;
    shopId = null;
  }
  publish({ user, workspace, shopId: workspace === 'vendor' ? shopId : null });
}

export function selectWorkspace(workspace: Workspace) {
  if (!availableWorkspaces(snapshot.user).includes(workspace)) {
    throw new Error('This workspace is not available for your account.');
  }
  if (snapshot.workspace !== workspace) {
    publish({ user: snapshot.user, workspace, shopId: null });
  }
}

export function selectShop(shopId: string | null, ownedIds: string[]) {
  if (
    snapshot.workspace !== 'vendor' ||
    (shopId && !ownedIds.includes(shopId))
  ) {
    throw new Error('Select a shop owned by your vendor profile.');
  }
  if (snapshot.shopId !== shopId) publish({ ...snapshot, shopId });
}

export function trackWorkspaceRequest(controller: AbortController) {
  requests.add(controller);
  return () => {
    requests.delete(controller);
  };
}
