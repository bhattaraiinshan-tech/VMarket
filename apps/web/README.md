# Workspace context

The cookie session identifies an account, not its current workspace. Customer,
Vendor, and owner-only Admin selections are stored in `sessionStorage`, bound to
the authenticated user, and remain independent between tabs. Vendor profiles may
own three shops total, including inactive shops. Creating a shop does not select
it: select a shop explicitly before opening its catalogue, orders, trade, or
communications.

`lib/api.ts` is the shared HTTP client (including uploads). It removes caller
workspace/shop headers, validates the selected mode, then supplies authoritative
`X-VMarket-Workspace` and `X-VMarket-Shop-Id` selectors. Public catalogue and
account-neutral onboarding/session endpoints receive neither header. These
selectors are not authorization credentials; the backend independently validates
the cookie session, profile, owner binding, and shop ownership.

The root provider guards protected routes and remounts scoped pages on identity,
workspace, or shop changes. Changes abort in-flight requests and discard late
responses, including late mutation responses (already-sent server mutations cannot
be undone). Conversation sockets use cookie authentication and non-secret
`workspace`/`shop_id` query selectors and close on scope changes. Notification
links carry those selectors; their destination validates capabilities and shop
ownership before mounting protected content. Logout clears tab selections; focus
refresh detects an expired or changed account session.

Run `npm test`, `npm run lint`, `npm run typecheck`, `npm run format:check`, and
`npm run build` in this directory.

## Shared interface

The global stylesheet defines the interface colors, keyboard focus treatment,
reduced-motion behavior, and shared workspace page headers. The workspace
provider supplies a skip-to-content link and keeps protected page content behind
the existing workspace and shop checks. List screens should distinguish loading
and failed requests from a successfully loaded empty list.

### Catalog

`/marketplace` uses a plum-accented catalog shell with category navigation,
global search, a category title and breadcrumb band, a collapsible filter
sidebar, a discovery banner, and a four-column desktop product grid. The grid
reduces to three columns on smaller desktops/tablets and two on phones. Filters
start collapsed below 768px; their drafts survive closing and reopening.
`catalog-presentation.tsx`, `catalog-filters.tsx`, and `catalog.module.css` in
`src/app/marketplace/` hold the reusable presentation and scoped styles.

Category links use `?category_id=...`, including nested categories and breadcrumbs.
Category filtering matches that category exactly, not its descendants. Existing
`?q=...` search links still work. Search, Update, and Apply filters submit the
current drafts together; sorting uses only previously applied filters. Clear
filters resets search, category, brand, price, location, stock, and sort.
Filter and sort changes reset pagination. Price ranges are validated as decimal
strings and compared in integer minor units. Nearby shop discovery remains
available below the catalog.

The shared Account menu preserves Customer workspace selection and navigation
on both the catalog and product pages. Vendor and Admin retain their existing
workspace/shop controls. Cart counts and wishlists use Customer APIs only.
Product cards show actual NPR prices, seller/category metadata, stock badges,
and links to product reviews. Missing images have an explicit placeholder.

The current public product contract does not include discount prices, aggregate
ratings, or brand facet counts; these are not inferred from a single results page
or fabricated. Brand selection is single-select to match the API. Rating filters
and newsletter signup are explicitly unavailable, and the subscription controls
are disabled without collecting email addresses. Currency is NPR-only; shipping
copy states the actual NPR 100 per-shop fee, and the footer lists cash on delivery
instead of unsupported payment logos. Contact routes go through the account and
support flows rather than invented phone numbers, addresses, or email accounts.
The discovery banner is an original inline SVG, not a fictional discount offer.

### Product details

`/marketplace/[slug]` uses a minimalist, responsive 12-column product layout:
a vertical thumbnail rail and neutral image showcase beside purchase options on
desktop, with a horizontal thumbnail strip below the image on smaller screens.
The compact Store / Account / My Bag header retains Customer workspace selection
and navigation; Vendor and Admin keep their existing workspace/shop controls.
The bag count is loaded from the cart API and refreshed from add-to-cart responses.
For customers, My Bag opens the cart drawer, and a successful addition opens it
with the returned cart so no extra request is needed.

The gallery, header, variant options, and information tabs are reusable components
in `src/app/marketplace/[slug]/product-presentation.tsx`. Size, color, and other
option groups come from actual variant attributes, not sample apparel choices.
Products without consistent, unique attribute combinations use named variant
buttons instead. Selecting an option retains other selections where available,
otherwise selects an in-stock combination; the resulting option, price, stock,
and specifications update together. Quantity resets to one when options change.
Sold-out options and invalid quantities cannot be added to the cart.

Product information and Shipping & returns tabs support arrow keys, Home, and
End. Specifications use seller-provided product/variant attributes and label
missing fields as Not provided. Shipping copy reflects existing per-shop fees
and cash on delivery; return eligibility remains subject to current backend
policy. Real NPR pricing, own-shop restrictions, wishlist, vendor messaging,
fraud reports, reviews, and related products remain connected to existing APIs.

### Cart

`/cart` uses a two-column desktop layout: cart items (about 70%) beside a sticky
order summary (about 30%), stacking on smaller screens. Modules in `src/app/cart/`:

- `use-cart.ts` holds cart state shared by the page and drawer. Quantity, remove,
  and save-for-later requests run one at a time; stale responses are discarded.
- `cart-components.tsx` provides line items (thumbnail, option, SKU, seller,
  quantity stepper, line total, Remove, Save for later), the per-shop delivery
  notice, and checkout assurances.
- `order-summary.tsx` shows subtotal, delivery, promotion code, delivery address,
  estimated total, and the Place order action.
- `cart-drawer.tsx` is the slide-out cart opened from the catalog View cart and
  product My Bag buttons. It is a modal dialog with focus trapping, Escape and
  backdrop closing, focus restoration, scroll locking, and reduced-motion support.
  It closes when the workspace or account changes. Its Checkout link opens `/cart`.
- `saved-for-later.tsx` lists wishlist products below the cart.
- `cart-money.ts` performs NPR arithmetic in integer minor units.

Quantities are limited to 1–50 and to available stock; invalid typed values are
rejected without a request. Save for later adds the product to the wishlist, then
removes the cart item; if removal fails, the partial result is reported. Cart
items include `product_slug`, `sku` (variant SKU, falling back to product SKU),
and the primary `image_url`/`image_alt`.

Estimated totals are subtotal plus NPR 100 delivery per shop; no separate tax is
added. There is no free-shipping threshold, so a per-shop delivery notice replaces
a free-shipping progress bar. Promotion codes are not previewed: Apply stages the
code, the server validates it when the order is placed, and any discount appears
on the order. Payment is cash on delivery only; express wallets and cards are
listed as unavailable rather than shown as buttons. Return eligibility follows
backend policy for delivered orders, so no fixed return window is claimed.

### Messages

`/messages` and `/messages/[conversationId]` share a navy-and-blue messenger:
searchable conversation history and a live chat panel spanning the available
width, with navigation kept in the top header rather than a left sidebar.
On phones, conversation links open the full-width thread with an All messages
back link. Search filters the latest 100 conversations returned by the existing
API; the thread shows its latest 200 messages, grouped by date.

Names, previews, unread counts, dates, and read receipts come from the API.
Initials are used because the conversation contract does not include avatars.
The live indicator describes the socket connection, not participant presence;
verification badges and response-time claims are not inferred. Read receipts
reflect the last history refresh, not a separate live read-receipt event.
Opening a thread marks incoming messages read through the existing history
endpoint. Drafts, sockets, and pending responses are discarded on conversation,
account, workspace, or shop changes.

Compose starts from a product page in Customer workspace; Vendor workspace
receives customer conversations for the explicitly selected shop. Text sending
supports up to 5,000 characters, a small keyboard-accessible emoji picker, Enter
to send, and Shift + Enter for a newline. A customer thread with an actual order
reference links to that order. Calls, attachments, and image uploads are disabled
and identified as unavailable; they require backend support before enablement.
The decorative landscape is an original local SVG, not mock account data.

## Desktop and mobile development

`npm run dev` listens on all interfaces. Open `http://localhost:3000` on the
desktop or `http://<computer-LAN-IP>:3000` on a phone on the same trusted network.
Allow inbound TCP 3000 from the local subnet in Windows Firewall; guest Wi-Fi
and client isolation may prevent devices from reaching each other.

The browser uses `/api/v1` on its current web origin, including cookie sessions
and WebSockets. Next proxies these requests to `http://127.0.0.1:8000`.
Local MinIO media and signed document links use `/storage`, proxied to
`http://localhost:9000`, preserving the signed Host, path, and query. The phone
does not need direct access to backend or storage ports. External media URLs
remain unchanged.
The proxy accepts 11 MiB request bodies to accommodate the backend's 10 MiB
document uploads plus multipart overhead; backend file limits remain enforced.

Keep `NEXT_PUBLIC_API_URL` unset for this setup. If needed, set server-only
`VMARKET_API_PROXY_URL` and `VMARKET_STORAGE_PROXY_URL` in `.env.local` (origins
without trailing slashes); the storage target must match the signed URL's Host.
Add each exact web origin, including its port, to backend `VMARKET_CORS_ORIGINS`
in the repository-root `.env`. Include both desktop and LAN origins. Restart
both servers after changing configuration, and update that allowlist if DHCP
changes the computer's address. No wildcard CORS or origin bypass is required.
For mobile email verification and password-reset links, set backend
`VMARKET_WEB_BASE_URL` to the LAN web origin reachable by both devices, not
`localhost`.
Use HTTPS and explicitly trusted production origins outside local development.
