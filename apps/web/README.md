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
