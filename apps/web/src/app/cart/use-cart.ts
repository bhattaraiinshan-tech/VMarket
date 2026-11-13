'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Cart, CartItem, requestApi } from '@/lib/api';
import { maxCartQuantity } from './cart-money';

export type CartAction = 'quantity' | 'remove' | 'save';
export type PendingCartAction = { itemId: string; action: CartAction };

function isAbort(cause: unknown) {
  return cause instanceof DOMException && cause.name === 'AbortError';
}

function messageFor(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

export function useCart({
  initialCart = null,
  onCartChange,
}: {
  initialCart?: Cart | null;
  onCartChange?: (cart: Cart) => void;
} = {}) {
  const [cart, setCart] = useState<Cart | null>(initialCart);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<PendingCartAction | null>(null);
  const [reloading, setReloading] = useState(false);
  const revision = useRef(0);
  const busy = useRef(false);
  const changeHandler = useRef(onCartChange);

  useEffect(() => {
    changeHandler.current = onCartChange;
  }, [onCartChange]);

  const apply = useCallback((next: Cart) => {
    setCart(next);
    changeHandler.current?.(next);
  }, []);

  const fetchCart = useCallback(
    async (signal?: AbortSignal) => {
      const current = ++revision.current;
      try {
        const next = await requestApi<Cart>('/me/cart', { signal });
        if (current === revision.current) {
          apply(next);
          setError('');
        }
      } catch (cause: unknown) {
        if (current === revision.current && !isAbort(cause))
          setError(messageFor(cause, 'Your cart could not be loaded.'));
      }
    },
    [apply],
  );

  const seeded = useRef(initialCart !== null);

  useEffect(() => {
    if (seeded.current) return;
    const controller = new AbortController();
    void fetchCart(controller.signal);
    return () => {
      controller.abort();
      revision.current += 1;
    };
  }, [fetchCart]);

  const reload = useCallback(async () => {
    if (busy.current) return;
    setReloading(true);
    setError('');
    await fetchCart();
    setReloading(false);
  }, [fetchCart]);

  async function mutate(
    item: CartItem,
    action: CartAction,
    run: () => Promise<Cart>,
    success: string,
    fallback: string,
  ) {
    if (busy.current) return;
    busy.current = true;
    const current = ++revision.current;
    setPending({ itemId: item.id, action });
    setError('');
    setNotice('');
    try {
      const next = await run();
      if (current === revision.current) {
        apply(next);
        setNotice(success);
      }
    } catch (cause: unknown) {
      if (current === revision.current && !isAbort(cause))
        setError(messageFor(cause, fallback));
    } finally {
      busy.current = false;
      setPending(null);
    }
  }

  function setQuantity(item: CartItem, quantity: number) {
    const max = maxCartQuantity(item);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > max) {
      setNotice('');
      setError(
        max < 1
          ? `${item.product_name} is out of stock. Remove it or save it for later.`
          : `Choose a quantity from 1 to ${max} for ${item.product_name}.`,
      );
      return Promise.resolve();
    }
    if (quantity === item.quantity) return Promise.resolve();
    return mutate(
      item,
      'quantity',
      () =>
        requestApi<Cart>(`/me/cart/items/${item.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ quantity }),
        }),
      `${item.product_name} quantity updated to ${quantity}.`,
      'The quantity could not be updated.',
    );
  }

  function removeItem(item: CartItem) {
    return mutate(
      item,
      'remove',
      async () => {
        await requestApi<void>(`/me/cart/items/${item.id}`, {
          method: 'DELETE',
        });
        return requestApi<Cart>('/me/cart');
      },
      `${item.product_name} was removed from your cart.`,
      'The cart item could not be removed.',
    );
  }

  function saveForLater(item: CartItem) {
    return mutate(
      item,
      'save',
      async () => {
        await requestApi<void>(`/me/wishlist/${item.product_id}`, {
          method: 'POST',
        });
        try {
          await requestApi<void>(`/me/cart/items/${item.id}`, {
            method: 'DELETE',
          });
        } catch (cause: unknown) {
          if (isAbort(cause)) throw cause;
          throw new Error(
            `${item.product_name} was saved to your wishlist, but it could not be removed from your cart. ${messageFor(cause, '')}`.trim(),
          );
        }
        return requestApi<Cart>('/me/cart');
      },
      `${item.product_name} was moved to your wishlist.`,
      'The item could not be saved for later.',
    );
  }

  return {
    cart,
    loading: !cart && !error,
    reloading,
    error,
    notice,
    pending,
    reload,
    replaceCart: apply,
    setQuantity,
    removeItem,
    saveForLater,
  };
}
