import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installTestWorkspace } from '@/test-workspace';
import ProductDetails from './[slug]/product-details';
import type { Product } from '@/lib/api';
import { setWorkspaceUser } from '@/lib/workspace-state';
import { testUser } from '@/test-workspace';
import { WorkspaceProvider } from '@/lib/workspace-context';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/marketplace/rice',
}));

const product: Product = {
  id: 'product-1',
  shop_id: 'other-shop',
  shop_name: 'Local shop',
  shop_slug: 'local-shop',
  category_id: 'category-1',
  category_name: 'Food',
  brand_id: null,
  brand_name: null,
  name: 'Rice',
  slug: 'rice',
  description: 'Rice description',
  sku: 'RICE',
  price: '100',
  stock: 5,
  available: true,
  attributes: { origin: 'Nepal' },
  images: [
    { id: 'image-1', url: '/first.jpg', alt_text: 'Rice front', sort_order: 0 },
    { id: 'image-2', url: '/second.jpg', alt_text: 'Rice back', sort_order: 1 },
  ],
  variants: [
    {
      id: 'variant-1',
      name: 'Large',
      sku: 'LARGE',
      price: '120',
      stock: 3,
      attributes: {},
    },
  ],
  status: 'approved',
  moderation_notes: null,
  created_at: '2026-01-01',
};

function installFetch(overrides: Partial<Product> = {}) {
  const currentProduct = { ...product, ...overrides };
  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/me')) return Response.json(testUser);
      if (url.endsWith('/vendor/shops')) return Response.json([]);
      if (url.endsWith('/catalog/products/rice'))
        return Response.json(currentProduct);
      if (url.includes('/catalog/products?'))
        return Response.json({
          items: [
            { ...product, id: 'other', name: 'Other rice', slug: 'other' },
          ],
        });
      if (url.endsWith('/reviews'))
        return Response.json([
          {
            id: 'review-1',
            title: 'Good',
            rating: 5,
            body: 'Great',
            customer_name: 'Customer',
            created_at: '2026-01-01',
            vendor_response: null,
          },
        ]);
      if (url.endsWith('/me/wishlist')) return Response.json([product]);
      if (url.includes('/me/wishlist/'))
        return new Response(null, { status: 204 });
      if (url.endsWith('/me/cart'))
        return Response.json({ items: [], item_count: 2, subtotal: '200' });
      if (url.endsWith('/me/cart/items') && init?.method === 'POST')
        return Response.json({ items: [], item_count: 4, subtotal: '440' });
      if (url.endsWith('/me/reviews/review-1/reports'))
        return Response.json({});
      throw new Error(`Unexpected request: ${url}`);
    });
}

beforeEach(() => installTestWorkspace());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('product details', () => {
  it('switches real gallery images and displays real product and review information', async () => {
    installFetch();
    render(<ProductDetails slug="rice" />);
    const gallery = within(
      await screen.findByRole('region', { name: 'Product gallery' }),
    );
    expect(
      gallery.getByRole('img', { name: 'Rice front' }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Show image 2: Rice back' }),
    );
    expect(screen.getByRole('img', { name: 'Rice back' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Show image 2: Rice back' }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByRole('tab', { name: 'Product information' }),
    ).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Nepal')).toBeVisible();
    expect(await screen.findByText('Good')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Other rice/ })).toHaveAttribute(
      'href',
      '/marketplace/other',
    );
  });

  it('honors variant stock and uses the existing wishlist state', async () => {
    const fetchMock = installFetch();
    render(<ProductDetails slug="rice" />);
    expect(
      await screen.findByRole('button', { name: '♥ Saved to wishlist' }),
    ).toHaveAttribute('aria-pressed', 'true');
    const quantity = screen.getByRole('spinbutton', { name: 'Quantity' });
    fireEvent.change(quantity, { target: { value: '4' } });
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeDisabled();
    fireEvent.change(quantity, { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }));
    expect(
      await screen.findByText('2 items added to your cart.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My Bag (4)' })).toHaveAttribute(
      'href',
      '/cart',
    );
    expect(
      fetchMock.mock.calls.some(
        ([, init]) =>
          init?.method === 'POST' &&
          String(init.body).includes('"variant_id":"variant-1"'),
      ),
    ).toBe(true);
    fireEvent.click(
      screen.getByRole('button', { name: '♥ Saved to wishlist' }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: '♡ Add to wishlist' }),
      ).toBeInTheDocument(),
    );
  });

  it('switches real size and color combinations, updates price and submits the selected variant', async () => {
    const fetchMock = installFetch({
      attributes: { material: 'Cotton', origin: 'Nepal' },
      variants: [
        {
          id: 's-black',
          name: 'S Black',
          sku: 'SB',
          price: '120',
          stock: 3,
          attributes: { size: 'S', color: 'Black', weight: '400 g' },
        },
        {
          id: 'm-white',
          name: 'M White',
          sku: 'MW',
          price: '150',
          stock: 1,
          attributes: { size: 'M', color: 'White', weight: '450 g' },
        },
        {
          id: 'l-black',
          name: 'L Black',
          sku: 'LB',
          price: '160',
          stock: 0,
          attributes: { size: 'L', color: 'Black', weight: '450 g' },
        },
      ],
    });
    render(<ProductDetails slug="rice" />);
    expect(await screen.findByRole('button', { name: 'S' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'L (sold out)' })).toBeDisabled();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Quantity' }), {
      target: { value: '3' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'M' }));
    expect(screen.getByRole('button', { name: 'White' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('spinbutton', { name: 'Quantity' })).toHaveValue(1);
    expect(screen.getByText('NPR 150')).toBeVisible();
    expect(
      within(screen.getByRole('tabpanel')).getByText('450 g'),
    ).toBeVisible();
    expect(screen.getByText('Cotton')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }));
    await screen.findByText('1 item added to your cart.');
    expect(
      fetchMock.mock.calls.some(([, init]) =>
        String(init?.body).includes('"variant_id":"m-white"'),
      ),
    ).toBe(true);
  });

  it('supports keyboard tabs and displays shipping information without invented specifications', async () => {
    installFetch();
    render(<ProductDetails slug="rice" />);
    const information = await screen.findByRole('tab', {
      name: 'Product information',
    });
    expect(screen.getAllByText('Not provided')).toHaveLength(3);
    fireEvent.keyDown(information, { key: 'ArrowRight' });
    const shipping = screen.getByRole('tab', { name: 'Shipping & returns' });
    expect(shipping).toHaveFocus();
    expect(shipping).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/Shipping is NPR 100 per shop/)).toBeVisible();
    expect(screen.getByText('Nepal')).not.toBeVisible();
    fireEvent.keyDown(shipping, { key: 'Home' });
    expect(information).toHaveFocus();
    expect(screen.getByText('Nepal')).toBeVisible();
    fireEvent.keyDown(information, { key: 'End' });
    expect(shipping).toHaveFocus();
  });

  it('supports products without variants or images', async () => {
    const fetchMock = installFetch({ variants: [], images: [] });
    render(<ProductDetails slug="rice" />);
    expect(await screen.findByText('No product image available')).toBeVisible();
    expect(
      screen.queryByRole('group', { name: 'Product images' }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }));
    await screen.findByText('1 item added to your cart.');
    expect(
      fetchMock.mock.calls.some(([, init]) =>
        String(init?.body).includes('"variant_id":null'),
      ),
    ).toBe(true);
  });

  it('starts on an in-stock variant and blocks invalid quantities', async () => {
    installFetch({
      variants: [
        { ...product.variants[0], stock: 0 },
        { ...product.variants[0], id: 'small', name: 'Small', stock: 2 },
      ],
    });
    render(<ProductDetails slug="rice" />);
    expect(
      await screen.findByRole('button', { name: 'Small' }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByRole('button', { name: 'Large (sold out)' }),
    ).toBeDisabled();
    for (const value of ['0', '-1', '1.5', '3', '']) {
      fireEvent.change(screen.getByRole('spinbutton', { name: 'Quantity' }), {
        target: { value },
      });
      expect(
        screen.getByRole('button', { name: 'Add to cart' }),
      ).toBeDisabled();
    }
  });

  it.each([
    { available: false },
    { stock: 0, variants: [] },
    { variants: [{ ...product.variants[0], stock: 0 }] },
  ])('blocks unavailable products: %j', async (overrides) => {
    installFetch(overrides);
    render(<ProductDetails slug="rice" />);
    await screen.findByRole('heading', { name: 'Rice' });
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeDisabled();
  });

  it('retains the own-shop purchase restriction', async () => {
    setWorkspaceUser({ ...testUser, owned_shop_ids: [product.shop_id] });
    installFetch();
    render(<ProductDetails slug="rice" />);
    await screen.findByRole('heading', { name: 'Rice' });
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeDisabled();
    expect(
      screen.getByText(/You cannot buy from your own shops/),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Message vendor' }),
    ).not.toBeInTheDocument();
  });

  it('keeps guest and non-customer navigation free of protected cart requests', async () => {
    setWorkspaceUser(null);
    const fetchMock = installFetch();
    render(<ProductDetails slug="rice" />);
    await screen.findByRole('heading', { name: 'Rice' });
    expect(screen.getByRole('link', { name: 'My Bag' })).toHaveAttribute(
      'href',
      '/',
    );
    expect(
      screen.queryByRole('button', { name: 'Add to cart' }),
    ).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('/me/cart')),
    ).toBe(false);
  });

  it('keeps workspace selection and customer navigation available in the compact header', async () => {
    installFetch();
    render(<ProductDetails slug="rice" />);
    await screen.findByRole('heading', { name: 'Rice' });
    fireEvent.click(screen.getByText('Account'));
    expect(screen.getByRole('link', { name: 'Messages' })).toHaveAttribute(
      'href',
      '/messages',
    );
    const workspace = screen.getByLabelText('Workspace');
    expect(workspace).toHaveValue('customer');
    fireEvent.change(workspace, { target: { value: 'vendor' } });
    expect(
      screen.queryByRole('button', { name: 'Add to cart' }),
    ).not.toBeInTheDocument();
  });

  it('shows cart failures without claiming a successful addition or empty bag', async () => {
    const fetchMock = installFetch();
    const normalFetch = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input, init) => {
      if (String(input).includes('/me/cart')) {
        return Promise.resolve(
          Response.json(
            { error: { message: 'Cart unavailable' } },
            { status: 503 },
          ),
        );
      }
      return normalFetch(input, init);
    });
    render(<ProductDetails slug="rice" />);
    await screen.findByText('Cart unavailable');
    expect(screen.getByRole('link', { name: 'My Bag' })).toBeVisible();
    expect(
      screen.queryByRole('link', { name: 'My Bag (0)' }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }));
    await waitFor(() =>
      expect(screen.getAllByText('Cart unavailable')).toHaveLength(2),
    );
    expect(
      screen.queryByText(/items? added to your cart/),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeEnabled();
  });

  it('prevents duplicate submissions and ignores a late initial bag count', async () => {
    const fetchMock = installFetch();
    const normalFetch = fetchMock.getMockImplementation()!;
    let resolveInitial: (value: Response) => void = () => {
      throw new Error('Cart request not started');
    };
    let resolveAddition: (value: Response) => void = () => {
      throw new Error('Cart addition not started');
    };
    fetchMock.mockImplementation((input, init) => {
      if (String(input).endsWith('/me/cart')) {
        return new Promise<Response>((resolve) => {
          resolveInitial = resolve;
        });
      }
      if (String(input).endsWith('/me/cart/items')) {
        return new Promise<Response>((resolve) => {
          resolveAddition = resolve;
        });
      }
      return normalFetch(input, init);
    });
    render(<ProductDetails slug="rice" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add to cart' }));
    expect(
      screen.getByRole('button', { name: 'Adding to cart…' }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Adding to cart…' }));
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith('/me/cart/items'),
      ),
    ).toHaveLength(1);
    resolveAddition(
      Response.json({ item_count: 5, items: [], subtotal: '500' }),
    );
    await screen.findByRole('link', { name: 'My Bag (5)' });
    await act(async () => {
      resolveInitial(
        Response.json({ item_count: 1, items: [], subtotal: '100' }),
      );
    });
    await waitFor(() =>
      expect(
        screen.queryByRole('link', { name: 'My Bag (1)' }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('link', { name: 'My Bag (5)' })).toBeVisible();
  });

  it('uses named options when attribute combinations do not uniquely identify a variant', async () => {
    installFetch({
      variants: [
        { ...product.variants[0], attributes: { size: 'L' } },
        {
          ...product.variants[0],
          id: 'alternate',
          name: 'Alternate',
          attributes: { size: 'L' },
        },
      ],
    });
    render(<ProductDetails slug="rice" />);
    expect(await screen.findByRole('button', { name: 'Large' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Alternate' }));
    expect(screen.getByRole('button', { name: 'Alternate' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('replaces only the customer workspace header and restores vendor shop controls on switching', async () => {
    installFetch();
    render(
      <WorkspaceProvider>
        <ProductDetails slug="rice" />
      </WorkspaceProvider>,
    );
    await screen.findByRole('heading', { name: 'Rice' });
    expect(screen.getAllByRole('banner')).toHaveLength(1);
    fireEvent.click(screen.getByText('Account'));
    fireEvent.change(screen.getByLabelText('Workspace'), {
      target: { value: 'vendor' },
    });
    expect(await screen.findByLabelText('Shop')).toHaveValue('');
    expect(
      screen.getByRole('navigation', { name: 'vendor navigation' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Add to cart' }),
    ).not.toBeInTheDocument();
  });
});
