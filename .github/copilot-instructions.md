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

---

## Profiles, Workspaces, and Shop Isolation
- One account may have a customer profile and an approved vendor profile. Workspace selection changes the active context; it does not grant permissions.
- Keep Customer, Vendor, and Admin operations separate. Admin access is owner-only and must not implicitly authorize customer or vendor operations.
- Require explicit workspace context for protected operations. The backend must validate the authenticated session, profile, and resource authorization; workspace and shop headers are selectors, never proof of permission.
- In Vendor workspace, require an explicitly selected shop for shop-scoped actions. Never silently choose the first shop or infer a shop from a resource.
- Vendors may have at most three shops, including inactive shops. Keep shop listing and creation available, and scope catalog, fulfillment, wholesale, reviews, and related activity to the selected shop.
- Scope shared features—such as messages, notifications, support, and live updates—to the active workspace and, where applicable, the selected shop.
- Keep workspace selection tab-specific. On account, workspace, or shop changes, prevent stale requests from updating the newly selected context.
- Authenticate WebSocket connections with the user's session and validate workspace/shop selectors server-side; never put credentials or secrets in selectors.
- Prevent users from buying from or reviewing their own shops, including wholesale transactions between their own shops. Allow explicit stock transfers between distinct shops they own.
- Preserve existing records during migrations. For ambiguous historical workspace/shop data, require reviewed mappings; fail safely rather than guessing or deleting history. Test migration and rollback behavior against an isolated database.
- Add tests for authorization boundaries, workspace/shop switching, stale requests, shop limits, scoped shared features, and migration reconciliation.