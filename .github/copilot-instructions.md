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

- Check for divergence and potential conflicts with `develop` before proposing a merge; do not promise a conflict-free merge without verification.
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

---

## Existing Implementation and Future Changes

- Treat the current code, migrations, tests, and API contracts as the source of truth. This is a working product, not a greenfield scaffold; inspect the relevant implementation and current Git state before changing it. The inventory below is a navigation aid, not a guarantee that every capability is complete or deployed.
- **Identity and account:** `apps/backend/app/identity/` and `apps/web/src/app/identity-portal.tsx` cover authentication, customer profiles and addresses, sessions, vendor applications and documents, account controls, and administration. The signed-in customer account lives at `/`; preserve its real-data profile, address, session, security, and vendor-access workflows when changing the design.
- **Marketplace and retail:** `apps/backend/app/catalog/`, `apps/backend/app/orders/`, and `apps/web/src/app/marketplace/`, `cart/`, and `orders/` cover catalog discovery, products, wishlists, cart, checkout, inventory, fulfillment, and orders. Consult the current contracts and README before changing supported payment methods, delivery charges, or order behavior; do not imply capabilities that do not exist.
- **Vendor and wholesale:** `apps/backend/app/trading/` and `apps/web/src/app/vendor/` cover shop catalog, fulfillment, reviews, promotions, wholesale activity, and stock transfers. Maintain explicit shop selection and ownership checks across every related route and API.
- **Shared and administrative features:** `apps/backend/app/communications/`, `apps/backend/app/operations/`, and the frontend `messages/`, `notifications/`, `support/`, and `admin/` routes cover communication, support, reviews, operations, policies, and investigations. Preserve workspace-scoped access and the administrative audit trail.
- **Shared frontend context:** `apps/web/src/lib/workspace-context.tsx`, `workspace-state.ts`, and `api.ts` manage tab-specific context, request selectors, and stale-request protection. The workspace switcher is shared across routes; review its effects on all workspaces before changing navigation. For the installed Next.js version, follow `apps/web/AGENTS.md` and consult the relevant local Next.js documentation.
- Preserve existing integrations and records. Do not replace working flows with mock data, invent product claims or capabilities, or add controls that appear functional but are not connected to supported behavior. Handle loading, empty, error, success, and permission states explicitly.
- For frontend changes, maintain responsive layouts, semantic controls, keyboard access, visible focus, sufficient contrast, and reduced-motion support. Check representative desktop, tablet, and mobile views when feasible, and report when authentication or browser access prevents verification.
- Update relevant existing documentation and tests when implementation or behavior changes; keep this inventory concise and current instead of appending a chronological work log. Record significant limitations and unfinished work in the appropriate project documentation when relevant. Do not store credentials, personal data, or sensitive account details in instructions or documentation.
- Run the smallest relevant existing tests and checks, including frontend lint and type checking where applicable; expand validation when risk warrants it. Report what passed, what was not verified, and any failures without presenting unverified behavior as complete.