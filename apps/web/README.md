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
