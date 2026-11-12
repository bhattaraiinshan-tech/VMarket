import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installTestWorkspace } from '@/test-workspace';
import ProductDetails from './[slug]/product-details';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const product = {
  id: 'product-1', shop_id: 'other-shop', shop_name: 'Local shop', shop_slug: 'local-shop',
  category_id: 'category-1', category_name: 'Food', brand_name: null, name: 'Rice',
  slug: 'rice', description: 'Rice description', sku: 'RICE', price: '100',
  stock: 5, available: true, attributes: { origin: 'Nepal' },
  images: [
    { id: 'image-1', url: '/first.jpg', alt_text: 'Rice front', sort_order: 0 },
    { id: 'image-2', url: '/second.jpg', alt_text: 'Rice back', sort_order: 1 },
  ],
  variants: [{ id: 'variant-1', name: 'Large', sku: 'LARGE', price: '120', stock: 3, attributes: {} }],
};

function installFetch() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith('/catalog/products/rice')) return Response.json(product);
    if (url.includes('/catalog/products?')) return Response.json({ items: [{ ...product, id: 'other', name: 'Other rice', slug: 'other' }] });
    if (url.endsWith('/reviews')) return Response.json([{ id: 'review-1', title: 'Good', rating: 5, body: 'Great', customer_name: 'Customer', created_at: '2026-01-01', vendor_response: null }]);
    if (url.endsWith('/me/wishlist')) return Response.json([product]);
    if (url.includes('/me/wishlist/')) return new Response(null, { status: 204 });
    if (url.endsWith('/me/cart/items') && init?.method === 'POST') return Response.json({});
    if (url.endsWith('/me/reviews/review-1/reports')) return Response.json({});
    throw new Error(`Unexpected request: ${url}`);
  });
}

beforeEach(() => installTestWorkspace());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('product details', () => {
  it('switches real gallery images and displays real product and review information', async () => {
    installFetch();
    render(<ProductDetails slug="rice" />);
    expect(await screen.findByRole('img', { name: 'Rice front' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show image 2: Rice back' }));
    expect(screen.getByRole('img', { name: 'Rice back' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show image 2: Rice back' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByText('Product details'));
    expect(screen.getByText('Nepal')).toBeVisible();
    expect(await screen.findByText('Good')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Other rice/ })).toHaveAttribute('href', '/marketplace/other');
  });

  it('honors variant stock and uses the existing wishlist state', async () => {
    const fetchMock = installFetch();
    render(<ProductDetails slug="rice" />);
    expect(await screen.findByRole('button', { name: '♥ Saved to wishlist' })).toHaveAttribute('aria-pressed', 'true');
    const quantity = screen.getByRole('spinbutton', { name: 'Quantity' });
    fireEvent.change(quantity, { target: { value: '4' } });
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeDisabled();
    fireEvent.change(quantity, { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }));
    expect(await screen.findByText('2 items added to your cart.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST' && String(init.body).includes('"variant_id":"variant-1"'))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '♥ Saved to wishlist' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '♡ Add to wishlist' })).toBeInTheDocument());
  });
});
