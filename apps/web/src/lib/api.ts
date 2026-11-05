const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000/api/v1';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function requestApi<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const isFormData = init.body instanceof FormData;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(!isFormData && init.body !== undefined
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...init.headers,
    },
  });
  const payload: unknown =
    response.status === 204
      ? undefined
      : await response.json().catch(() => null);
  if (!response.ok) {
    let message = 'The request could not be completed.';
    if (typeof payload === 'object' && payload !== null && 'error' in payload) {
      const error = payload.error;
      if (
        typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof error.message === 'string'
      ) {
        message = error.message;
      }
    }
    throw new ApiError(message, response.status);
  }
  return payload as T;
}

export type CategoryAttribute = {
  id: string;
  key: string;
  label: string;
  value_type: 'text' | 'number' | 'boolean';
  required: boolean;
  applies_to_variant: boolean;
};

export type Category = {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  attributes: CategoryAttribute[];
};

export type Brand = {
  id: string;
  name: string;
  slug: string;
};

export type ProductVariant = {
  id: string;
  name: string;
  sku: string;
  price: string;
  stock: number;
  attributes: Record<string, string>;
};

export type Product = {
  id: string;
  shop_id: string;
  shop_name: string;
  shop_slug: string;
  category_id: string;
  category_name: string;
  brand_id: string | null;
  brand_name: string | null;
  name: string;
  slug: string;
  description: string;
  sku: string;
  price: string;
  stock: number;
  available: boolean;
  attributes: Record<string, string>;
  status: string;
  moderation_notes: string | null;
  images: { id: string; url: string; alt_text: string; sort_order: number }[];
  variants: ProductVariant[];
  created_at: string;
};

export type ProductPage = {
  items: Product[];
  total: number;
  page: number;
  page_size: number;
};

export type Shop = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  address: string | null;
  city: string;
  province: string;
  latitude: string | null;
  longitude: string | null;
  logo_url: string | null;
  distance_km: number | null;
  created_at: string;
};

export type DeliveryAddress = {
  id: string;
  label: string;
  recipient_name: string;
  phone: string;
  province: string;
  city: string;
  area: string | null;
  street_address: string;
  postal_code: string | null;
  is_default: boolean;
  created_at: string;
};

export type CartItem = {
  id: string;
  product_id: string;
  variant_id: string | null;
  product_name: string;
  variant_name: string | null;
  shop_id: string;
  shop_name: string;
  unit_price: string;
  quantity: number;
  available_stock: number;
  line_total: string;
};

export type Cart = {
  items: CartItem[];
  item_count: number;
  subtotal: string;
};

export type OrderItem = {
  id: string;
  product_id: string | null;
  variant_id: string | null;
  product_name: string;
  variant_name: string | null;
  sku: string;
  quantity: number;
  unit_price: string;
  line_total: string;
};

export type OrderEvent = {
  id: string;
  from_status: string | null;
  to_status: string;
  note: string | null;
  created_at: string;
};

export type PaymentTransaction = {
  id: string;
  transaction_type: 'charge' | 'refund';
  method: 'cash_on_delivery';
  status: 'pending' | 'collected' | 'cancelled' | 'refund_due' | 'refunded';
  amount: string;
  created_at: string;
  updated_at: string;
};

export type FulfillmentOrder = {
  id: string;
  fulfillment_number: string;
  shop_id: string | null;
  shop_name: string;
  status: string;
  subtotal: string;
  shipping_fee: string;
  tracking_number: string | null;
  created_at: string;
  updated_at: string;
  items: OrderItem[];
  events: OrderEvent[];
  transactions: PaymentTransaction[];
};

export type Order = {
  id: string;
  order_number: string;
  invoice_number: string;
  status: string;
  payment_method: 'cash_on_delivery';
  shipping_address: Record<string, string | null>;
  subtotal: string;
  shipping_total: string;
  total: string;
  created_at: string;
  updated_at: string;
  fulfillments: FulfillmentOrder[];
};

export type Notification = {
  id: string;
  order_id: string | null;
  fulfillment_order_id: string | null;
  title: string;
  message: string;
  read_at: string | null;
  created_at: string;
};
