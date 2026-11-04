-- 4 نوفمبر (المراجعة العدائية التانية على jt_set_cod_batch): نفس الدالة بالحرف + 3 حاجات — والإعدادات **جوّه**
-- الـCREATE نفسه (مش ALTER لوحده: أي `create or replace` جاي من ملف الجسم كان هيمسح الـALTER في صمت — الـCREATE بيحدد
-- كل الـproconfig من جديد · المراجعة).
--
-- 1) `lock_timeout = 300ms` (كان 1s): الأقفال اللي اتاخدت في subtransaction نجحت بتفضل لحد آخر الترانزاكشن، فانتظار
--    كل عنصر مقفول بيتجمّع — 8 عناصر × 1s = 8s = `statement_timeout` بتاع authenticator (57014 مابيتمسكش = الدفعة كلها
--    بترجع). 20 × 0.3s = 6s < 8s.
-- 2) السقف 20 عنصر (كان 100) — `jt-lookup` بيبعت ≤ 20 أصلاً (دفعة getOrders)، والسقف هو اللي بيضمن الحساب اللي فوق.
-- 3) ميزانية وقت 5 ثواني: بعدها العناصر الباقية بتتعدّ `skipped` من غير ما تتلمس (`jt_cod_synced_at` ماتغيّرش = مرشّحة
--    في الدورة الجاية بعد 15 دقيقة) — حزام تاني لو الـ300ms ماكفتش لأي سبب.

create or replace function app.jt_set_cod_batch(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'app'
set lock_timeout to '300ms'
as $function$
declare
  it jsonb; v_bc text; v_cod numeric; r jsonb; v_note text;
  v_tally jsonb := '{}'::jsonb; v_n int := 0; v_err text := null;
  v_t0 timestamptz := clock_timestamp();
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    return jsonb_build_object('ok', false, 'note', 'bad_items');
  end if;
  if jsonb_array_length(p_items) > 20 then
    return jsonb_build_object('ok', false, 'note', 'too_many');
  end if;
  for it in select value from jsonb_array_elements(p_items) loop
    v_n := v_n + 1;
    if clock_timestamp() - v_t0 > interval '5 seconds' then
      v_note := 'skipped';
    else
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
    end if;
    v_tally := jsonb_set(v_tally, array[v_note], to_jsonb(coalesce((v_tally->>v_note)::int, 0) + 1));
  end loop;
  return jsonb_build_object('ok', true, 'n', v_n, 'tally', v_tally) || case when v_err is null then '{}'::jsonb else jsonb_build_object('first_error', v_err) end;
end $function$;

revoke all on function app.jt_set_cod_batch(jsonb) from public;
