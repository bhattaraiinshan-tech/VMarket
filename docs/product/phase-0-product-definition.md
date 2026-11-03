# Vendor's Market — Phase 0 Product Definition

**Status:** Review draft; proposed policies are not approved product decisions.  
**Product Owner:** To be assigned by the project sponsor.  
**Phase:** 0 — Product Definition and Design  
**Region and currency:** Nepal; NPR (रू) for displayed prices.  
**Companion deliverable:** [Interactive design prototype](../design/phase-0-prototype.html)

## 1. Product vision

Give customers in Nepal one trustworthy place to discover and buy from local shops, while giving businesses a secure
workspace to sell retail products and, in a later release, trade wholesale. A single vendor account can act as a seller,
business buyer, or supplier; these are shop capabilities, not separate account identities.

The platform has three experience areas:

1. **Customer marketplace** — find shops and products, compare offers, place and follow an order, and review an eligible
   purchase.
2. **Vendor workspace** — manage shop access, verification, catalogue, stock, and retail fulfilment.
3. **Administrator console** — review verification, moderate the marketplace, investigate transactions, and leave an
   attributable audit trail.

The product is a modular monolith, not a set of independently deployed services. Protected operations go through the
backend. The browser must never connect directly to PostgreSQL or private object-storage buckets.

## 2. Goals and success measures

### MVP goals

- Complete a trustworthy retail transaction: verified vendor → available product → customer order → vendor fulfilment
  → delivery/collection → eligible review.
- Make the total payable, availability, fulfilment option, and vendor identity clear before an order is submitted.
- Give authorized administrators enough context to investigate verification and transaction issues without bypassing
  access controls or losing an audit trail.
- Establish explicit, testable order, payment, cancellation, return, and verification rules before implementation.

### Proposed launch measures

The Product Owner should set numeric targets and baselines before launch. At minimum, instrument:

- Product discovery-to-order conversion and checkout abandonment.
- Order confirmation, fulfilment, delivery/collection, cancellation, return, and refund rates.
- Stock accuracy and oversell incidents.
- Vendor verification turnaround and incomplete-application rates.
- Support/dispute volume and time to resolution.
- Accessibility and task-completion results for customer, vendor, and admin core flows.

No target values are assumed in this draft.

## 3. Roles and access boundaries

| Actor | Purpose | Important boundary |
|---|---|---|
| Customer | Discover and buy products; follow orders; request eligible cancellation/returns; review completed purchases. | Access only their own profile, addresses, carts, orders, and reviews. |
| Vendor | Operate one or more shops; publish products and fulfil orders; later buy from other vendors. | Every shop action is authorized against that specific `shop_id` and the member's shop permission. |
| Shop staff | Perform only the tasks granted by a shop owner/admin. | Membership is shop-scoped; no implicit access to other shops or platform administration. |
| Platform administrator | Review vendor applications, moderate content, investigate orders, and configure policy. | Least-privilege admin permissions; sensitive actions require an immutable audit record. |
| System/integration | Apply order and payment transitions, issue notifications, and record events. | A client-side success screen is never proof of payment, stock reservation, or delivery. |

Vendor identity is shared across selling and business buying. A person does not need a second account to act as a buyer
in a later wholesale workflow.

## 4. MVP scope

### In scope

- Customer, vendor, and administrator experiences with role-appropriate navigation.
- Vendor registration, shop creation, application submission, and administrator verification decision.
- Shop storefront and retail product listings with images, variants where offered, price, and available stock.
- Product and shop discovery, search/filter/sort, product details, and comparison of visible offer details.
- Cart, checkout, customer delivery address, delivery/collection choice where available, and clear order total.
- Server-authoritative stock reservation and order creation; vendor confirmation and fulfilment; customer order history
  and status tracking.
- At least one business-approved payment or collection method. Cash on delivery is a proposed option only where
  operationally supported.
- Cancellation and return request handling under published eligibility rules.
- Verified-purchase reviews, basic moderation, and administrator transaction investigation.
- Admin actions and status overrides recorded with actor, timestamp, target, reason, and before/after values.

### Explicitly outside MVP (later phases)

- Wholesale catalogue, RFQs, negotiated quotes, purchase orders, vendor-to-vendor transfers, and trade documents.
- Persistent customer/vendor chat, rich notifications, support ticketing, and advanced dispute tooling.
- AI recommendations, visual search, forecasting, group buying, and advanced business intelligence.
- Multi-country operation, multi-currency settlement, and unconfirmed payment, map, or delivery-provider integrations.
- Microservices, until measured scale or reliability needs justify the operational cost.

Wholesale is a planned product capability, not a separate user identity. Its workflow is specified in section 9 so it can
be designed without expanding MVP acceptance scope.

## 5. Proposed business rules (approval required)

These are safe implementation defaults for review, not final legal, commercial, or operational policy.

1. **Shop isolation:** Authorize every vendor operation against the target shop and the actor's explicit membership and
   permission. Never rely on a generic vendor role alone.
2. **Verification:** A shop cannot publish or accept customer orders until approved. Applications can be draft,
   submitted, in review, awaiting information, approved, rejected, or suspended. Decisions and requests for information
   include a reason and are auditable.
3. **Private documents:** Verification files are private. Only authorized reviewers can access them through a
   backend-authorized, short-lived URL. Never return storage credentials or persistent private URLs to the browser.
4. **Price and availability:** Show the currency, unit price, variant, stock availability, and delivery/collection
   charges before order placement. Revalidate price, shop status, and stock on the server at checkout.
5. **Stock:** Reserve stock atomically with order creation. A failed checkout releases its reservation; concurrent
   orders cannot reserve the same final unit. The Product Owner must select the reservation expiry duration.
6. **Order separation:** A cart containing offers from multiple shops produces one customer-facing checkout with
   separately fulfillable shop orders. Each shop can see only its own fulfilment order.
7. **Payment integrity:** Payment and fulfilment are separate state machines. Mark an online payment paid only after
   trusted server-side provider verification; verify signed webhooks and make processing idempotent. Never trust a
   browser redirect or client success state.
8. **Cash on delivery/collection:** Enable only for shops, delivery areas, and order conditions the operations owner
   has approved. The vendor records collection; the customer cannot mark an order paid.
9. **Cancellation:** Before vendor confirmation, a customer may cancel an unpaid order; release reserved stock. After
   confirmation but before dispatch, cancellation is a request that the vendor or authorized support must decide.
   Once dispatched/delivered, use the return flow instead.
10. **Returns/refunds:** Only delivered orders can enter return review. Eligibility, deadlines, excluded categories,
    evidence requirements, return shipping costs, and refund timing must be published before launch. A return approval
    does not itself prove a refund; record refund state separately.
11. **Reviews:** Only the customer who owns a completed delivered purchase may review the purchased product/shop. Limit
    reviews per eligible purchase line; label verified purchases; allow reports and moderation. Do not remove the
    original review from the audit history when moderating.
12. **Administration:** Admin access is least-privilege. Record immutable audit entries for verification decisions,
    moderation, refunds/status overrides, and policy changes. A reason is required for overrides.
13. **Customer privacy:** Expose only the minimum customer/order data a vendor needs to fulfil its own shop order.
14. **Product content:** Reject or hold listings that lack required price, stock, and product details; publish only
    policy-compliant content. Define prohibited-product rules before vendor onboarding opens.

## 6. Order and payment states

### Retail fulfilment state machine

| State | Allowed next state(s) | Meaning |
|---|---|---|
| `pending_vendor_confirmation` | `confirmed`, `rejected`, `cancelled` | Order is created and awaiting this shop's decision. |
| `confirmed` | `preparing`, `cancel_requested`, `cancelled` | Vendor accepted; stock remains committed. |
| `preparing` | `ready_for_dispatch`, `ready_for_pickup`, `cancel_requested` | Vendor is preparing the order. |
| `ready_for_dispatch` | `in_transit`, `cancel_requested` | Order is handed to delivery. |
| `ready_for_pickup` | `delivered`, `cancel_requested` | Customer collection is available; record handover. |
| `in_transit` | `delivered` | Delivery provider/vendor reports handover to customer. |
| `delivered` | `return_requested`, `disputed` | Completion is recorded; eligible return window may apply. |
| `cancel_requested` | prior eligible state, `cancelled` | Cancellation awaits an authorized decision. |
| `return_requested` | `return_approved`, `return_rejected` | Return eligibility is under review. |
| `return_approved` | `returned` | Return has been received/confirmed under policy. |
| `returned` | `refund_pending`, `closed` | Refund, if due, is handled independently. |
| `refund_pending` | `refunded`, `refund_failed` | Refund is being verified/processed. |
| `rejected`, `cancelled`, `return_rejected`, `refunded`, `refund_failed`, `disputed`, `closed` | — | Terminal or support-managed states. |

Every transition is server-authoritative, timestamped, attributed to an actor or verified integration, and checked
against the current state. Invalid transitions are rejected and do not silently mutate stock, payment, or history.
Notifications are triggered from committed transitions, not optimistic browser state.

**Policy decision required:** confirm whether vendors can reject for specific reasons, whether `disputed` is an MVP
state or a support case, and the delivery/collection evidence that qualifies as `delivered`.

### Payment state machine (independent of fulfilment)

`unpaid` → `pending` → `authorized` / `paid` / `failed`; a paid transaction may later become
`partially_refunded` or `refunded`. COD/collection remains `due` until an authorized vendor records receipt, then
`collected`. Provider transaction IDs, currency/amount, idempotency key, verification result, and refund references
must be recorded. Never infer payment state from the order state.

**Policy decision required:** select supported provider(s), settlement/capture timing, COD eligibility, and who can
record collection/refunds. Use payment adapters so provider choice does not leak into order rules.

## 7. Vendor verification workflow

1. Vendor registers and creates a shop in `draft`.
2. Vendor completes required business information and submits; status becomes `submitted`.
3. Authorized reviewer moves it to `in_review`, `awaiting_information`, `approved`, or `rejected`, with a recorded
   reason for any request/decision.
4. Vendor can respond to an information request and resubmit; status returns to `submitted`.
5. Only `approved` shops may publish listings and receive new orders. An authorized administrator may suspend an
   approved shop with a reason; suspension blocks new transactions but preserves existing order records.
6. The system records status changes and reviewer identity. Applicant-visible status and next action are clear.

The Product Owner must confirm required documents/fields, eligibility policy, review service-level targets, resubmission
limits, and appeal process. Collect no document that is not required by approved policy.

## 8. Navigation and screen inventory

### Customer marketplace

- **Global:** marketplace home, search, categories, location/delivery area, cart, sign in/profile.
- **Browse:** search results with filters/sort, category results, shop page, product details and offer comparison.
- **Purchase:** cart, address selection, delivery/collection selection, payment choice, final review, confirmation.
- **After purchase:** order list, order detail/tracking, cancellation/return request, review form, profile and addresses.
- **Empty/error states:** no results, unavailable product/stock changed, payment pending/failed, delivery unavailable,
  order cancelled, and network retry.

### Vendor workspace

- **Global:** shop switcher (only shops the user may access), shop status, navigation, account.
- **Onboarding:** business profile, secure document submission, application status, requested-information response.
- **Operations:** overview, products, add/edit product, inventory, order queue, order detail/fulfilment, shop settings,
  staff/permissions (later if MVP time is constrained).
- **Empty/error states:** verification blocked, no products/orders, insufficient shop permission, stock conflict, and
  rejected/failed image upload.

### Administrator console

- **Global:** admin navigation, permission-aware identity, audit access.
- **Operations:** overview, vendor verification queue/detail, product moderation, users/shops, order/payment
  investigation, reported reviews, policy/configuration, audit log.
- **Sensitive screens:** show private verification files only after server authorization; require a reason for decisions
  and overrides; confirm irreversible actions.
- **Empty/error states:** no pending cases, insufficient permission, stale record, failed action, and access denied.

The [prototype](../design/phase-0-prototype.html) visualizes the marketplace landing page, vendor order workspace, and
administrator verification queue. Remaining screens are specified here and are to be designed before implementation.

## 9. Core workflows

### Retail purchase and fulfilment

1. Vendor submits a listing; server validates shop approval, listing policy, price, and available stock.
2. Customer discovers and inspects a product/offer; vendor, stock, price, fulfilment option, and relevant conditions
   are visible.
3. Checkout revalidates the cart and delivery area, calculates a server-authoritative total in NPR, and reserves stock
   atomically.
4. Customer confirms the order and payment/collection method; each shop receives only its own fulfilment order.
5. Server verifies any online payment. If payment is pending/fails, show that explicitly and do not show paid.
6. Vendor confirms/rejects, prepares, hands off or prepares collection, and records valid fulfilment events.
7. Customer follows status and receives transition-based notifications. On delivery/collection, mark the order
   delivered with the approved evidence.
8. Customer may request cancellation/return under section 6; eligible completed orders may be reviewed under section 5.
9. Administrators can investigate the complete order/payment/audit history with least privilege.

### Cancellation and return

- Cancellation before vendor confirmation is immediate only if the order is unpaid; release the reservation once.
- After confirmation and before dispatch, create a visible request; vendor/support decision is recorded with reason.
- Once dispatched, do not offer ordinary cancellation; direct the customer to published return/support options.
- A return request captures order line, reason, and optional evidence. An authorized party checks policy eligibility.
- Keep return decision, physical return receipt, and refund outcome as separate recorded events.
- Show the customer the decision and next action; do not promise a refund until verified.

### Payment

- The customer sees total amount, currency, method-specific conditions, and pending/failed states.
- The backend creates an idempotent payment attempt and verifies provider results/webhooks before marking paid.
- Replayed callbacks do not create duplicate payment/refund entries or advance order state twice.
- COD/collection availability is calculated from approved business rules and recorded separately from order delivery.

### Delivery and collection

- At checkout, offer only methods/areas supported by the relevant shop. State estimated fees and service expectations
  before confirmation.
- The vendor's fulfilment order contains only the address/contact fields required for its delivery.
- Record dispatch/collection handover and delivery completion with source, timestamp, and reference when available.
- If no method is available, prevent placing the affected shop order and explain how to proceed.

**Policy decision required:** choose delivery ownership (vendor, provider, or both), service-area definition, tracking
source, service estimates, failed-delivery handling, and pickup handover proof.

### Wholesale (post-MVP)

1. An approved vendor acts as a business buyer and discovers another vendor's wholesale offer.
2. Buyer sends a request for quotation (RFQ) containing product/quantity and requested terms.
3. Supplier responds with a versioned quote, unit price, minimum quantity, expiry, availability, delivery/payment terms.
4. Buyer accepts a valid quote; server creates a purchase order with immutable accepted terms.
5. Buyer and supplier fulfil against the purchase order, record shipment/receipt, and settle using approved business
   terms; disputes preserve the negotiation and transaction history.

RFQ/quote states: `draft`, `submitted`, `quoted`, `revised`, `accepted`, `declined`, `expired`, `withdrawn`.
Purchase-order states: `awaiting_supplier_confirmation`, `confirmed`, `preparing`, `in_transit`,
`partially_received`, `received`, `cancel_requested`, `cancelled`, `disputed`, `closed`. This requires a separate
post-MVP policy and acceptance pass; it is not included in MVP launch criteria.

### Review

- Show a review action only for a delivered eligible purchase line owned by the signed-in customer.
- Enforce one review per eligible line, verified-purchase labeling, rating/content validation, and server-side
  ownership on submission.
- Allow reporting and moderation; preserve the original content and audit the moderator action.
- Do not allow vendor/admin impersonation of a customer review.

## 10. MVP user stories and acceptance criteria

Owners below are accountable **roles**, not assigned individuals. The Product Owner must assign named owners before
the Phase 0 completion gate. Every story is a proposed acceptance contract for review.

| ID / Owner | User story | Acceptance criteria |
|---|---|---|
| CUS-01 — Product Owner (TBD) | As a customer, I want to find products and shops so I can discover relevant offers. | Search, category browse, filters, sorting, and pagination return only publishable/in-stock offers by default; results show price, shop, and availability; no-results and retry states are usable; location is optional until the customer chooses a location-dependent feature. |
| CUS-02 — Product Owner (TBD) | As a customer, I want to inspect and compare offers so I can make an informed choice. | Product details show images, description, variant, NPR price, stock availability, shop identity, and supported delivery/collection conditions; unavailable offers cannot be added to cart; stale price/stock is revalidated at checkout. |
| CUS-03 — Product Owner (TBD) | As a customer, I want to checkout and place an order so I can purchase from a shop. | Cart quantities and totals are validated server-side; checkout presents item subtotals, fees, currency, address, fulfilment, and payment method before confirmation; stock is reserved atomically; duplicate submissions are idempotent; multi-shop carts create isolated shop fulfilment orders; failures explain whether an order was created. |
| CUS-04 — Product Owner (TBD) | As a customer, I want to track and cancel an order so I know what will happen next. | Only the owner can view the order; each valid status and timestamp is visible; cancellation follows the state rules in section 6; the customer sees request/decision and reason; unauthorized or invalid transitions do not change state. |
| CUS-05 — Product Owner (TBD) | As a customer, I want to request an eligible return so I can resolve a problem with a delivered order. | Only the owner of an eligible delivered order can submit; request identifies affected line/reason and optional evidence; eligibility and deadline are displayed; decision and reason are recorded; refund status is shown separately from return approval. |
| CUS-06 — Product Owner (TBD) | As a customer, I want to review a completed purchase so I can share trustworthy feedback. | Only eligible delivered lines are reviewable; backend checks ownership and enforces the per-line limit; verified-purchase status is accurate; reports/moderation do not erase audit history. |
| VEN-01 — Vendor Operations Owner (TBD) | As a vendor, I want to register and create a shop so I can apply to sell. | Account can create a shop with required fields; shop starts unapproved; applicant sees missing information and current status; no listing/order acceptance is possible before approval. |
| VEN-02 — Vendor Operations Owner (TBD) | As a vendor, I want to submit verification information securely so my shop can be reviewed. | Required fields/files are specified; files are private and accessed only through authorized short-lived URLs; application can be submitted/resubmitted; reviewer decisions and reasons are visible to the applicant and auditable. |
| VEN-03 — Vendor Operations Owner (TBD) | As an approved vendor, I want to manage products and stock so customers can buy accurate listings. | Only authorized members of the selected shop can create/update listings; price, stock, and required content are validated; images follow the approved upload policy; a shop cannot expose another shop's products or inventory. |
| VEN-04 — Vendor Operations Owner (TBD) | As a vendor, I want to process my shop's orders so I can fulfil purchases. | Vendor sees only its shop orders and minimum necessary customer data; confirmation, rejection, preparation, dispatch/pickup, and delivery actions enforce valid transitions; each action records actor/time; stock and payment changes are consistent and auditable. |
| VEN-05 — Vendor Operations Owner (TBD) | As a vendor, I want to know when payment is due or verified so I can fulfil accurately. | Payment state is distinct from fulfilment; online paid state requires backend verification; COD/collection is due until an authorized collection record exists; duplicate callbacks/collection actions do not duplicate settlement. |
| ADM-01 — Marketplace Operations Owner (TBD) | As an administrator, I want to review verification applications so I can approve eligible shops. | Queue is permission-guarded; reviewers see only authorized private files; approve/reject/request-information/suspend actions require permitted state and reason; vendor sees status and next action; every decision is audited. |
| ADM-02 — Marketplace Operations Owner (TBD) | As an administrator, I want to investigate listings and orders so I can resolve marketplace issues. | Search/detail views show relevant order, payment, shop, and transition history; private/customer fields are minimized; moderator/override actions require a reason and permission; changes are attributed and recoverable from the audit trail. |
| ADM-03 — Security Owner (TBD) | As a platform operator, I want an immutable audit trail so sensitive actions are accountable. | Audit entries include actor/service identity, action, target, timestamp, reason where required, and before/after values; ordinary users cannot edit/delete entries; unauthorized reads/writes are denied and logged. |

### Post-MVP story (not part of MVP acceptance)

| ID / Owner | User story | Acceptance criteria |
|---|---|---|
| WHO-01 — Wholesale Product Owner (TBD) | As a vendor, I want to request and accept a supplier quote so I can buy stock from another vendor. | Only approved business accounts can transact; RFQ/quote revisions and expiry are visible; acceptance snapshots the agreed terms into a purchase order; buyer/supplier access is isolated; shipment, receipt, payment, and dispute history is auditable. |

## 11. Accessibility, localization, and UX requirements

- Responsive layouts for mobile-first use and larger vendor/admin workspaces.
- Keyboard-operable navigation and controls, visible focus, semantic headings/labels, sufficient contrast, and meaningful
  alternative text.
- Do not communicate status with color alone; pair state colors with text/icons.
- Use plain language, explicit error recovery, and confirmation for consequential actions.
- Display NPR consistently; keep date/time presentation locale-aware and store timestamps unambiguously.
- Prepare layouts and text for Nepali and English. Translation scope and launch language(s) require Product Owner
  approval; do not hard-code copy into business rules.
- Avoid exposing personal addresses, verification documents, or payment details in public screens and analytics.

## 12. Phase 0 decisions, owners, and completion gate

### Decisions requiring named-owner approval

| Decision | Accountable owner | Proposed default pending approval |
|---|---|---|
| MVP and post-MVP scope | Product Owner (TBD) | Section 4 |
| Vendor eligibility, required proof, review/appeal policy | Vendor Operations Owner (TBD) | Section 7; collect minimum required proof |
| Payment provider, capture/settlement, COD eligibility | Payments/Finance Owner (TBD) | Provider adapter; no provider assumed; COD only where explicitly supported |
| Delivery model, service areas, fees, estimates, proof | Delivery Operations Owner (TBD) | Offer only shop-supported methods; disclose fees before order |
| Cancellation, return window, exclusions, refund timing | Customer Operations Owner (TBD) | Section 6 defaults; deadlines and exclusions must be set before launch |
| Product/review moderation policy | Marketplace Operations Owner (TBD) | Hold/remove policy-violating content with auditable reason |
| Language(s), accessibility target, success metric thresholds | Product Owner (TBD) | English/Nepali-ready; set measurable targets before launch |
| Staff roles and admin permissions | Security Owner (TBD) | Least privilege and explicit shop-scoped access |

### Completion gate checklist

- [x] Draft requirements, personas/roles, MVP boundary, business rules, and user stories are documented.
- [x] Customer, vendor, and administrator navigation and primary screen inventory are documented.
- [x] Primary experience screens and reusable visual patterns are represented in the interactive prototype.
- [x] Retail order/payment states, cancellation/return, verification, payment, delivery, wholesale, and review workflows
  are documented.
- [x] MVP stories have testable acceptance criteria and role-based owner placeholders.
- [ ] Project sponsor assigns named Product/Operations/Security owners.
- [ ] Required policy decisions above are reviewed and approved by their named owners.
- [ ] Owners confirm the prototype and acceptance criteria; record review/date and changes here.

**Gate status: NOT COMPLETE — review and named-owner approval are outstanding.** Phase 1 should begin after the
remaining items are resolved or explicitly accepted as tracked decisions by the sponsor.

## 13. Change control

Record approved decision changes here with date, owner, decision, and affected story/rule IDs. Do not silently change a
published payment, stock, return, or authorization rule in implementation.

| Date | Owner | Decision/change | Affected IDs |
|---|---|---|---|
| — | — | No approvals recorded; all policies remain proposed. | — |
