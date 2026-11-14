import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import SupportPage from './support-page';
import { installTestWorkspace } from '@/test-workspace';
import {
  selectShop,
  selectWorkspace,
  setWorkspaceUser,
} from '@/lib/workspace-state';

vi.mock('@/components/notifications/notification-popover', () => ({
  default: () => (
    <button type="button" aria-label="Notifications">
      Notifications
    </button>
  ),
}));

const ticket = {
  id: 'ticket-1',
  subject: 'Delivery question',
  body: 'Please help with my delivery.',
  kind: 'support',
  status: 'open',
  created_at: '2026-01-01T00:00:00Z',
  admin_response: null,
};

function installFetch() {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json([]));
}

function fillTicket(subject = ticket.subject, message = ticket.body) {
  fireEvent.change(screen.getByLabelText('Subject'), {
    target: { value: subject },
  });
  fireEvent.change(screen.getByLabelText('Message', { exact: true }), {
    target: { value: message },
  });
}

afterEach(() => vi.restoreAllMocks());

describe('Support Center', () => {
  it('shows honest contact states and the active workspace navigation', async () => {
    installTestWorkspace();
    installFetch();
    render(<SupportPage orderId="" initialKind="support" />);
    await screen.findByText('You have no support requests.');
    expect(screen.getByRole('button', { name: 'Menu' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    expect(screen.getByRole('button', { name: 'Close menu' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close menu' }));
    expect(screen.getByRole('button', { name: 'Menu' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    const navigation = within(
      screen.getByRole('navigation', { name: 'Support workspace navigation' }),
    );
    expect(navigation.getByRole('link', { name: 'Support' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(navigation.getByRole('link', { name: 'My orders' })).toHaveAttribute(
      'href',
      '/orders',
    );
    expect(
      navigation.queryByRole('link', { name: 'Wholesale' }),
    ).not.toBeInTheDocument();
    for (const name of ['Start Chat', 'Send Email', 'Call Now']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
    expect(screen.queryByText(/within 24h|2-4 hours/)).not.toBeInTheDocument();
    expect(
      screen.getAllByRole('link', { name: /Submit a ticket/i })[0],
    ).toHaveAttribute('href', '#support-ticket');
  });

  it('toggles accessible FAQ panels and searches questions and answers from either input', async () => {
    installTestWorkspace();
    installFetch();
    render(<SupportPage orderId="" initialKind="support" />);
    await screen.findByText('You have no support requests.');
    const tracking = screen.getByRole('button', {
      name: 'How do I track my order?',
    });
    expect(tracking).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByRole('region', { name: 'How do I track my order?' }),
    ).toBeVisible();
    fireEvent.click(tracking);
    expect(tracking).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.queryByRole('region', { name: 'How do I track my order?' }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Which payment methods are available?',
      }),
    );
    expect(
      screen.getByRole('region', {
        name: 'Which payment methods are available?',
      }),
    ).toHaveTextContent('cash on delivery');
    fireEvent.change(screen.getByLabelText('Search support'), {
      target: { value: '  CASH ON DELIVERY  ' },
    });
    expect(screen.getByLabelText('Search FAQs')).toHaveValue(
      '  CASH ON DELIVERY  ',
    );
    expect(
      screen.queryByRole('button', { name: 'How do I track my order?' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Which payment methods are available?',
      }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search FAQs'), {
      target: { value: 'no-such-answer' },
    });
    expect(
      screen.getByText(
        'No FAQs match your search. Try another term or submit a ticket.',
      ),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search FAQs'), {
      target: { value: '' },
    });
    expect(
      screen.getByRole('button', { name: 'How do I track my order?' }),
    ).toBeInTheDocument();
  });

  it('submits a trimmed, order-linked dispute and preserves replies and history', async () => {
    installTestWorkspace();
    const fetchMock = installFetch().mockImplementation(
      async (_input, options) =>
        options?.method === 'POST'
          ? Response.json({ ...ticket, kind: 'dispute' }, { status: 201 })
          : Response.json([
              {
                ...ticket,
                id: 'earlier',
                subject: 'Earlier ticket',
                admin_response: 'We are investigating.',
              },
            ]),
    );
    render(<SupportPage orderId="order-1" initialKind="dispute" />);
    await screen.findByText('Earlier ticket');
    expect(
      screen.getByText('Support response: We are investigating.'),
    ).toBeInTheDocument();
    fillTicket(` ${ticket.subject} `, ` ${ticket.body} `);
    fireEvent.click(screen.getByRole('button', { name: 'Submit Ticket' }));
    await screen.findByText('Your request was sent to the support team.');
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining('/me/support-tickets'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          kind: 'dispute',
          order_id: 'order-1',
          subject: ticket.subject,
          body: ticket.body,
        }),
      }),
    );
    expect(screen.getByLabelText('Subject')).toHaveValue('');
    expect(screen.getByLabelText('Message', { exact: true })).toHaveValue('');
    expect(screen.getByText(ticket.subject)).toBeInTheDocument();
    expect(screen.getByText('Earlier ticket')).toBeInTheDocument();
  });

  it('requires an order for disputes and rejects whitespace-only input explicitly', async () => {
    installTestWorkspace();
    const fetchMock = installFetch();
    render(<SupportPage orderId="" initialKind="dispute" />);
    await screen.findByText('You have no support requests.');
    expect(
      screen.getByRole('button', { name: 'Submit Ticket' }),
    ).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Start an order dispute from the relevant order page',
    );
    fireEvent.change(screen.getByLabelText('Request type'), {
      target: { value: 'support' },
    });
    fillTicket('   ', '   ');
    fireEvent.click(screen.getByRole('button', { name: 'Submit Ticket' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter a subject and message with more than just spaces.',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the draft on submission failure and prevents duplicate pending submissions', async () => {
    installTestWorkspace();
    let rejectSubmission!: (reason: Error) => void;
    const pending = new Promise<Response>((_resolve, reject) => {
      rejectSubmission = reject;
    });
    const fetchMock = installFetch().mockImplementation((_input, options) =>
      options?.method === 'POST' ? pending : Promise.resolve(Response.json([])),
    );
    render(<SupportPage orderId="" initialKind="support" />);
    await screen.findByText('You have no support requests.');
    fillTicket();
    fireEvent.click(screen.getByRole('button', { name: 'Submit Ticket' }));
    expect(
      screen.getByRole('button', { name: 'Submitting...' }),
    ).toBeDisabled();
    expect(screen.getByLabelText('Subject')).toBeDisabled();
    await act(async () => rejectSubmission(new Error('Connection lost')));
    expect(screen.getByRole('alert')).toHaveTextContent('Connection lost');
    expect(screen.getByLabelText('Subject')).toHaveValue(ticket.subject);
    expect(screen.getByRole('button', { name: 'Submit Ticket' })).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('distinguishes failed history from empty history and retries', async () => {
    installTestWorkspace();
    const fetchMock = installFetch().mockRejectedValueOnce(
      new Error('History unavailable'),
    );
    render(<SupportPage orderId="" initialKind="support" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'History unavailable',
    );
    expect(
      screen.queryByText('You have no support requests.'),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('You have no support requests.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not request personal support in the admin workspace', () => {
    installTestWorkspace('admin');
    const fetchMock = installFetch();
    render(<SupportPage orderId="" initialKind="support" />);
    expect(
      screen.getByRole('link', {
        name: 'Open platform support and moderation queue',
      }),
    ).toHaveAttribute('href', '/admin/communications');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['shop', 'workspace', 'account'] as const)(
    'discards late history and submission results after a %s change',
    async (change) => {
      installTestWorkspace('vendor', 'shop-1');
      const pending: ((response: Response) => void)[] = [];
      const fetchMock = installFetch().mockImplementation(
        () => new Promise<Response>((resolve) => pending.push(resolve)),
      );
      render(<SupportPage orderId="" initialKind="support" />);
      expect(screen.getByRole('link', { name: 'Wholesale' })).toHaveAttribute(
        'href',
        '/vendor/trade',
      );
      fillTicket();
      fireEvent.click(screen.getByRole('button', { name: 'Submit Ticket' }));
      const headers = new Headers(fetchMock.mock.calls[1][1]?.headers);
      expect(headers.get('X-VMarket-Workspace')).toBe('vendor');
      expect(headers.get('X-VMarket-Shop-Id')).toBe('shop-1');
      act(() => {
        if (change === 'shop') selectShop('shop-2', ['shop-1', 'shop-2']);
        else if (change === 'workspace') selectWorkspace('customer');
        else
          setWorkspaceUser({
            id: 'another-account',
            email: 'another@example.com',
            email_verified: true,
            account_status: 'active',
            roles: ['customer'],
            profile: { full_name: 'Another customer', phone: null },
            vendor_profile: null,
          });
      });
      expect(screen.getByLabelText('Subject')).toHaveValue('');
      expect(
        screen.getByRole('button', { name: 'Submit Ticket' }),
      ).toBeEnabled();
      await act(async () => {
        pending[0](Response.json([{ ...ticket, subject: 'Old shop history' }]));
        pending[1](Response.json(ticket));
        pending[2](Response.json([]));
      });
      await waitFor(() =>
        expect(
          screen.getByText('You have no support requests.'),
        ).toBeInTheDocument(),
      );
      expect(screen.queryByText('Old shop history')).not.toBeInTheDocument();
      expect(screen.queryByText(ticket.subject)).not.toBeInTheDocument();
      expect(
        screen.queryByText('Your request was sent to the support team.'),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    },
  );
});
