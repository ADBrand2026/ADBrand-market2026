# AD Brand Market — live technical audit (2026-11-26)

This is a point-in-time audit of the connected Supabase project and GitHub repository. It is not a claim that the marketplace is production-ready.

## Confirmed live database state

- 95 public tables were found; all 95 have Row Level Security enabled.
- The profile privilege guard is installed. Authenticated users cannot directly update `profiles.role`, `profiles.is_admin`, `profiles.is_active`, or `profiles.user_id`.
- The profile trigger prevents self-promotion and checks that a changed mobile matches the verified Auth phone.
- One active profile has the `is_admin` flag; the private Admin Edge Function checks an authenticated user token and an active admin role/flag before serving the private page.
- No seller, product, order, shipment, payment, settlement, or seller payout-account rows were present at audit time.
- Shiprocket, NimbusPost, and Delhivery One provider records are disabled, not health-checked, and not checkout-ready.
- The live `get_courier_checkout_readiness()` result is `ready: false`; it explicitly reports that courier account, wallet, pickup locations, and live API readiness are not confirmed.
- The server-side order function requires a verified Auth phone, matching delivery mobile, valid customer email/address, COD, NON_FOOD vertical, and an enabled healthy courier configuration. It rejects FOOD orders for this launch and blocks checkout until courier readiness is enabled.
- The private Admin Edge Function validates the bearer token with Supabase Auth and requires an active admin profile. It is deployed with `verify_jwt=false` because it performs its own token validation.
- The Shiprocket control Edge Function is deployed with `verify_jwt=true`. Two source-level defects were fixed: customer email is selected in the address query, and the Shiprocket token is initialized before NDR actions.
- SMS Auth Hook functions validate the Supabase Auth Hook signature. Actual SMS delivery and provider credentials were not verified in this audit.
- COD is the only checkout payment method allowed by the database function. No live UPI/payment gateway or automated bank payout rail was confirmed.

## Changes made during this audit

- First-launch storefront scope is Non-Food products only.
- Food entry is removed from the public storefront until a suitable external food-courier integration is confirmed.
- Self Pickup is removed from public checkout.
- Public Delivery Boy / Food Seller entry points are removed by the storefront scope guard.
- Non-Food checkout uses external delivery only and remains blocked until courier readiness is genuinely confirmed.
- Fixed the checkout role-cleanup selector so it does not accidentally remove the external-delivery option from the checkout select.
- Added indexes for the three previously unindexed courier foreign keys:
  - `courier_claims.external_shipment_id`
  - `courier_rate_quotes.external_shipment_id`
  - `external_shipments.selected_quote_id`
- Added GitHub Actions regression checks for the first-launch courier-only rules.

## Remaining launch blockers

1. Courier provider account/KYC, wallet balance, pickup locations, live API credentials, health check, rate quote, booking, AWB, pickup scan, tracking, cancellation, reverse/RTO and reconciliation tests.
2. Verified SMS/phone OTP delivery and confirmation that Supabase Auth phone verification is operational.
3. Live COD remittance workflow and refund/reconciliation test. UPI gateway remains unconfigured.
4. Seller onboarding, verified pickup address, package measurements, order packing, seller shipping-cost agreement and payout beneficiary verification.
5. At least one real seller and test product, followed by an end-to-end customer-to-courier test.
6. Enable Supabase leaked-password protection in Auth settings; it was reported disabled by the security advisor. This project connector did not expose an Auth-settings update action.
7. Complete browser/device testing of all customer, seller and private-admin screens.

## Advisor findings intentionally not changed

- RLS is enabled on private/internal tables with no direct client policy; these are intentionally inaccessible through direct client table access.
- Public catalog and courier-readiness RPCs are exposed intentionally; the catalog RPC is limited to public Non-Food data and the readiness RPC returns only readiness status.
- SECURITY DEFINER RPCs are used for controlled workflows and have role/ownership checks. A static scan found no `admin_*` function missing an obvious admin guard; each privileged function still requires deeper review before production.
- Remaining performance notices include RLS init-plan suggestions, multiple permissive policies, duplicate/unused indexes. Duplicate and unused indexes were not dropped because doing so without query-plan/usage review could harm live workflows.

## Deployment validation

- HTML validation, inline JavaScript syntax validation, and storefront HTML/JavaScript validation passed on the audit commit.
- GitHub Pages build completed successfully; deployment was still in progress at the time of this audit.
