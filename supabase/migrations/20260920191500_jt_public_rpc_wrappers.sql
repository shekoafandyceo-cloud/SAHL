-- أغلفة public للدوال في app — PostgREST بيكشف public بس؛ service_role وحده بينفّذها
create or replace function public.jt_record_shipment_v1(p_order_id uuid, p_bill_code text, p_sorting_code text, p_fee_estimated numeric, p_weight numeric, p_by text default 'J&T API')
returns jsonb language sql security definer set search_path = public, app
as $$ select app.jt_record_shipment(p_order_id, p_bill_code, p_sorting_code, p_fee_estimated, p_weight, p_by); $$;
revoke all on function public.jt_record_shipment_v1(uuid,text,text,numeric,numeric,text) from public, anon, authenticated;
grant execute on function public.jt_record_shipment_v1(uuid,text,text,numeric,numeric,text) to service_role;

create or replace function public.jt_apply_trace_v1(p_bill_code text, p_scan_type text, p_scan_code text, p_scan_at timestamptz, p_desc text)
returns jsonb language sql security definer set search_path = public, app
as $$ select app.jt_apply_trace(p_bill_code, p_scan_type, p_scan_code, p_scan_at, p_desc); $$;
revoke all on function public.jt_apply_trace_v1(text,text,text,timestamptz,text) from public, anon, authenticated;
grant execute on function public.jt_apply_trace_v1(text,text,text,timestamptz,text) to service_role;

create or replace function public.jt_apply_settlement_v1(p_bill_code text, p_total_freight numeric, p_charge_weight numeric)
returns jsonb language sql security definer set search_path = public, app
as $$ select app.jt_apply_settlement(p_bill_code, p_total_freight, p_charge_weight); $$;
revoke all on function public.jt_apply_settlement_v1(text,numeric,numeric) from public, anon, authenticated;
grant execute on function public.jt_apply_settlement_v1(text,numeric,numeric) to service_role;
