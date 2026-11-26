-- Add covering indexes for courier foreign keys reported by Supabase performance advisors.
-- Additive only: no existing tables, rows, policies, or constraints are changed.
create index if not exists courier_claims_external_shipment_idx
  on public.courier_claims (external_shipment_id);

create index if not exists courier_rate_quotes_external_shipment_idx
  on public.courier_rate_quotes (external_shipment_id);

create index if not exists external_shipments_selected_quote_idx
  on public.external_shipments (selected_quote_id);
