import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestApi } from '@/lib/api';
import type { AccountDetails } from '@/components/account/account-profile';
import { installTestWorkspace } from '@/test-workspace';
import { setWorkspaceUser } from '@/lib/workspace-state';
import VendorProfile from './page';

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  requestApi: vi.fn(),
}));
afterEach(() => {
  cleanup();
  setWorkspaceUser(null);
  vi.resetAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('vendor profile route', () => {
  it('reuses customer account forms, preferences, security and hash navigation', async () => {
    installTestWorkspace('vendor');
    window.history.replaceState(null, '', '/vendor/profile');
    const details: AccountDetails = {
      workspace: 'vendor',
      first_name: 'Test',
      last_name: 'Vendor',
      email: 'vendor@example.test',
      email_verified: true,
      phone: null,
      avatar_url: null,
      preferred_categories: [],
      communication_email: false,
      communication_sms: false,
      business_name: 'Craft House',
      business_category: 'Crafts',
      registration_number: null,
      payout_preference: null,
      business_description: null,
    };
    vi.mocked(requestApi).mockImplementation(async (path) => {
      if (path === '/auth/password/forgot')
        return { message: 'Reset link requested.' };
      return details;
    });
    render(<VendorProfile />);
    expect(await screen.findByLabelText('First name')).toHaveValue('Test');
    expect(screen.getByLabelText('Last name')).toHaveValue('Vendor');
    expect(screen.getByLabelText('Registered business name')).toHaveValue(
      'Craft House',
    );
    expect(screen.getByLabelText('Optional email updates')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My details' })).toHaveAttribute(
      'aria-current',
      'location',
    );
    expect(
      screen.getByRole('link', { name: 'Review signed-in devices' }),
    ).toHaveAttribute('href', '/#security');
    fireEvent.click(screen.getByRole('link', { name: 'Change password' }));
    expect(
      screen.getByRole('link', { name: 'Change password' }),
    ).toHaveAttribute('aria-current', 'location');
    fireEvent.change(screen.getByLabelText('First name'), {
      target: { value: 'Updated' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Your profile has been updated.');
    expect(requestApi).toHaveBeenCalledWith(
      '/me/account-details',
      expect.objectContaining({
        method: 'PATCH',
        body: expect.stringContaining('"first_name":"Updated"'),
      }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Send password reset link' }),
    );
    await screen.findByText('Reset link requested.');
  });
});
