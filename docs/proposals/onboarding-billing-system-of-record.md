# Canary onboarding and billing system of record

Status: **proposal for approval — not deployed**

## Decision requested

Approve a protected Postgres system of record for customer onboarding, district membership, billing, Stripe event processing, and billing documents. The dashboard remains open to provisioned members; payment state remains informational until a separate access-enforcement decision is approved.

## Current-state risks addressed

- Supabase Auth metadata is useful as a protected cache but is not a complete, relational billing ledger.
- Payment/session replay state lacks a durable Stripe event ledger.
- Onboarding intake, district membership, billing status, and billing documents are not represented as one auditable lifecycle.
- `client_credentials` contains a legacy temporary-password field and should be retired; plaintext/recoverable passwords must never be a customer record.
- Quote, W-9, invoice/PO, payment, and receipt references need explicit, queryable states.

## Proposed model

| Table | Purpose |
|---|---|
| `customer_organizations` | Legal/display/billing identity linked to a Canary district |
| `customer_memberships` | Protected Auth user → organization/district role mapping |
| `platform_roles` | Districtless Canary administrators |
| `onboarding_requests` | Intake and approval workflow before activation |
| `billing_accounts` | One authoritative billing lifecycle per organization |
| `billing_events` | Idempotent, immutable Stripe event ledger |
| `billing_documents` | Quote, W-9, invoice, receipt, PO, and provider references |

## Access policy

Payment and dashboard authorization are deliberately separated:

1. A user may access a district dashboard when they have an active protected membership for that organization/district.
2. A platform admin may access the admin district-selection path.
3. `payment_status`, `trial_ends_at`, and `paid_through` do **not** gate dashboard access while `CANARY_ENFORCE_PAYMENT_ACCESS` is disabled.
4. Only an explicit membership suspension blocks a provisioned user.
5. Enabling payment enforcement later requires a separately reviewed code/config change and customer-communication plan.

## Lifecycle

### Intake

`onboarding_requests`: submitted → under_review → approved/rejected → provisioned.

Approval creates or links:

- a customer organization
- a district membership
- a billing account
- monitoring/search profiles through the existing controlled setup process

### Commercial documents

The intended sequence is represented without conflating documents with payment state:

1. Quote/estimate
2. W-9
3. Invoice, including customer PO number when supplied
4. Stripe/offline payment reconciliation
5. Receipt marked paid

### Payment

- Signed Stripe webhook inserts `billing_events.stripe_event_id` once.
- Processing occurs transactionally and updates `billing_accounts` only from signed/server-verified data.
- Browser success reconciliation can request a replay but cannot create authoritative payment state.
- Customer ownership is verified against the organization/account before a Stripe Customer is reused.

## Constraints

- Stripe Customer, Checkout Session, Subscription, and Event IDs are unique where present.
- One billing account exists per customer organization.
- One district is linked to at most one active customer organization in the initial model.
- Membership and platform-role writes are service-controlled.
- Event payloads are minimized; raw secrets and payment method data are never stored.
- Billing events and document history are append-oriented and auditable.
- All timestamps are `timestamptz`.

## Backfill and cutover

1. Take backups of Supabase Auth metadata and relevant public tables.
2. Generate a dry-run mapping report:
   - district-linked users
   - districtless admins
   - paid/trial accounts
   - Stripe Customer/session ownership
   - duplicate emails/districts and unresolved organizations
3. Have Leslie resolve any genuinely ambiguous account/district mappings; do not guess.
4. Create organizations and memberships for verified district-linked users.
5. Create platform roles for verified Canary admins.
6. Verify paid accounts against Stripe before inserting billing state.
7. Dual-read the new tables and protected Auth metadata; report mismatches without changing access.
8. Switch application billing/membership reads to Postgres after the mismatch report is clean.
9. Keep dashboard payment enforcement disabled.
10. Remove obsolete billing state from Auth metadata after a stabilization window.
11. Retire `client_credentials`; securely remove the legacy temporary-password data only after login/provisioning is verified.

## Verification gates

- Every current district-linked user resolves to the same district before and after cutover.
- Every platform admin remains districtless/global unless explicitly assigned.
- All currently paid accounts match Stripe customer/session ownership and paid-through dates.
- Replaying a Stripe event does not duplicate state or move dates.
- An authenticated district user cannot read another organization’s membership/billing records.
- Payment status changes do not close dashboard access while enforcement is disabled.
- No plaintext/recoverable password remains in the canonical model.
- Rollback restores pre-cutover application reads without data loss.

## Approval boundary

The companion SQL is a structural proposal only. Do not apply it until:

- Dustin approves the table model and open-access policy;
- Leslie resolves any ambiguous account mappings;
- a dry-run backfill/mismatch report is reviewed;
- backup and rollback commands are prepared and tested.
