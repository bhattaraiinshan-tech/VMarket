'use client';

import {
  AccountProfile,
  AccountSecurity,
  ShopProfile,
} from '@/components/account/account-profile';
import { useWorkspace } from '@/lib/workspace-context';
import VendorShell, { VendorPageHeader } from '../vendor-shell';

export default function VendorProfile() {
  const { user, workspace, shopId } = useWorkspace();
  return (
    <VendorShell active="profile">
      <VendorPageHeader
        title="Profile settings"
        description="Manage your details, business profile, preferences and account security."
      />
      <AccountProfile
        key={`${user?.id}:${workspace}:${shopId}`}
        workspace="vendor"
      />
      <ShopProfile key={shopId} />
      {user && (
        <AccountSecurity
          key={`${user.id}:${workspace}`}
          email={user.email}
          workspace="vendor"
          sessionsHref="/#security"
        />
      )}
    </VendorShell>
  );
}
