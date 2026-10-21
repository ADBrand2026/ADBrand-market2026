# AD Brand Market — Non-food Home Delivery Plan

## Customer promise
- Clothes, shoes and slippers are delivered to the customer's saved delivery address.
- Customer self-pickup is not offered.
- Food, tea, snacks and grocery delivery remain on AD's in-house rider flow.
- Never display a courier name, fee, AWB/tracking number or delivery estimate unless the provider returned/confirmed it.

## Recommended courier strategy (not yet connected)
1. **First integration candidate: Shiprocket aggregator.** Use its serviceability/rate response to compare eligible courier partners for each shipment. The API documents courier serviceability/rates, shipment booking and tracking/webhooks: https://apidocs.shiprocket.in/?version=latest
2. **Comparison/backup: Delhivery direct API.** Validate serviceability and rate, then compare total cost and service terms: https://one.delhivery.com/developer-portal/documents/b2c/
3. **Low-cost route comparison: India Post Speed Post/Parcel**, where its product, delivery time, tracking, COD and insurance terms fit the shipment: https://www.indiapost.gov.in/mailproducts/domesticservices/speedpostparceldomestic

Do not select a courier by base freight alone. Compare total payable cost including chargeable/volumetric weight, COD fee, remote-area/handling charges, reverse/RTO fees, declared-value/insurance terms, serviceability, delivery estimate and tracking quality. Choose the lowest total-cost option among eligible providers that meets the safety and service requirements.

## Current implementation status
- Customer checkout UI offers Home Delivery only.
- Supabase `checkout_marketplace_order_v2` rejects any non-food fulfilment value other than `delivery`; client-side UI is not the only enforcement.
- Existing `external_shipments` and customer quote acceptance/rejection workflow remain in place for compatibility with any previously created pending shipment.
- Courier API/account, live quote-before-order, real booking, tracking webhooks, insurance handling and courier pickup are **not live**.
- **Safety gate active:** non-food checkout is paused in both the storefront and `checkout_marketplace_order_v2` until live quote-before-order and cost-split logic are connected. A direct RPC call must not bypass this gate.
- No new non-food order should be created with an unknown delivery fee. Existing pending shipments are not proof of courier booking.
- Customers can accept a displayed quote with one explicit action, or decline to cancel without a platform cancellation penalty; extra confirmation and note prompts were removed.

## Secure integration checklist
- Keep provider credentials only in Supabase Edge Function secrets; never put them in `index.html`, public config, or client-side JavaScript.
- Edge Function must authenticate/authorize the customer/order, calculate shipment weight/dimensions from trusted product/package data, validate pickup and delivery PINs, and fetch a live rate before the final customer commitment.
- Present the actual fee and delivery estimate once before order confirmation; avoid placing a customer order and then surprising them with an unknown fee.
- Calculate the billable courier total from the provider response, including freight, COD/handling charges and applicable taxes/surcharges. Set customer share to half (rounded to a rupee) and seller share to the remainder so both shares add up exactly to the carrier total; do not count shipping reimbursement as AD profit.
- Keep AD's approved commission and any separately disclosed platform fee distinct from courier cost. Apply RTO/reverse charges only under the published, responsibility-based policy; never silently deduct unknown fees.
- Create courier booking only after customer consent and the correct COD/prepaid mode are verified.
- Validate webhook authentication/signature, make updates idempotent, store provider event IDs, and accept only valid state transitions.
- Store actual provider, quote, charge, AWB, label reference and tracking events; never fabricate them.
- Reconcile COD, shipping fee, RTO/return fee and seller settlement separately.
- Test with a provider test account and a real controlled shipment before enabling live bookings.

## Required before live integration
A Shiprocket (or direct Delhivery) business account, verified pickup/return address and PIN, approved API credentials stored as Supabase secrets, actual packaging weight/dimensions, and agreement on COD, RTO, claims/insurance and charges. No credentials are stored in this repository.
