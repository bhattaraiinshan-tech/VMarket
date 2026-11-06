import {
  setWorkspaceUser,
  selectWorkspace,
  selectShop,
  type Workspace,
} from './lib/workspace-state';

export const testUser = {
  id: 'user-1',
  email: 'customer@example.com',
  email_verified: true,
  account_status: 'active',
  roles: ['customer', 'vendor', 'admin'],
  profile: { full_name: 'Test Customer', phone: null },
  vendor_profile: { business_name: 'Test Business' },
};

export function installTestWorkspace(
  mode: Workspace = 'customer',
  shopId = 'buyer-shop',
) {
  setWorkspaceUser(testUser);
  selectWorkspace(mode);
  if (mode === 'vendor') selectShop(shopId, [shopId]);
}
