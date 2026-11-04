# Vendor's Market

Vendor's Market is a commerce platform for customers, retail vendors, and wholesale businesses in Nepal. It is built as a
modular monolith with a Next.js web app and a versioned FastAPI backend.

## Phase 1: Project foundation and Phase 2: Identity and access

The repository includes a Next.js customer-facing application shell, a FastAPI service, PostgreSQL/PostGIS and MinIO for
local development, database migrations, structured API errors and logs, dependency health checks, and automated quality
checks. Identity features include email verification, password recovery, server-side sessions, customer profiles and
delivery addresses, vendor verification applications with private documents, role-based admin operations, account
suspension/deactivation, and audit history. Catalogue management and order processing are later-phase work.

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

The storage initialization command is safe to repeat. It creates `product-media` and `vendor-documents` (or their configured
names) without granting anonymous access. The MinIO console is at `http://localhost:9001`; sign in using the local values
of `VMARKET_MINIO_ACCESS_KEY` and `VMARKET_MINIO_SECRET_KEY` from your `.env`. Do not use subscription credentials here.

## Run the web app

In another terminal:

```powershell
Set-Location apps\web
npm ci
npm run dev
```

Open `http://localhost:3000`.

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
