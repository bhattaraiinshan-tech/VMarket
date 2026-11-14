import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import CustomerOrders from './orders/orders';
import OrderDetails from './orders/[orderId]/order-details';
import NotificationsPage from './notifications/notifications-page';
import MessagesPage from './messages/page';
import ShopDetails from './shops/[slug]/shop-details';
import SupportPage from './support/support-page';
import VendorOrders from './vendor/orders/vendor-orders';
import VendorReviewsPage from './vendor/reviews/page';
import VendorPromotionsPage from './vendor/promotions/page';
import AdminCatalog from './admin/catalog/admin-catalog';
import AdminCommunicationsPage from './admin/communications/page';
import AdminOperationsPage from './admin/operations/page';
import { requestApi } from '@/lib/api';

vi.mock('@/lib/api', () => ({ requestApi: vi.fn() }));
vi.mock('@/lib/workspace-context', () => ({
  useWorkspace: () => ({ workspace: 'customer', shopId: null }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('request states', () => {
  it.each([
    ['orders', <CustomerOrders key="orders" />, 'No orders yet'],
    [
      'notifications',
      <NotificationsPage key="notifications" />,
      "You're all caught up",
    ],
    [
      'messages',
      <MessagesPage key="messages" />,
      'No conversations yet. Message a vendor from a product page.',
    ],
    [
      'vendor orders',
      <VendorOrders key="vendor-orders" />,
      'No orders are waiting for your shop.',
    ],
    [
      'reviews',
      <VendorReviewsPage key="reviews" />,
      'Your shop has no published customer reviews yet.',
    ],
    [
      'support',
      <SupportPage key="support" orderId="" initialKind="support" />,
      'You have no support requests.',
    ],
    [
      'promotions',
      <VendorPromotionsPage key="promotions" />,
      'No promotions have been created for this shop.',
    ],
    [
      'catalogue administration',
      <AdminCatalog key="catalogue" />,
      'No product listings are waiting for review.',
    ],
    [
      'communications administration',
      <AdminCommunicationsPage key="communications" />,
      'No open support requests.',
    ],
    [
      'operations administration',
      <AdminOperationsPage key="operations" />,
      'No fraud reports are waiting for investigation.',
    ],
  ])(
    'does not present a failed %s request as an empty list',
    async (_, page, emptyText) => {
      vi.mocked(requestApi).mockRejectedValue(new Error('Network unavailable'));
      render(page);
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Network unavailable',
      );
      const emptyState = screen.queryByText(emptyText);
      if (emptyState) expect(emptyState).not.toBeVisible();
    },
  );

  it('does not keep showing loading after order details fail', async () => {
    vi.mocked(requestApi).mockRejectedValue(new Error('Order unavailable'));
    render(<OrderDetails orderId="order-1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Order unavailable',
    );
    expect(screen.queryByText('Loading order…')).not.toBeInTheDocument();
  });

  it('waits for shop listings before showing the empty state', async () => {
    let resolveListings: (value: unknown) => void = () => {};
    const listings = new Promise((resolve) => {
      resolveListings = resolve;
    });
    vi.mocked(requestApi).mockImplementation((path) =>
      path.startsWith('/shops/')
        ? Promise.resolve({
            id: 'shop-1',
            name: 'Local shop',
            city: 'Kathmandu',
            province: 'Bagmati',
          })
        : listings,
    );
    render(<ShopDetails slug="local-shop" />);
    expect(await screen.findByText('Loading listings…')).toBeInTheDocument();
    expect(
      screen.queryByText('This shop has no published products yet.'),
    ).not.toBeInTheDocument();
    resolveListings({ items: [] });
    expect(
      await screen.findByText('This shop has no published products yet.'),
    ).toBeInTheDocument();
  });

  it('keeps customer notification links in the active workspace', async () => {
    vi.mocked(requestApi).mockResolvedValue([]);
    render(<NotificationsPage />);
    await waitFor(() =>
      expect(screen.getByText("You're all caught up")).toBeInTheDocument(),
    );
    expect(screen.getByRole('link', { name: /^Orders$/ })).toHaveAttribute(
      'href',
      '/orders',
    );
    expect(
      screen.queryByRole('link', { name: 'Vendor fulfillment' }),
    ).not.toBeInTheDocument();
  });

  it('keeps a newly sent request when support history finishes loading later', async () => {
    let resolveHistory: (value: unknown) => void = () => {};
    const history = new Promise((resolve) => {
      resolveHistory = resolve;
    });
    vi.mocked(requestApi).mockImplementation((_path, options) =>
      options?.method === 'POST'
        ? Promise.resolve({
            id: 'new-ticket',
            subject: 'Delivery question',
            body: 'Please help.',
            kind: 'support',
            status: 'open',
            created_at: '2026-01-01T00:00:00Z',
          })
        : history,
    );
    render(<SupportPage orderId="" initialKind="support" />);
    fireEvent.change(screen.getByLabelText('Subject'), {
      target: { value: 'Delivery question' },
    });
    fireEvent.change(screen.getByLabelText('Details'), {
      target: { value: 'Please help.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send to support' }));
    await screen.findByText('Your request was sent to the support team.');
    resolveHistory([]);
    expect(await screen.findByText('Delivery question')).toBeInTheDocument();
  });
});
