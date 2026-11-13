import type { Cart, CartItem } from '@/lib/api';

export const DELIVERY_FEE_PER_SHOP = '100.00';
export const MAX_CART_QUANTITY = 50;

function toMinor(amount: string): bigint {
  const [whole = '0', fraction = ''] = amount.split('.');
  return BigInt(`${whole || '0'}${fraction.padEnd(2, '0').slice(0, 2)}`);
}

function fromMinor(value: bigint): string {
  const padded = value.toString().padStart(3, '0');
  return `${padded.slice(0, -2)}.${padded.slice(-2)}`;
}

export function addNprAmounts(...amounts: string[]): string {
  return fromMinor(
    amounts.reduce((total, amount) => total + toMinor(amount), BigInt(0)),
  );
}

export function multiplyNpr(amount: string, times: number): string {
  return fromMinor(toMinor(amount) * BigInt(times));
}

export function maxCartQuantity(item: CartItem): number {
  return Math.max(0, Math.min(MAX_CART_QUANTITY, item.available_stock));
}

export type ShopDelivery = {
  shopId: string;
  shopName: string;
  itemCount: number;
  subtotal: string;
};

export function deliveryByShop(cart: Cart): ShopDelivery[] {
  const shops = new Map<string, ShopDelivery>();
  for (const item of cart.items) {
    const current = shops.get(item.shop_id);
    shops.set(item.shop_id, {
      shopId: item.shop_id,
      shopName: item.shop_name,
      itemCount: (current?.itemCount ?? 0) + item.quantity,
      subtotal: addNprAmounts(current?.subtotal ?? '0.00', item.line_total),
    });
  }
  return Array.from(shops.values());
}

export function cartEstimate(cart: Cart) {
  const shops = deliveryByShop(cart);
  const delivery = multiplyNpr(DELIVERY_FEE_PER_SHOP, shops.length);
  return {
    shops,
    delivery,
    total: addNprAmounts(cart.subtotal, delivery),
  };
}
