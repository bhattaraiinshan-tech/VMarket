# Vendor's Market

Vendor's Market is a commerce platform for customers, retail vendors, and wholesale businesses in Nepal. It is built as a
modular monolith with a Next.js web app and a versioned FastAPI backend.

## Implemented phases: Foundation through wholesale and vendor trade

The repository includes a Next.js customer-facing application shell, a FastAPI service, PostgreSQL/PostGIS and MinIO for
local development, database migrations, structured API errors and logs, dependency health checks, and automated quality
checks. Identity features include email verification, password recovery, server-side sessions, customer profiles and
delivery addresses, vendor verification applications with private documents, role-based admin operations, account
suspension/deactivation, and audit history. Phase 3 adds shop profiles, category and brand management, product attributes
and variants, public MinIO product images, moderated product listings, searchable and filterable discovery, location-based
shop discovery, product details, and customer wishlists. Retail ordering adds persistent customer carts, server-validated
checkout, database-locked inventory reservation, vendor-specific fulfillment orders, order history, immutable status
events, delivery tracking numbers, customer/vendor notifications, invoice records, and cash-on-delivery transactions.
Customers can cancel before dispatch and request a return within seven days after delivery. A returned cash-on-delivery
order creates a refund-due ledger entry that the fulfilling vendor records when cash is refunded.
Phase 5 adds customer-to-vendor conversations with durable message history, unread counts, in-app notifications,
WebSocket updates, and optional product/order context. Customers can review products only after a related fulfillment is
delivered; reviews enter an administrator moderation queue, can be reported, and support vendor responses. Customers and
vendors can escalate order issues through support tickets and disputes, with administrator responses, notifications, and
audit history. Phase 6 adds shop-scoped wholesale listings with quantity price tiers and minimums,
supplier discovery, RFQs with revisioned quotes and negotiation history, purchase orders with
trade-specific status events, concurrent stock reservation, shop-to-shop stock transfers with
receipt confirmation, private MinIO trade documents, supplier performance history, and verified
business reviews after receipt.

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

Registration and password recovery email is sent through SMTP. The local Mailpit inbox lets you open verification and
password-reset links without a third-party provider. Configure `VMARKET_MAIL_HOST`, `VMARKET_MAIL_PORT`,
`VMARKET_MAIL_USERNAME`, `VMARKET_MAIL_PASSWORD`, `VMARKET_MAIL_STARTTLS`, `VMARKET_MAIL_FROM`, and
`VMARKET_WEB_BASE_URL` for the deployment's email provider and public web origin. Staging and production require a
remote authenticated SMTP service using STARTTLS and an HTTPS web origin.

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
Public browsing and account-wide authentication/session/export operations are context-neutral. Vendor applications
remain available as onboarding before approval. `/api/v1/vendor/shops` lists or creates shops; existing business
endpoints operate on the explicitly selected shop. WebSocket connections use non-secret `workspace` and `shop_id`
query selectors, with the same cookie/session authorization.

Customer checkout, addresses, wishlist, orders, and reviews require Customer mode. Vendor catalog, fulfillment,
wholesale, and review responses require Vendor mode and the selected shop. Admin mode is separate and does not
implicitly authorize customer/vendor actions. Messages, notifications, support, and live updates are scoped accordingly.
Buying/reviewing your own shops (including wholesale between your own shops) is prohibited. Explicit stock transfers
between distinct shops you own remain allowed.

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

The marketplace is at `/marketplace`; customers can add products to `/cart`, check out with a saved delivery address,
and view progress and invoices at `/orders`. Vendor shop and product management is at `/vendor`, with fulfillment
management at `/vendor/orders`, reviews at `/vendor/reviews`, and wholesale, RFQ, purchase order, stock transfer, and
trade document workflows at `/vendor/trade`. Customers and vendors can use `/messages` for
persisted conversations, `/support` for support requests, and `/notifications` for order, message, review-response, and
support updates. Authorized administrators can manage catalogue taxonomy and moderate listings at `/admin/catalog`, and
review reports, pending reviews, support tickets, and disputes at `/admin/communications`. A vendor must have an
approved vendor application before creating a shop; product submissions remain unpublished until an administrator
approves them.

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
