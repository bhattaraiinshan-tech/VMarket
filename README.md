# Vendor's Market

Vendor's Market is a commerce platform for customers, retail vendors, and wholesale businesses in Nepal. It is built as a
modular monolith with a Next.js web app and a versioned FastAPI backend.

## Implemented phases: Foundation, identity, catalogue, and retail ordering

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

To grant platform administrator access to an existing, active, verified account, run this operator-only command after
the database has been migrated:

```powershell
vmarket-grant-admin admin@example.com
```

The command records the privilege grant in the append-only audit log. Admin access cannot be self-registered through the
API. See `/docs` for the versioned identity, profile, vendor verification, and admin endpoints.

For local marketplace development, seed 10 approved vendor accounts and 20 approved sample products after migrating
the database:

```powershell
python -m app.catalog.seed_demo
```

The command only runs when `VMARKET_ENVIRONMENT=development` and the database host is localhost. It is safe to repeat
and refuses to overwrite an existing account's password. The demo vendors can sign in as
`demo.vendor01@example.com` through `demo.vendor10@example.com`; the shared local-only password is
`VendorDemo2026!`. These sample credentials are public and must never be used outside local development.

The storage initialization command is safe to repeat. It creates `product-media` and `vendor-documents` (or their configured
names), and grants anonymous read-only access to the public product-media bucket; vendor documents remain private. Set
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
management at `/vendor/orders`; notifications are at `/notifications`. Authorized administrators can manage catalogue
taxonomy and moderate listings at `/admin/catalog`. A vendor must have an approved vendor application before creating a
shop; product submissions remain unpublished until an administrator approves them.

Checkout currently supports cash on delivery. Shipping is a fixed NPR 100 per vendor fulfillment, so a multi-vendor
cart pays one delivery fee per shop. Prices and totals are calculated from server-side catalogue data using decimal
currency values. Stock is atomically reserved during checkout and returned to availability when a fulfillment is
cancelled or a vendor accepts a return. Apply the Phase 4 schema with the normal migration command:

```powershell
alembic -c apps\backend\alembic.ini upgrade head
```

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
