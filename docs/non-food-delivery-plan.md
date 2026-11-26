# AD Brand Market — Courier-independent delivery plan

## Customer promise
- Food, tea, snacks, grocery and non-food orders are fulfilled by an external courier/logistics provider selected by AD; AD's own delivery-boy flow is not part of customer fulfilment.
- Customer self-pickup is not offered.
- Food and non-food remain separate checkout verticals. Never combine them in one order.
- Never display a courier name, fee, AWB/tracking number, pickup confirmation or delivery estimate unless the selected provider returned/confirmed it.
- Do not accept a live order when a supported courier cannot serve the seller pickup PIN and customer delivery PIN.

## Courier selection is intentionally deferred
No provider is selected or connected yet. Compare providers only after AD has confirmed its business eligibility and the provider has confirmed the required service. Evaluate:
- Seller pickup and customer delivery PIN serviceability, including local food delivery and intercity non-food parcels.
- Total landed cost: freight, chargeable/volumetric weight, COD and remittance fees, taxes, remote-area/handling charges, reverse/RTO fees and insurance/claims.
- Pickup SLA, delivery estimate, tracking events, webhook reliability, cancellation and failed-pickup handling.
- Seller-paid shipping support, COD remittance to the correct beneficiary, settlement statements, support escalation and account/KYC requirements.
- Food acceptance, packaging/temperature restrictions, prohibited items and local delivery availability.
- Return-to-origin, customer refusal, damage/loss claims and proof-of-delivery terms.

A cheap base freight rate alone is not sufficient. Choose the lowest total-cost eligible provider that meets service, safety and operational requirements. Keep provider integration behind an adapter so a later provider change does not require rewriting checkout or seller settlement.

## Order and fulfilment lifecycle
1. Customer cart is validated as FOOD or NON_FOOD; mixed carts are rejected.
2. Before final confirmation, backend obtains a live provider quote using trusted seller pickup address, customer delivery address, package dimensions/weight and payment mode.
3. Show customer platform fee and any delivery charge transparently before consent. No unknown or estimated-as-final charge.
4. Create order/payment intent idempotently. Do not book shipment before payment/COD mode and customer consent are confirmed.
5. Book pickup with the selected provider; store provider, quote, booking ID, AWB, label reference and expected pickup/delivery timestamps.
6. Track pickup, in-transit, out-for-delivery, delivered, failed, cancelled, returned and RTO events. Verify webhook signatures, deduplicate provider event IDs and enforce valid state transitions.
7. Save pickup proof and delivery proof where provider supplies them. Never invent OTP, scan, signature or GPS evidence.
8. Reconcile provider invoices, COD collections/remittances, shipping charges, RTO/return charges, refunds and seller settlements separately.

## Seller pickup and settlement rules
- Seller must have a verified pickup address, contact number, PIN code and operating pickup availability before the item can be marked ready.
- Seller packs and marks the order ready; courier pickup is not considered complete until the provider confirms it.
- Seller's item proceeds, AD commission/service fee, customer platform fee, courier freight, COD fees, taxes, refunds and reverse logistics are separate ledger entries.
- The proposed ₹20 customer platform fee is an AD fee per non-food seller order only if the final published pricing and checkout implementation both confirm it. It is not courier freight or seller shipping reimbursement.
- Actual courier cost is charged to the seller only when a verified quote/booking and published seller agreement authorize it. Do not silently deduct unknown fees.
- Seller payout becomes payable only after the defined delivery/return risk window and reconciliation rules; hold disputed, refunded, RTO and COD-unremitted amounts. Show seller a per-order statement and payout history.
- Payout destination ownership, beneficiary verification, payout approval, idempotency and failure/reversal handling must be implemented before automated payouts are enabled.
- COD is not seller-paid until the courier's remittance is actually reconciled to AD/the seller's agreed beneficiary.

## Existing repository/backend observations
- Storefront checkout currently has a non-food delivery safety gate documented as paused until seller-paid courier booking and shipping/RTO settlement are connected.
- The database RPC `checkout_marketplace_order_v2` is documented as rejecting non-food fulfilment values other than delivery; verify the live database function before launch.
- Existing `external_shipments` and quote acceptance/rejection workflow are retained for compatibility with pending shipments; these records are not proof of a live courier booking.
- `orders.platform_fee`, `orders.seller_shipping_cost` and `orders.seller_shipping_status` are described in the existing implementation notes; verify actual columns, constraints, RLS and ledger postings in the live database before enabling checkout.
- The `product_vertical_registry` migration creates a server-side FOOD/NON_FOOD registry and synchronizes it from `products.is_food`. Verify migration application and Edge Function deployment in the live Supabase project.
- The latest public UI commit removes legacy food, self-pickup and in-house delivery options. Keep this plan aligned with that behavior.

## Secure integration requirements
- Provider credentials live only in Supabase Edge Function secrets. Never put secrets in `index.html`, public config or browser JavaScript.
- Edge Functions must authenticate the user, authorize access to the order/seller, calculate package data from trusted records, validate pickup/delivery PINs and fetch a live provider rate.
- Webhooks must verify provider signatures, deduplicate event IDs, enforce monotonic/valid transitions and log failures without exposing secrets or personal data.
- Use idempotency keys for order creation, payment capture/refund, shipment booking, cancellation and payout.
- Restrict private address, phone, KYC and shipment documents using RLS and private storage; issue short-lived signed links only to authorized parties.
- Rate-limit OTP, checkout, quote, booking and webhook endpoints. Keep an audit trail for admin changes and settlement adjustments.

## Launch blockers — do not bypass
- No courier provider account/API, confirmed local-food service, live rates, shipment booking, tracking webhook or verified pickup proof is connected.
- No live payment gateway, refund automation or COD remittance reconciliation is evidenced by this repository.
- No verified seller payout execution, bank beneficiary verification or automated settlement is evidenced here.
- Do not open checkout for any vertical until its complete quote → consent → payment/COD → booking → pickup → tracking → delivery/return → reconciliation path passes controlled end-to-end tests.
- A GitHub Pages build or JavaScript syntax check does not prove Supabase policies, Edge Functions, payments, courier APIs or real-world delivery are working.

## Required controlled tests before launch
Test separately for FOOD and NON_FOOD: successful prepaid order; COD where supported; unavailable pickup PIN; unavailable delivery PIN; quote expiry/price change; seller not ready; failed pickup; duplicate webhook; delayed/out-of-order webhook; delivered; customer unavailable; cancellation before and after pickup; damaged/lost parcel; return/RTO; partial/full refund; COD remittance mismatch; seller payout hold/release/failure; admin unauthorized access; duplicate clicks/retries; and network interruption. Confirm the customer, seller and admin screens all show consistent state and ledger totals.
