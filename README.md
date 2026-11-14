# Vendor's Market

Vendor's Market is a commerce platform for customers, retail vendors, and wholesale businesses in Nepal. It is built as a
modular monolith with a Next.js web app and a versioned FastAPI backend.

## Implemented phases: Foundation through administration and operations

The repository includes a Next.js customer-facing application shell, a FastAPI service, PostgreSQL/PostGIS and MinIO for
local development, database migrations, structured API errors and logs, dependency health checks, and automated quality
checks. Identity features include email verification, password recovery, server-side sessions, customer profiles and
delivery addresses, vendor verification applications with private documents, role-based admin operations, account
suspension/deactivation, and audit history. Phase 3 adds shop profiles, category and brand management, product attributes
and variants, public MinIO product images, moderated product listings, searchable and filterable discovery, location-based
shop discovery, product details, and customer wishlists. Retail ordering adds persistent customer carts, server-validated
checkout, database-locked inventory reservation, vendor-specific fulfillment orders, order history, immutable status
events, delivery tracking numbers, customer/vendor notifications, invoice records, and cash-on-delivery transactions.
Customers can cancel before dispatch and request a return within the platform's configured window after delivery
(seven days by default). A returned cash-on-delivery
order creates a refund-due ledger entry that the fulfilling vendor records when cash is refunded.
The customer My Orders dashboard at `/orders` includes status counts, product/order/status search, newest/oldest sorting,
date and shop filters, per-shop shipment tracking, cancellation confirmation, and invoice viewing. Status filters match
individual shipments, so a multi-shop order may appear in more than one filter. Images use the current primary catalog
photo (or an explicit missing-image placeholder); purchased names, variants, quantities, and prices remain order snapshots.
Delivery estimates and separate color/size fields are not currently supplied by the order API. Cash on delivery is the
only supported payment method. Dashboard Settings opens the existing account controls at `/`; `/wishlist` displays real
saved products and supports removal.
Order details at `/orders/[orderId]` use one tracking card per shop shipment, with the purchased delivery address,
vendor support contacts, courier name/tracking number, and newest-first status history. Vendors record courier details,
public support phone/email, event locations, and optional picked-up, in-transit and out-for-delivery milestones through
`/vendor/orders`. These are vendor-reported updates, not a live courier integration; unrecorded milestones and locations
are never synthesized. Historical shipments can still move directly from shipped to delivered.
After a recorded delivery, customers can save or update a separate 1–5 delivery rating using
`PUT /api/v1/me/fulfillment-orders/{id}/delivery-feedback`; the rating persists independently of product reviews and
does not modify the shipment timeline. Return eligibility/deadlines come from the server's current return policy.
Exchanges remain unavailable. Vendor contact information is explicitly supplied for that shipment, never inferred
from a private account email or phone.

Before using delivery tracking, apply revision `0010_delivery_tracking` with
`alembic -c apps\backend\alembic.ini upgrade head` and restart the backend. Back up the database first.
The migration preserves existing orders and history with nullable new metadata. Downgrade refuses to discard recorded
tracking metadata, new milestone history, or delivery feedback; an operator must export and reconcile those records
before rollback. Migration tests use a random isolated PostgreSQL schema via `VMARKET_MIGRATION_TEST_DATABASE_URL`;
they never migrate the application schema.

Phase 5 adds customer-to-vendor conversations with durable message history, unread counts, in-app notifications,
WebSocket updates, and optional product/order context. Customers can review products only after a related fulfillment is
delivered; reviews enter an administrator moderation queue, can be reported, and support vendor responses. Customers and
vendors can escalate order issues through support tickets and disputes, with administrator responses, notifications, and
audit history. Phase 6 adds shop-scoped wholesale listings with quantity price tiers and minimums,
supplier discovery, RFQs with revisioned quotes and negotiation history, purchase orders with
trade-specific status events, concurrent stock reservation, shop-to-shop stock transfers with
receipt confirmation, private MinIO trade documents, supplier performance history, and verified
business reviews after receipt. Phase 7 adds owner-only operational dashboards and order/payment oversight,
commission and return-policy settings, platform/vendor-funded promotion codes, and auditable fraud investigations.

## Prerequisites

- Docker with the Compose plugin
- Python 3.10 or later
- Node.js 22.13 or later and npm

## Start local dependencies

From the repository root, copy `.env.example` to `.env`, then start PostgreSQL/PostGIS, MinIO, and the local Mailpit
email catcher:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
docker compose up -d --build --wait
```

PostgreSQL is available on `localhost:5432`; the MinIO S3 API and console are on `localhost:9000` and `localhost:9001`.
Mailpit accepts SMTP on `localhost:1025` and its inbox UI is at `http://localhost:8025`. The credentials in
`.env.example` are for local development only.

For local email delivery, use `VMARKET_MAIL_HOST=localhost`, `VMARKET_MAIL_PORT=1025`,
`VMARKET_MAIL_STARTTLS=false`, and `VMARKET_MAIL_FROM=no-reply@vendors-market.local`; leave
`VMARKET_MAIL_USERNAME` and `VMARKET_MAIL_PASSWORD` empty. Mailpit captures verification and
password-reset emails at `http://localhost:8025`; it does not deliver to real inboxes.
Its Docker SMTP port is controlled separately by `VMARKET_MAILPIT_SMTP_PORT` (default `1025`).
If you customize that port, match `VMARKET_MAIL_PORT` to it when using Mailpit.
After changing mail settings, restart the backend and run `docker compose up -d mailpit`.
Keep `VMARKET_WEB_BASE_URL` reachable from the device opening the email links.

MinIO is built from a pinned official community source release because its published container images are no longer
accessible. The first build downloads Go dependencies and can take several minutes. No MinIO subscription or license key
is required. This frozen community release is for local development only; use maintained storage for production.

## Run the backend

From the repository root:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e "apps\backend[dev]"
python -m app.storage.initialize
alembic -c apps\backend\alembic.ini upgrade head
python -m uvicorn app.main:app --app-dir apps\backend --reload
```

The API is available at `http://localhost:8000`; interactive OpenAPI documentation is at `/docs`. Liveness and
dependency readiness are reported at `/api/v1/health/live` and `/api/v1/health/ready`. Readiness checks PostgreSQL and
authenticates to MinIO; a dependency failure returns HTTP 503 without disclosing connection details.

Registration and password recovery email is sent through SMTP or the Brevo HTTPS API. The local Mailpit inbox lets you open verification and
password-reset links without a third-party provider. Open the password-reset link to choose a new password, then sign in
again; the link expires after one hour. Configure `VMARKET_MAIL_HOST`, `VMARKET_MAIL_PORT`,
`VMARKET_MAIL_USERNAME`, `VMARKET_MAIL_PASSWORD`, `VMARKET_MAIL_STARTTLS`, `VMARKET_MAIL_FROM`, and
`VMARKET_WEB_BASE_URL` for the deployment's email provider and public web origin. Staging and production require a
authenticated Brevo HTTPS delivery or a remote authenticated SMTP service using STARTTLS, and an HTTPS web origin.

To use Brevo instead of Mailpit, create a Brevo account, complete its onboarding,
and configure a verified sender (authenticate your domain for reliable delivery).
Set these values in the repository-root `.env`:

```dotenv
VMARKET_MAIL_PROVIDER=brevo
# Replace with your sender approved in Brevo:
VMARKET_MAIL_FROM=no-reply@yourdomain.com
```

Set `VMARKET_MAIL_PASSWORD` privately to your Brevo **API key**, not an SMTP key or another provider's key.
Missing keys or senders prevent startup with an explicit configuration error.
Restart the backend after saving both settings.
This mode sends directly to `https://api.brevo.com/v3/smtp/email` with certificate verification;
SMTP host, port, username, and STARTTLS settings are unused. HTTP/provider failures return
an email-delivery error rather than reporting success. No automatic SMTP fallback is used.
To switch back to Mailpit, set `VMARKET_MAIL_PROVIDER=smtp` and restore the local SMTP settings above.
Check Brevo's transactional logs for delivery, rejection, and bounce events.
API acceptance means the message was submitted, not that it has arrived in the recipient's inbox.
Mailpit's Docker ports are independent and do not need to change when switching providers.
Email links still use `VMARKET_WEB_BASE_URL`; use a public HTTPS origin for users outside your network.

To provision the **sole platform owner**, privately configure `VMARKET_OWNER_EMAIL` to the creator's existing,
active, email-verified account, then run this operator-only command after migration:

```powershell
vmarket-grant-admin admin@example.com
```

The supplied email must match that configuration. Provisioning binds the owner's immutable account ID once;
rerunning for the same owner is safe, but changing configuration cannot replace the owner. There is no public admin
signup, promotion, delegation, or ownership-transfer endpoint. Legacy `admin` role rows do not authorize access.
The command records provisioning in the append-only audit log. The owner cannot deactivate or suspend its own account;
password recovery restores the same identity. Staging/production readiness returns 503 until the owner is provisioned,
verified, and active. See `/docs` for versioned endpoints.

## Profiles, workspaces, and shops

One login may hold **one customer profile and one approved vendor profile**. These share authentication, not permissions.
Use the workspace selector for Customer, Vendor, or (owner only) Admin mode. Selections are tab-specific, so another tab
can stay in a different workspace. Vendor mode requires explicit shop selection for shop-bound actions; a vendor may
own **at most three shops**, counting inactive shops. Shop deletion and ownership transfer are not included.

Protected API requests identify their context with `X-VMarket-Workspace: customer|vendor|admin` and, for shop-bound
vendor actions, `X-VMarket-Shop-Id: <uuid>`. The server validates the session, profile, and resource ownership;
headers never grant permissions. Missing context is rejected, and neither a mode nor the first owned shop is guessed.
Public browsing and account-wide authentication/session operations are context-neutral. Vendor applications and
their private documents require Customer workspace, which remains available before vendor approval.
`/api/v1/me/export` requires an explicitly selected workspace: Customer exports account metadata, the customer
profile, addresses and onboarding applications; Vendor exports account metadata, the business profile and the
explicitly selected owned shop; Admin exports only the owner's account metadata/binding. This is a profile export,
not a transaction-history export, and it never combines workspaces.
`/api/v1/vendor/shops` lists or creates shops without a shop selector; existing business
endpoints operate on the explicitly selected shop. WebSocket connections use non-secret `workspace` and `shop_id`
query selectors, with the same cookie/session authorization.

Customer checkout, addresses, wishlist, orders, and reviews require Customer mode. Vendor catalog, fulfillment,
wholesale, and review responses require Vendor mode and the selected shop. Admin mode is separate and does not
implicitly authorize customer/vendor actions. Messages, notifications, support, and live updates are scoped accordingly.
Buying/reviewing your own shops (including wholesale between your own shops) is prohibited. Explicit stock transfers
between distinct shops you own remain allowed.

Workspace navigation is separated: Customer browsing/cart/orders and personal support; Vendor selected-shop
catalog/fulfillment/reviews/promotions/trade/support; owner-only Admin account approvals and audit history at
`/admin/accounts`, catalog moderation, communications/support queues, and operations/policies/investigations.
Admin visits to personal support link to the platform queue without requesting personal tickets. Product purchase,
wishlist and customer messaging controls require Customer workspace; owned-shop purchases and wholesale RFQs are
blocked. Vendor stock transfers can select approved products in other active owned shops even without a wholesale
listing, independently of supplier search. Inactive shops retain access to existing fulfillment history and status
updates, but cannot create new product listings, promotions, wholesale offers/orders, or retail checkouts. Stock-only
product and variant updates preserve the current moderation state; edits to product or variant content still require
review.

Vendor fulfillment responses expose only that shop's items/financial events plus the order's delivery recipient,
phone and address snapshot needed for shipping (not the customer's email/profile or other shops' fulfillment data).
Vendor promotion enable/disable actions are restricted to the selected shop's vendor-funded promotions and audited.
Fraud reports require Customer context or Vendor context with an explicitly selected owned shop; order targets must
belong to the customer or contain a fulfillment for the selected shop. Reports retain the submitted workspace/shop.
If registration commits but email delivery fails, the sign-in screen offers verification resend without recreating
the account; password-reset delivery and recovery behavior remain unchanged.

## Phase 7: Administration and operations

The platform owner can manage users, vendor verification, product/review moderation, support disputes, platform
settings, and operational investigations. Admin access remains owner-only; no staff-role or public administrator
promotion flow is introduced. The operations dashboard provides order, COD payment/refund, dispute, verification,
moderation, fraud-report, and accrued-commission summaries, with read-only order and payment oversight. Administrative
changes are recorded in the existing append-only audit log.

The owner can configure vendor commission from 3% through 5% and the customer return window from 1 through 30 days.
The commission rate is snapshotted for each fulfillment when an order is placed; commission amounts use decimal
arithmetic and are reported separately from COD collection. Existing order totals are not recalculated when settings
change. Category and product moderation remain under catalogue administration.

The owner can create platform-funded discount codes, and vendors can create codes funded by one explicitly selected
shop. Vendor codes apply only to that shop's cart items. Percentage or fixed NPR discounts are supported; a checkout
accepts one code, codes cannot be stacked, and discounts are capped at eligible item subtotal. Redemption limits and
active dates are supported by the API. Discount values and the code used are snapshotted on the order; vendor-funded
discounts reduce that shop's commission base. Customers and vendors can report suspicious products or shops, and the
owner can investigate, resolve, or dismiss reports with an audit record.

Run the new migration before deploying backend and web changes:

```powershell
alembic -c apps\backend\alembic.ini upgrade head
```

The migration adds platform settings, promotion and fraud-report tables, and order/fulfillment financial snapshots.
Its downgrade refuses to discard promotions, reports, applied discounts, or changed platform settings.

### Migration and deployment safety

Deploy backend and frontend together: old clients without workspace context intentionally cannot perform protected
operations. Back up the database and rehearse the new Alembic migration on an isolated copy before allowing traffic.
Existing identity/shop IDs, both profiles, orders, financial records, and audit history are retained. The migration
stops on inconsistent vendor records, ambiguous workspace history, excess shops, or unresolved legacy admin identity;
review its diagnostics instead of deleting records or guessing mappings. Set the verified creator identity privately
before reconciling existing administrators. Never run destructive migration tests against the working database.
After upgrade, provision/verify the owner and check readiness before opening traffic. A downgrade must refuse to lose
multi-shop or workspace history: restore a compatible verified backup or deploy a forward fix instead.

For ambiguous historical notifications/support tickets, review the original record and prepare a private JSON file:

```json
{
  "order_notifications": {
    "00000000-0000-4000-8000-000000000001": {
      "workspace": "vendor",
      "shop_id": "00000000-0000-4000-8000-000000000002",
      "reason": "Reviewed original business correspondence"
    }
  },
  "support_tickets": {
    "00000000-0000-4000-8000-000000000003": {
      "workspace": "customer",
      "shop_id": null,
      "reason": "Reviewed original customer request"
    }
  }
}
```

Replace the example IDs with reviewed record/shop IDs; omit unused top-level sections. Do not commit this file.
With application writers stopped, run from the repository root:

```powershell
alembic -c apps\backend\alembic.ini -x "workspace_map=C:\private\reviewed-workspaces.json" upgrade head
```

The migration validates each mapping and records reconciliation decisions. An unsafe downgrade is refused if any
vendor owns multiple shops or any vendor-profile, owner-binding, notification, or support-ticket rows would lose their
new information.

PostgreSQL-specific migration and concurrency checks are opt-in. Point the following variable at a **test database**
whose user can create schemas, then run:

```powershell
$env:VMARKET_MIGRATION_TEST_DATABASE_URL = 'postgresql+asyncpg://<user>:<password>@<host>:<port>/<database>'
python -m pytest apps\backend\tests\test_profile_workspace_migration.py -q
Remove-Item Env:\VMARKET_MIGRATION_TEST_DATABASE_URL
```

These tests isolate and clean up uniquely named schemas; never substitute a production database.

Revision `0009_fraud_workspace_scope` requires operator review for **every** existing fraud report.
No workspace or shop is inferred from roles or targets. Prepare a private file containing exactly the existing
report IDs (an empty table needs no mapping):

```json
{
  "reviewed_by": "00000000-0000-4000-8000-000000000004",
  "reports": [
    {
      "id": "00000000-0000-4000-8000-000000000001",
      "workspace": "customer",
      "shop_id": null,
      "reason": "Reviewed original customer report"
    },
    {
      "id": "00000000-0000-4000-8000-000000000002",
      "workspace": "vendor",
      "shop_id": "00000000-0000-4000-8000-000000000003",
      "reason": "Reviewed selected-shop business report"
    }
  ]
}
```

`reviewed_by` must identify the active, email-verified platform owner who approved the mappings.
Vendor mappings must identify a shop owned by the reporter; customer mappings require that reporter's customer
profile. Historical order reports must satisfy the same order-participation boundaries as new submissions.
Invalid, missing, duplicated or stale mapping entries stop the migration before schema/data changes. With writers
stopped and a verified backup, rehearse on an isolated copy before applying:

```powershell
alembic -c apps\backend\alembic.ini -x "fraud_workspace_map=C:\private\reviewed-fraud.json" upgrade head
```

If both revisions 0007 and 0009 need reconciliation, supply both `-x` arguments. Do not commit mapping files.
Each mapping requires a review reason and appends an immutable reconciliation audit entry; prior audit rows are not
changed. Existing report IDs, status, details and investigation history are preserved. Downgrading 0009 refuses any populated
fraud-report table, since dropping scope would lose history. Validate on an isolated test database using
`python -m pytest apps\backend\tests\test_fraud_workspace_migration.py -q` with the test database variable above.

For local marketplace development, seed 10 approved vendor accounts and 20 approved sample products after migrating
the database:

```powershell
python -m app.catalog.seed_demo
```

The command only runs when `VMARKET_ENVIRONMENT=development` and the database host is localhost. It is safe to repeat
and refuses to overwrite an existing account's password. The demo vendors can sign in as
`demo.vendor01@example.com` through `demo.vendor10@example.com`; the shared local-only password is
`VendorDemo2026!`. These sample credentials are public and must never be used outside local development.

After seeding the catalogue demo data, create 20 wholesale listings and sample trade workflows (RFQs, quotes,
purchase orders, transfers, and supplier reviews) with:

```powershell
python -m app.trading.seed_demo
```

This command has the same localhost/development-only guard and is safe to repeat.

The storage initialization command is safe to repeat. It creates `product-media` and `vendor-documents` (or their configured
names), and grants anonymous read-only access to the public product-media bucket; vendor documents remain private. The
public and private bucket names must be distinct. Set
`VMARKET_MINIO_PUBLIC_URL` to the browser-accessible MinIO or CDN origin used to display product photos. Production and
staging require this public URL to use HTTPS. The MinIO console is at `http://localhost:9001`; sign in using the local
values of `VMARKET_MINIO_ACCESS_KEY` and `VMARKET_MINIO_SECRET_KEY` from your `.env`. Do not use subscription credentials
here.

## Run the web app

In another terminal:

```powershell
Set-Location apps\web
npm ci
npm run dev
```

Open `http://localhost:3000`.

For a mobile device on the same network, open `http://<computer-LAN-IP>:3000`.
Checkout uses secure random bytes when the browser's `crypto.randomUUID` is
unavailable on local-network HTTP. Use HTTPS for deployed environments.

The marketplace is at `/marketplace`; customers can add products to `/cart`, check out with a saved delivery address,
and view progress and invoices at `/orders`. Vendor shop and product management is at `/vendor`, with fulfillment
management at `/vendor/orders`, reviews at `/vendor/reviews`, and wholesale, RFQ, purchase order, stock transfer, and
trade document workflows at `/vendor/trade`. Customers and vendors can use `/messages` for
persisted conversations, `/support` for support requests, and `/notifications` for order, message, review-response, and
support updates. Authorized administrators can manage catalogue taxonomy and moderate listings at `/admin/catalog`, and
review reports, pending reviews, support tickets, and disputes at `/admin/communications`. A vendor must have an
approved vendor application before creating a shop; product submissions remain unpublished until an administrator
approves them.

The notification center groups the latest 100 notifications by local calendar date, with text search,
All/Read/Unread filters, a compact bell preview, and selection-based read/unread/delete actions.
Bulk actions persist through `POST /api/v1/me/notifications/batch` (`ids`, `action`:
`read`, `unread`, or `delete`); all selected IDs must belong to the authenticated account and
active workspace/shop, otherwise none are changed. Account-level notices remain visible across workspaces.
Deletion requires confirmation and only removes inbox notices, not their orders or messages.
Details retain workspace-aware conversation/order links. Notification type icons are used instead of
invented sender avatars because the notification API does not provide sender names or photos.
The page uses `notification-shell`, shared `components/notifications/notification-ui`, and
`use-notifications` for the dashboard shell, timeline/popovers, and selection/filter state.
Changing account, workspace, or shop resets page state and discards obsolete requests.

Headers use `components/notifications/notification-popover.tsx`: render `<NotificationPopover />`
inside any authenticated header (within the workspace shell). It fetches the latest 100 notices,
shows the newest five (both read and unread) in a scrollable preview, and displays a red unread badge.
Counts cover that recent inbox, not an unlimited notification history. The `className` prop customizes
the bell; the optional `inbox` prop accepts the result of `useNotificationInbox()` to share state with
a parent, as on the notification center. The hook lives in `lib/notification-inbox.ts`.
It refreshes on mount, bell opening, window focus, and every 60 seconds; successful mutations
invalidate other mounted previews. Individual clicks persist read status before navigating to the
workspace-scoped order/conversation; notices without a destination are marked read in place.
Failed writes keep the preview open and show an error without navigating.
The popover supports keyboard activation, Escape with focus restoration, outside-pointer/focus dismissal,
and viewport-constrained positioning. Guests and vendors without an explicitly selected shop do not
fetch an inbox. Customer account/messages, storefront/product, cart, and standard workspace headers use
the same component; the notification dashboard shares its existing inbox instead of fetching twice.

Checkout currently supports cash on delivery. Shipping is a fixed NPR 100 per vendor fulfillment, so a multi-vendor
cart pays one delivery fee per shop. Prices and totals are calculated from server-side catalogue data using decimal
currency values. Stock is atomically reserved during checkout and returned to availability when a fulfillment is
cancelled or a vendor accepts a return. Apply the latest schema with the normal migration command:

```powershell
python -m alembic -c apps\backend\alembic.ini upgrade head
```

After pulling schema changes, run this command before using the updated features. Phase 6 requires revision
`0006_vendor_trade` (after `0005_communications_reviews`); verify the installed revision with
`python -m alembic -c apps\backend\alembic.ini current`. Missing migrations can cause HTTP 500 responses on
trade listings, quotes, purchase orders, and transfers, as well as reviews, conversations, and support tickets.
Unexpected API errors are logged server-side and return sanitized JSON
with CORS headers for configured origins.

The web app uses `http://localhost:8000/api/v1` by default. Set
`NEXT_PUBLIC_API_URL` at build time when the API is hosted at a different origin, and configure the backend CORS
origins and `VMARKET_WEB_BASE_URL` to match the deployed web app.

## Quality checks

Run backend checks from the repository root:

```powershell
python -m pytest apps\backend\tests
ruff check apps\backend
ruff format --check apps\backend
mypy --config-file apps\backend\pyproject.toml apps\backend\app
```

Run frontend checks from `apps/web`:

```powershell
npm test
npm run lint
npm run typecheck
npm run format:check
npm run build
```

## Configuration and environments

All backend settings use the `VMARKET_` prefix. `.env.example` contains local development values. Set
`VMARKET_ENV` to `development`, `test`, `staging`, or `production` for the corresponding environment. Supply database
and MinIO endpoints and credentials through environment variables in test, staging, and production; staging and
production reject local endpoints, development credentials, local CORS origins, disabled MinIO TLS, and debug mode. Do
not commit `.env` files or real secrets.

The API settings include explicit CORS origins, log level, MinIO bucket names, and TLS configuration for MinIO. Use
environment-specific secret management and restrict database, object-storage, and CORS access when deploying.
