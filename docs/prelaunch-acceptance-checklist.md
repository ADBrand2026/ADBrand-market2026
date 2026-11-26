# AD Brand Market — Pre-launch acceptance checklist

This checklist is a release gate, not a claim that the features are already implemented. Mark an item PASS only after a real test in the production-like Supabase project. A syntax check or UI screenshot is not an end-to-end pass.

## 1. Public storefront and navigation
- [ ] Home, category, search, filters, sorting, product details, seller storefront, offers and responsive mobile/desktop layouts.
- [ ] Public role choices show only Customer and Seller as intended; no public Admin entry and no in-house delivery-boy application/fulfilment path.
- [ ] Every visible button, link, modal close, back action, language selector, empty state and error state has a working destination/action.
- [ ] No dead links, placeholder buttons, demo-only data presented as live, or stale food/self-pickup copy.
- [ ] Accessibility: keyboard focus, labels, contrast, validation messages and mobile touch targets.

## 2. Identity, roles and account security
- [ ] Browse products without login; require login for cart persistence, address book, order placement and account actions.
- [ ] Register/login/logout, session refresh, password reset and configured email/OTP flows work on real accounts.
- [ ] Duplicate account protection works for the same verified identity; role/profile creation is atomic and retry-safe.
- [ ] Customer and seller role applications cannot self-approve or elevate privileges.
- [ ] Admin access is private, requires authenticated active admin profile, and is enforced by database/RPC authorization and RLS—not by hiding a button.
- [ ] Disabled, suspended and unverified accounts are blocked from protected actions.
- [ ] No secret/service-role key is present in browser assets, public repository or logs.

## 3. Seller onboarding and catalogue
- [ ] Seller application captures only legally/operationally necessary fields; registration/GST requirements are not falsely made universal.
- [ ] Seller identity/contact, pickup/return address, PIN serviceability, bank/beneficiary verification and agreement status are tracked.
- [ ] Admin approval/rejection, reason, resubmission, suspension and audit history work.
- [ ] Product create/edit/archive, category, variants, photos, stock, price, tax, offers and availability are persisted server-side.
- [ ] Inventory is reserved atomically at checkout and restored on failed/cancelled orders according to policy.
- [ ] Seller cannot change price, stock, payout destination or order ownership through client-side tampering.

## 4. Cart, vertical isolation and checkout
- [ ] Food and non-food products cannot share one checkout, including direct RPC/API calls.
- [ ] Server verifies product status, seller status, stock, price, quantity, address and serviceability at order time.
- [ ] No customer self-pickup or AD-owned delivery-boy fulfilment option is exposed.
- [ ] External courier quote is fetched before final confirmation; customer sees total payable amount and fee breakdown.
- [ ] Checkout is blocked when quote, provider, pickup address, delivery PIN or final charge is unavailable.
- [ ] Double-click, retry, refresh and concurrent checkout cannot create duplicate orders or charge twice.
- [ ] Terms, cancellation, return/refund and delivery estimate are visible before confirmation.

## 5. External courier lifecycle — both verticals
- [ ] Provider explicitly supports the parcel/food type, packaging, route and seller pickup PIN.
- [ ] Seller pickup address/contact, package weight/dimensions and pickup availability are validated.
- [ ] Quote, consent, shipment booking, pickup confirmation, AWB, label and tracking are stored from provider responses only.
- [ ] Signed webhooks are verified; event IDs are deduplicated; invalid/out-of-order transitions are rejected or reconciled.
- [ ] Pickup failure, delayed pickup, lost/damaged parcel, customer unavailable, refusal, cancellation, reverse pickup and RTO are handled.
- [ ] Customer and seller can see accurate tracking and support/escalation details.
- [ ] Provider outage, timeout, rate change and webhook outage have safe retry/manual recovery paths.

## 6. Payments, COD, ledger and seller payouts
- [ ] Prepaid payment intent, success, failure, timeout, duplicate callback, capture and refund are verified with gateway signatures.
- [ ] COD is offered only where the selected provider supports it and the remittance beneficiary/process is configured.
- [ ] Separate ledger entries exist for item proceeds, AD commission, customer platform fee, shipping, COD fee, tax, refund, RTO and adjustments.
- [ ] Seller shipping deductions use verified provider charges and the accepted seller agreement; never unknown or silent deductions.
- [ ] COD is not marked settled until remittance reaches the agreed beneficiary and is reconciled.
- [ ] Seller payout beneficiary ownership is verified; payout approval, idempotency, failed payout and reversal are tested.
- [ ] Seller statement shows gross sales, each deduction, holds, payable amount, payout reference and history.
- [ ] Refund, partial refund, chargeback/dispute and cancellation calculations reconcile exactly.

## 7. Orders, customer support and post-delivery
- [ ] Customer sees order history, item/order status, address, payment status, invoice/receipt and support entry.
- [ ] Seller sees only their own order lines and permitted customer/pickup information.
- [ ] Cancellation rules differ correctly before and after courier pickup.
- [ ] Return eligibility, return window, evidence, approval, reverse shipment and refund status work.
- [ ] Reviews are limited to eligible delivered purchases; moderation/reporting works.
- [ ] Notifications are delivered through configured channels; failures are visible and retryable.

## 8. Admin, privacy and operations
- [ ] Admin dashboard lists customers, sellers, products, orders, refunds, disputes, shipments, settlements, payouts and audit events.
- [ ] Admin actions require server-side role checks, reason capture and immutable audit events.
- [ ] RLS is enabled and tested for every exposed table, storage bucket and RPC; anon/user cannot read another user's private data.
- [ ] KYC, identity, bank, address and phone documents use private storage and short-lived authorized access.
- [ ] Rate limits, abuse protection, input validation, SQL/RPC authorization and error handling are tested.
- [ ] Backups, restore procedure, incident contact, monitoring and database migration rollback/recovery are documented.

## 9. Production release gate
- [ ] Live Supabase schema, migrations, RLS policies, triggers, RPCs and Edge Function versions have been audited.
- [ ] GitHub Pages points to the intended branch/folder and the deployed commit matches the tested commit.
- [ ] No unresolved critical/high security or money-flow defects.
- [ ] Controlled end-to-end tests pass for both FOOD and NON_FOOD, prepaid and supported COD, successful delivery and failure/return paths.
- [ ] Test accounts/orders are clearly separated from real customers and financial records.
- [ ] Customer-facing fees, seller agreement, shipping responsibility, COD, refund, cancellation, privacy and support policies are published and consistent with implementation.
- [ ] Launch is explicitly approved only after all applicable blockers are closed.

## Known external dependencies
Courier account/API and serviceability, payment gateway, COD remittance, seller payout rails, business/pickup KYC, email/SMS delivery, and any applicable tax/legal obligations require provider/account decisions and real credentials. These cannot be truthfully marked complete from source-code syntax checks.
