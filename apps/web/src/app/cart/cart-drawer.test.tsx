import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cart } from '@/lib/api';
import { selectWorkspace, setWorkspaceUser } from '@/lib/workspace-state';
import { installTestWorkspace, testUser } from '@/test-workspace';

import CartDrawer from './cart-drawer';

const cart: Cart = {
  items: [
    {
      id: 'cart-item-1',
      product_id: 'product-1',
      product_slug: 'woven-basket',
      variant_id: null,
      product_name: 'Woven Basket',
      variant_name: null,
      sku: 'BASKET-1',
      image_url: 'http://storage.test/products/basket.jpg',
      image_alt: 'Basket front',
      shop_id: 'shop-1',
      shop_name: 'First Shop',
      unit_price: '100.50',
      quantity: 1,
      available_stock: 4,
      line_total: '100.50',
    },
  ],
  item_count: 1,
  subtotal: '100.50',
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('cart drawer', () => {
  beforeEach(() => installTestWorkspace());

  it('uses a seeded cart, updates quantities in place and links to checkout', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        ...cart,
        items: [{ ...cart.items[0], quantity: 2, line_total: '201.00' }],
        item_count: 2,
        subtotal: '201.00',
      }),
    );
    const onCartChange = vi.fn();
    const onClose = vi.fn();
    render(
      <CartDrawer
        initialCart={cart}
        onCartChange={onCartChange}
        onClose={onClose}
      />,
    );

    expect(
      screen.getByRole('dialog', { name: 'Your cart (1)' }),
    ).toHaveAttribute('aria-modal', 'true');
    expect(
      screen.getByRole('img', { name: 'Basket front' }),
    ).toBeInTheDocument();
    expect(screen.getByText('NPR 200.50')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole('button', { name: 'Increase Woven Basket quantity' }),
    );
    expect(
      await screen.findByRole('dialog', { name: 'Your cart (2)' }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/me/cart/items/cart-item-1'),
      expect.objectContaining({ method: 'PATCH' }),
    );
    expect(onCartChange).toHaveBeenCalledWith(
      expect.objectContaining({ item_count: 2 }),
    );
    expect(screen.getByText('NPR 301.00')).toBeInTheDocument();

    const checkout = screen.getByRole('link', { name: 'Checkout' });
    expect(checkout).toHaveAttribute('href', '/cart');
    checkout.addEventListener('click', (event) => event.preventDefault());
    fireEvent.click(checkout);
    expect(onClose).toHaveBeenCalled();
  });

  it('traps focus, locks scrolling and restores focus when closed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(cart));
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const onClose = vi.fn();
    const { unmount } = render(<CartDrawer onClose={onClose} />);

    const close = screen.getByRole('button', { name: 'Close cart' });
    expect(close).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');
    const continueShopping = await screen.findByRole('button', {
      name: 'Continue shopping',
    });

    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(continueShopping).toHaveFocus();
    fireEvent.keyDown(continueShopping, { key: 'Tab' });
    expect(close).toHaveFocus();

    fireEvent.keyDown(close, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    unmount();
    expect(document.body.style.overflow).toBe('');
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it('closes when the workspace or account changes', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(cart));
    const onClose = vi.fn();
    render(<CartDrawer initialCart={cart} onClose={onClose} />);
    expect(onClose).not.toHaveBeenCalled();

    act(() => selectWorkspace('vendor'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    cleanup();
    installTestWorkspace();
    const onAccountClose = vi.fn();
    render(<CartDrawer initialCart={cart} onClose={onAccountClose} />);
    act(() => setWorkspaceUser({ ...testUser, id: 'user-2' }));
    await waitFor(() => expect(onAccountClose).toHaveBeenCalled());
  });

  it('shows load failures with a retry instead of an empty cart', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        Response.json(
          { error: { code: 'unavailable', message: 'Cart unavailable' } },
          { status: 503 },
        ),
      )
      .mockResolvedValueOnce(Response.json(cart));
    render(<CartDrawer onClose={vi.fn()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Cart unavailable',
    );
    expect(screen.queryByText('Your cart is empty')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(
      await screen.findByRole('dialog', { name: 'Your cart (1)' }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
