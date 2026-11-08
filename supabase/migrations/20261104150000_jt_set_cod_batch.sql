-- 4 نوفمبر: `jt_set_cod` بالدفعة — نداء واحد لكل دفعة getOrders (≤20) بدل نداء لكل أوردر.
--
-- 🔴 السبب: `Log Ingestion` عدّت حصة الـFree Plan (105% — 1.05 من 1 GB). اتقاس 3 نوفمبر على
-- edge_logs: 42,214 Request على الـAPI في اليوم — منهم **12,290 (29%) `jt_set_cod_v1`**: الـtrace_sync
-- (كل 15 دقيقة) بيسأل J&T عن ~128 أوردر مفتوح وبيضرب RPC لكل واحد حتى لو المبلغ زي ما هو.
-- الدفعة = نفس `app.jt_set_cod` بالحرف لكل عنصر (مفيش منطق جديد) جوّه ترانزاكشن واحدة:
--   · كل عنصر في subtransaction لوحده — عنصر وقع مابيوقّعش الباقي (نفس سلوك النداءات المنفصلة).
--   · قيمة مش رقم / NaN / Infinity / فوق 10 مليون = `no_value` من غير ما نلمس الأوردر
--     (`app.jt_set_cod` بتشيك `< 0` بس، و'NaN' في Postgres أكبر من أي رقم فكانت هتعدّي).
--   · الرد = عدّاد بالـnote (same · set · set_mismatch · order_not_found · bad_cod · no_value · error)
--     + أول رسالة خطأ لو فيه — نفس `codTally` اللي الـEF بيسجّله في jt_sync_runs.
-- ⚠️ الأقفال: `app.jt_set_cod` بتعمل `for update` على صف الأوردر، ودلوقتي القفل بيفضل لحد آخر عنصر في
-- الدفعة (≤20 صف · أجزاء من الثانية) بدل ما يتفك بعد كل نداء. السقف 100 عنصر.
-- `jt_set_cod_v1` فاضلة زي ما هي (jt-ship بيناديها بعد الاسترجاع).

create or replace function app.jt_set_cod_batch(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'app'
as $function$
declare
  it jsonb; v_bc text; v_cod numeric; r jsonb; v_note text;
  v_tally jsonb := '{}'::jsonb; v_n int := 0; v_err text := null;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    return jsonb_build_object('ok', false, 'note', 'bad_items');
  end if;
  if jsonb_array_length(p_items) > 100 then
    return jsonb_build_object('ok', false, 'note', 'too_many');
  end if;
  for it in select value from jsonb_array_elements(p_items) loop
    v_n := v_n + 1;
    begin
      v_bc := nullif(btrim(coalesce(it->>'bill_code', '')), '');
      v_cod := case when jsonb_typeof(it->'cod') = 'number' then (it->>'cod')::numeric end;
      if v_bc is null or v_cod is null or v_cod = 'NaN'::numeric or v_cod > 10000000 then
        v_note := 'no_value';
      else
        r := app.jt_set_cod(v_bc, v_cod);
        v_note := coalesce(r->>'note', '?');
      end if;
    exception when others then
      v_note := 'error';
      if v_err is null then v_err := left(sqlerrm, 200); end if;
    end;
    v_tally := jsonb_set(v_tally, array[v_note], to_jsonb(coalesce((v_tally->>v_note)::int, 0) + 1));
  end loop;
  return jsonb_build_object('ok', true, 'n', v_n, 'tally', v_tally) || case when v_err is null then '{}'::jsonb else jsonb_build_object('first_error', v_err) end;
end $function$;

revoke all on function app.jt_set_cod_batch(jsonb) from public;

create or replace function public.jt_set_cod_batch_v1(p_items jsonb)
returns jsonb
language sql
security definer
set search_path to 'public', 'app'
as $function$
  select app.jt_set_cod_batch(p_items);
$function$;

revoke all on function public.jt_set_cod_batch_v1(jsonb) from public;
revoke all on function public.jt_set_cod_batch_v1(jsonb) from anon, authenticated;
grant execute on function public.jt_set_cod_batch_v1(jsonb) to service_role;
