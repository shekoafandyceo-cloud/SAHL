-- wa_ofd_template_v2 (12 أكتوبر — قرار المالك بعد ما رسالة التجربة وصلت رقمه: «حول يا صاحبي الرسالة تمام مية مية»)
-- رسالة «المندوب في الطريق» من القالب الأول (5 متغيرات) للتاني order_out_for_delivery_v2_ar (7: + المنتج + المطلوب عند الاستلام).
--
-- 🔴 النص بيتنسخ من نسخة التجربة اللي اتبعتت للمالك ووصلت (platform_settings('wa_ofd_test').template.body) — مش مكتوب بالإيد
--    هنا ('…\n…' من غير E كان هيتخزن «\» + «n» حرفياً). والـmd5 لازم = OFD_BODY_V2 في _shared/wa-ofd.ts وإلا كل حاجة بترجع.
-- 🔴 نسخة احتياطية من صف القالب الأول قبل التبديل (wa_ofd_tpl_backup_v1) — بتتكتب **بس** لو الصف لسه على القالب الأول
--    (إعادة التشغيل بعد التبديل مابتكتبش v2 مكان الاحتياطي).
-- الحارس app.wa_auto_tpl_guard مابيلمسش enabled_since ولا paused_* طالما mode ماتغيّرش — mode = 'on' زي ما هو.
-- الرجوع (من الاحتياطي + مسح أي إيقاف — من غير لمس mode): شوف CLAUDE.md «القالب التاني».
do $m$
declare
  v_name text; v_bk_md5 text; v_new_md5 text; v_pc int;
begin
  select template_name into v_name from public.wa_auto_templates where event = 'out_for_delivery';
  if v_name is null then raise exception 'wa_ofd_template_v2: no out_for_delivery row'; end if;
  if v_name = 'order_out_for_delivery_v2_ar' then
    raise notice 'wa_ofd_template_v2: already on v2 — nothing to do';
    return;
  end if;
  if v_name <> 'order_out_for_delivery_ar' then
    raise exception 'wa_ofd_template_v2: unexpected template %', v_name;
  end if;

  insert into public.platform_settings (key, value, description)
  select 'wa_ofd_tpl_backup_v1',
         jsonb_build_object('template_name', template_name, 'body', body, 'param_count', param_count)::text,
         'نسخة القالب الأول لرسالة المندوب في الطريق قبل التحويل للقالب التاني (12 أكتوبر) — للرجوع'
  from public.wa_auto_templates where event = 'out_for_delivery'
  on conflict (key) do nothing;
  select md5((value::jsonb)->>'body') into v_bk_md5 from public.platform_settings where key = 'wa_ofd_tpl_backup_v1';
  if v_bk_md5 is distinct from '0a64878f83644f328cb676eb29cfbd54' then
    raise exception 'wa_ofd_template_v2: backup body md5 % <> v1', v_bk_md5;
  end if;

  update public.wa_auto_templates
     set template_name = 'order_out_for_delivery_v2_ar',
         body = (select (value::jsonb)->'template'->>'body' from public.platform_settings where key = 'wa_ofd_test'),
         param_count = 7
   where event = 'out_for_delivery'
  returning md5(body), param_count into v_new_md5, v_pc;
  if v_new_md5 is distinct from 'b4686f21b87987ca524367299253880a' or v_pc <> 7 then
    raise exception 'wa_ofd_template_v2: new body md5 % / params % <> OFD_BODY_V2', v_new_md5, v_pc;
  end if;
end
$m$;
