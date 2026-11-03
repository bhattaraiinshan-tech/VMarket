# GitHub Copilot Instructions - Vendor's Market

## 1. Project Context & Vision

- **Project:** Vendor's Market (Production-oriented retail & wholesale commerce platform for Nepal).
- **Core Roles:** Customer, Vendor (seller/buyer/supplier using capabilities, not separate accounts), and Platform Administrator.
- **Architecture:** Modular Monolith (Next.js frontend + FastAPI backend + PostgreSQL/PostGIS + MinIO + Redis).

---

## 2. Technology Stack & Rules

- **Frontend (`apps/web/`):** Next.js 14+ (App Router), TypeScript, Tailwind CSS, reusable accessible UI components.
- **Backend (`apps/backend/`):** FastAPI, Python 3.10+, SQLAlchemy 2.x (async where appropriate), Alembic, Pydantic v2.
- **Database:** PostgreSQL with PostGIS. Never use floating-point types for currency; always use **Decimal** or integer minor units.
- **API Standards:** Versioned under `/api/v1`, OpenAPI-documented, strict request/response validation via Pydantic. Avoid exposing internal ORM models directly.

---

## 3. Security, Permissions & Business Logic

- **Shop Isolation (Critical):** Never scope data merely to a generic "vendor" role. Always verify resource-level authorization against the specific `shop_id` using explicit shop membership/permissions.
- **Payment Integrity:** Never trust client-side success states. Implement server-side verification, signed webhook checks, and idempotency keys for checkout and payments.
- **Concurrency & Stock:** Use atomic database transactions and row-level locking (`FOR UPDATE`) for inventory stock reservations to prevent overselling.
- **Audit Trails:** All administrative updates, status shifts, and overrides must generate immutable audit logs.

---

## 4. Git Branching & Conflict Prevention Rules

- Ensure zero conflict with the 'develop' branch whenever changes are made. 
- Never commit directly to `develop` or `main`.
- Before modifying files, inspect the current Git status and branch.
- Never overwrite, revert, or discard existing user changes.
- Keep changes focused and avoid unrelated file modifications.
- Before merging, synchronize with the latest `develop` and resolve conflicts carefully.
- Run relevant tests, linting, and type checks before proposing a merge.
- Never force-push shared branches.
- Never merge or rebase without explicit authorization.