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
