import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceProvider } from '@/lib/workspace-context';
import { selectWorkspace, setWorkspaceUser } from '@/lib/workspace-state';
import { installTestWorkspace, testUser } from '@/test-workspace';
import WishlistPage from './page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/wishlist',
}));

const product = {
  id: 'basket',
  name: 'Woven Basket',
  slug: 'woven-basket',
  shop_name: 'Local shop',
  price: '100.25',
  available: true,
  images: [],
  category_name: 'Home',
};

afterEach(() => {
  cleanup();
  setWorkspaceUser(null);
  vi.restoreAllMocks();
});

describe('customer wishlist navigation', () => {
  it('loads saved products, links to real product details and removes a saved item', async () => {
    installTestWorkspace();
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input, options) => {
        if (String(input).endsWith('/me')) return Response.json(testUser);
        if (options?.method === 'DELETE')
          return new Response(null, { status: 204 });
        return Response.json([product]);
      });
    render(
      <WorkspaceProvider>
        <WishlistPage />
      </WorkspaceProvider>,
    );
    expect(
      await screen.findByText('Woven Basket', {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Woven Basket/ })).toHaveAttribute(
      'href',
      '/marketplace/woven-basket',
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Saved: Woven Basket' }),
    );
    expect(
      await screen.findByText('Your wishlist is empty'),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/me/wishlist/basket',
      expect.objectContaining({ method: 'DELETE', credentials: 'include' }),
    );
  });

  it('keeps saved products when removal fails', async () => {
    installTestWorkspace();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, options) =>
      options?.method === 'DELETE'
        ? Response.json(
            { error: { message: 'Removal unavailable' } },
            { status: 503 },
          )
        : Response.json([product]),
    );
    render(<WishlistPage />);
    await screen.findByText('Woven Basket');
    fireEvent.click(
      screen.getByRole('button', { name: 'Saved: Woven Basket' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Removal unavailable',
    );
    expect(screen.getByText('Woven Basket')).toBeInTheDocument();
  });

  it('blocks Vendor and Admin workspaces without requesting saved products', async () => {
    installTestWorkspace('vendor');
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) =>
        Response.json(String(input).endsWith('/vendor/shops') ? [] : testUser),
      );
    render(
      <WorkspaceProvider>
        <WishlistPage />
      </WorkspaceProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Select Customer workspace',
      ),
    );
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes('/me/wishlist'),
      ),
    ).toBe(false);
    act(() => selectWorkspace('admin'));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Select Customer workspace',
      ),
    );
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes('/me/wishlist'),
      ),
    ).toBe(false);
  });
});
