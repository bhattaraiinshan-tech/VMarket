export const API_BASE_URL =
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
  const context = getWorkspaceSnapshot();
  const pathname = path.split('?')[0];
  const method = (init.method ?? 'GET').toUpperCase();
  const vendor = /^\/(vendor\/|trade(?:\/|$))/.test(pathname);
  const admin = pathname.startsWith('/admin/');
  const shared =
    /^\/me\/(notifications|support-tickets|conversations)(?:\/|$)/.test(
      pathname,
    );
  const customer =
    (pathname === '/me' && method === 'PATCH') ||
    (pathname.startsWith('/me/') &&
      !shared &&
      !['/me/export', '/me/deactivate'].includes(pathname)) ||
    /^\/(checkout|orders|payments)(?:\/|$)/.test(pathname);
  let required: Workspace | null = vendor
    ? 'vendor'
    : admin
      ? 'admin'
      : customer
        ? 'customer'
        : null;
  if (shared) required = context.workspace;
  if (
    (vendor || admin || customer || shared) &&
    (!context.user || !required || context.workspace !== required)
  ) {
    throw new ApiError(
      `${vendor ? 'Vendor' : admin ? 'Admin' : customer ? 'Customer' : 'An authenticated'} workspace is required. Use the workspace selector.`,
      403,
    );
  }
  if (
    shared &&
    context.workspace === 'admin' &&
    pathname.startsWith('/me/conversations')
  ) {
    throw new ApiError('Messages require Customer or Vendor workspace.', 403);
  }
  const shopBound =
    (vendor && pathname !== '/vendor/shops') ||
    (shared && context.workspace === 'vendor');
  if (shopBound && !context.shopId) {
    throw new ApiError(
      'Select a shop before using this vendor workspace.',
      403,
    );
  }
  const isFormData = init.body instanceof FormData;
  const headers = new Headers(init.headers);
  headers.delete('X-VMarket-Workspace');
  headers.delete('X-VMarket-Shop-Id');
  if (!isFormData && init.body !== undefined)
    headers.set('Content-Type', 'application/json');
  if (required) headers.set('X-VMarket-Workspace', required);
  if (shopBound && context.shopId)
    headers.set('X-VMarket-Shop-Id', context.shopId);
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (init.signal?.aborted) controller.abort();
  init.signal?.addEventListener('abort', abort, { once: true });
  const untrack = trackWorkspaceRequest(controller);
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      credentials: 'include',
      headers,
      signal: controller.signal,
    });
    const payload: unknown =
      response.status === 204
        ? undefined
        : await response.json().catch(() => null);
    if (
      controller.signal.aborted ||
      context.revision !== getWorkspaceSnapshot().revision
    ) {
      throw new DOMException(
        'Workspace changed; obsolete response discarded.',
        'AbortError',
      );
    }
    if (!response.ok) {
      let message = 'The request could not be completed.';
      if (
        typeof payload === 'object' &&
        payload !== null &&
        'error' in payload
      ) {
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
      if (response.status === 401) setWorkspaceUser(null);
      throw new ApiError(message, response.status);
    }
    if (
      (pathname === '/me' || pathname === '/auth/login') &&
      payload &&
      typeof payload === 'object' &&
      'id' in payload &&
      'roles' in payload
    ) {
      setWorkspaceUser(payload as WorkspaceUser);
    }
    if (pathname === '/auth/logout' || pathname === '/me/deactivate')
      setWorkspaceUser(null);
    return payload as T;
  } finally {
    untrack();
    init.signal?.removeEventListener('abort', abort);
  }
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
  is_active: boolean;
  slot: number;
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
  order_id: string;
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
  workspace: Workspace;
  shop_id: string | null;
  order_id: string | null;
  fulfillment_order_id: string | null;
  conversation_id: string | null;
  title: string;
  message: string;
  read_at: string | null;
  created_at: string;
};

export type ConversationMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  read_at: string | null;
  created_at: string;
};

export type Conversation = {
  id: string;
  shop_id: string;
  shop_owner_id: string;
  shop_name: string;
  customer_id: string;
  customer_name: string;
  current_user_id: string;
  product_id: string | null;
  product_name: string | null;
  order_id: string | null;
  unread_count: number;
  last_message: ConversationMessage | null;
  created_at: string;
  updated_at: string;
};

export type ProductReview = {
  id: string;
  product_id: string;
  product_name: string;
  order_item_id: string;
  customer_name: string;
  rating: number;
  title: string;
  body: string;
  moderation_status: 'pending' | 'visible' | 'hidden';
  vendor_response: string | null;
  created_at: string;
  vendor_responded_at: string | null;
};

export type SupportTicket = {
  id: string;
  workspace: Workspace;
  shop_id: string | null;
  created_by_id: string;
  order_id: string | null;
  kind: 'support' | 'dispute';
  subject: string;
  body: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  admin_response: string | null;
  assigned_admin_id: string | null;
  created_at: string;
  updated_at: string;
};

export type WholesalePriceTier = {
  id: string;
  minimum_quantity: number;
  unit_price: string;
};

export type WholesaleListing = {
  id: string;
  shop_id: string;
  shop_name: string;
  shop_slug: string;
  city: string;
  province: string;
  product_id: string;
  product_name: string;
  product_description: string;
  product_sku: string;
  minimum_order_quantity: number;
  available_quantity: number;
  unit_label: string;
  is_active: boolean;
  price_tiers: WholesalePriceTier[];
  created_at: string;
};

export type TradeQuote = {
  id: string;
  revision: number;
  quantity: number;
  unit_price: string;
  delivery_terms: string;
  valid_until: string | null;
  status: 'pending' | 'accepted' | 'rejected' | 'superseded';
  created_at: string;
};

export type TradeRFQ = {
  id: string;
  buyer_shop_id: string;
  buyer_shop_name: string;
  seller_shop_id: string;
  seller_shop_name: string;
  listing_id: string;
  product_name: string;
  quantity: number;
  requested_delivery_date: string | null;
  delivery_terms: string;
  message: string;
  status: 'open' | 'quoted' | 'accepted' | 'declined' | 'cancelled';
  quotes: TradeQuote[];
  negotiation_history: {
    id: string;
    quote_id: string | null;
    actor_shop_id: string;
    note: string;
    created_at: string;
  }[];
  created_at: string;
  updated_at: string;
};

export type TradeDocument = {
  id: string;
  purchase_order_id: string | null;
  transfer_id: string | null;
  uploader_shop_id: string;
  original_filename: string;
  content_type: string;
  file_size: number;
  uploaded_at: string;
};

export type TradePurchaseOrder = {
  id: string;
  rfq_id: string;
  quote_id: string;
  buyer_shop_id: string;
  buyer_shop_name: string;
  seller_shop_id: string;
  seller_shop_name: string;
  listing_id: string;
  product_name: string;
  order_number: string;
  quantity: number;
  unit_price: string;
  total: string;
  delivery_terms: string;
  status: 'placed' | 'confirmed' | 'shipped' | 'received' | 'cancelled';
  business_review_submitted: boolean;
  events: {
    id: string;
    actor_shop_id: string | null;
    from_status: string | null;
    to_status: string;
    note: string | null;
    created_at: string;
  }[];
  documents: TradeDocument[];
  created_at: string;
  updated_at: string;
};

export type TradeStockTransfer = {
  id: string;
  source_shop_id: string;
  source_shop_name: string;
  destination_shop_id: string;
  destination_shop_name: string;
  source_product_id: string;
  source_product_name: string;
  destination_product_id: string;
  destination_product_name: string;
  quantity: number;
  delivery_terms: string;
  status:
    | 'requested'
    | 'approved'
    | 'rejected'
    | 'shipped'
    | 'received'
    | 'cancelled';
  events: {
    id: string;
    actor_shop_id: string | null;
    from_status: string | null;
    to_status: string;
    note: string | null;
    created_at: string;
  }[];
  documents: TradeDocument[];
  created_at: string;
  updated_at: string;
};

export type TradeBusinessReview = {
  id: string;
  reviewer_shop_id: string;
  supplier_shop_id: string;
  rating: number;
  body: string;
  created_at: string;
};

export type TradeSupplier = {
  shop_id: string;
  shop_name: string;
  shop_slug: string;
  city: string;
  province: string;
  active_listing_count: number;
  completed_trade_count: number;
  average_rating: string | null;
  reviews: TradeBusinessReview[];
};
import {
  getWorkspaceSnapshot,
  setWorkspaceUser,
  trackWorkspaceRequest,
  type Workspace,
  type WorkspaceUser,
} from './workspace-state';
