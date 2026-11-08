-- v79 (16 أكتوبر): app.jt_set_cod مابقتش بتكتب على orders لما مبلغ J&T زي ما هو.
-- كانت بتعمل `update orders set jt_cod_synced_at = now()` على كل أوردر J&T مفتوح كل 15 دقيقة
-- (~61 أوردر × 96 دورة = ~5,800 UPDATE في اليوم — ~58% من كل تعديلات orders من أول أكتوبر).
-- كل UPDATE = حدث ريل-تايم على كل تاب مفتوحة (جلب الكروت والجدول) + إعادة رسم نافذة التفاصيل
-- المفتوحة لو الأوردر ده (ختم مش في RT_SCORE_COLS قبل v79 — كلام الموظف اللي مااتحفظش كان بيضيع).
-- دلوقتي الختم بيتكتب بس لو عمره ما اتختم أو الحالة اتغيّرت بعد آخر ختم — وده بالظبط شرط
-- app.jt_cod_candidates للأوردر النهائي، فالنهائي بيتختم مرة واحدة ويخرج زي الأول، والمفتوح
-- فاضل مرشّح زي ما هو (شرط الحالة المفتوحة مالوش علاقة بالختم).
-- ⚠️ ترتيب المرشّحين `order by jt_cod_synced_at nulls first` بقى مابيلفّش على المفتوح —
--    مالوش أثر طول ما المفتوح أقل من الـlimit (300 — النهارده 61).
-- اتجرّب بترانزاكشن راجعة على الحي: مفتوح + نفس المبلغ = صفر كتابة (synced_at وupdated_at زي ما هم) ·
-- مسلّم اتغيّرت حالته بعد الختم = اتختم مرة · تاني نداء = مفيش كتابة · المرشّحين: المفتوح فاضل والمسلّم خرج ·
-- طابور الشبكة 0.
create or replace function app.jt_set_cod(p_bill_code text, p_cod numeric)
 returns jsonb language plpgsql security definer set search_path to 'public', 'app'
as $function$
declare r orders; v_fee numeric;
begin
  if p_cod is null or p_cod < 0 then return jsonb_build_object('ok', false, 'note', 'bad_cod'); end if;
  select * into r from orders where tracking_no = p_bill_code and shipping_carrier = 'jt'
   order by created_at desc limit 1 for update;
  if not found then return jsonb_build_object('ok', false, 'note', 'order_not_found'); end if;
  if r.jt_cod_amount is not distinct from round(p_cod, 2) then
    if r.jt_cod_synced_at is null or r.jt_cod_synced_at < r.status_changed_at then
      update orders set jt_cod_synced_at = now() where id = r.id;
    end if;
    return jsonb_build_object('ok', true, 'note', case when round(p_cod,2) = r.total_cost then 'same' else 'same_mismatch' end, 'order_id', r.id);
  end if;
  if r.jt_fee_final and r.jt_freight is not null then
    v_fee := app.jt_cod_fee_for(r.status, p_cod);
    update orders set jt_cod_amount = round(p_cod, 2), jt_cod_synced_at = now(), jt_cod_fee = v_fee,
      real_shipping_fee = round(r.jt_freight + coalesce(v_fee, 0), 2)
     where id = r.id;
  else
    update orders set jt_cod_amount = round(p_cod, 2), jt_cod_synced_at = now() where id = r.id;
  end if;
  return jsonb_build_object('ok', true, 'order_id', r.id,
    'note', case when round(p_cod,2) = r.total_cost then 'set' else 'set_mismatch' end);
end $function$;
