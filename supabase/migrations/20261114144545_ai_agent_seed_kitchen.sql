-- ai_agent_seed_kitchen — 14 نوفمبر 2026 (بيانات فقط — بموافقة المالك)
-- صفّين في ai_products (منظم المطبخ: الدور الواحد بمقاسيه · الدورين) + ربط 3 إعلانات + صف ai_settings (off).
-- مفيش DDL ومفيش trigger. الـAgent بيفضل off.
with p1 as (
  insert into public.ai_products
    (tenant_id, name, aliases, site_names, quick_reply_id, stock_product_ids, assembled, facts)
  values (
    '9c58b214-f11d-4de5-afc7-a0de0b903f36',
    'منظم المطبخ المتكامل (دور واحد)',
    array['المطبقية','مطبقية الحوض','منظم الأطباق','منظم الحوض'],
    array['منظم المطبخ المتكامل','منظم المطبخ المتكامل مقاس ٦٥'],
    'c53c52a4-399d-4af9-8d45-4b793f14e6fd',
    array['913c4806-b745-4be9-a24e-b7a35adaf94e',
          'd7052d99-390f-4eaa-b3e4-475ca9f730c1']::uuid[],
    false,
    '{"variants":[{"label":"مقاس 85","site_name":"منظم المطبخ المتكامل","stock_product_id":"913c4806-b745-4be9-a24e-b7a35adaf94e","card_price":1499,"width_cm":85,"height_cm":80,"depth_cm":30},{"label":"مقاس 65","site_name":"منظم المطبخ المتكامل مقاس ٦٥","stock_product_id":"d7052d99-390f-4eaa-b3e4-475ca9f730c1","card_price":1399,"width_cm":65,"height_cm":70,"depth_cm":30}],"material":"حديد مجلفن ضد الصدأ 100%","colors":["أسود"],"weight_kg":5.5,"placement":"بيتحط على الرخامة أو الحوض، ومش بيتعلق على الحيطة","origin":"مستورد","assembly":"بييجي مفكك في كرتونته ومعاه كتالوج. مفيش فيديو تركيب. المندوب مش بيركّب."}'::jsonb)
  returning id
),
p2 as (
  insert into public.ai_products
    (tenant_id, name, aliases, site_names, quick_reply_id, stock_product_ids, assembled, facts)
  values (
    '9c58b214-f11d-4de5-afc7-a0de0b903f36',
    'منظم المطبخ المتكامل دورين',
    array['المطبقية دورين','منظم المطبخ دورين','أبو دورين'],
    array['منظم المطبخ المتكامل دورين'],
    'b926f1d1-a008-42f4-a305-f6e7e11ff979',
    array['3ebbb33c-78d1-4268-a96f-1e4e1a29274b']::uuid[],
    false,
    '{"variants":[{"label":"مقاس 85","site_name":"منظم المطبخ المتكامل دورين","stock_product_id":"3ebbb33c-78d1-4268-a96f-1e4e1a29274b","card_price":1850,"width_cm":85,"height_cm":93,"depth_cm":30}],"material":"حديد مجلفن ضد الصدأ 100%","colors":["أسود"],"weight_kg":6.4,"front":"واجهة شفافة أكريليك، مش زجاج","placement":"بيتحط على الرخامة أو الحوض، ومش بيتعلق على الحيطة","origin":"مستورد","assembly":"بييجي مفكك في كرتونته ومعاه كتالوج. مفيش فيديو تركيب. المندوب مش بيركّب."}'::jsonb)
  returning id
),
ads as (
  insert into public.ctwa_ads (tenant_id, ad_id, ad_name, ai_product_id)
  select '9c58b214-f11d-4de5-afc7-a0de0b903f36'::uuid, v.ad_id, v.ad_name, v.pid
  from (
    select '120251466081540034' as ad_id,
           'KitchenOrganizer Broad 19 Aug - Copy' as ad_name, (select id from p1) as pid
    union all
    select '120251940751100034', 'KitchenOrganizer2Door2', (select id from p2)
    union all
    select '120251940837710034', 'Kitchen2Door', (select id from p2)
  ) v
  on conflict (tenant_id, ad_id) do update set ai_product_id = excluded.ai_product_id
  returning ad_id
)
insert into public.ai_settings (tenant_id, mode, facts)
values (
  '9c58b214-f11d-4de5-afc7-a0de0b903f36',
  'off',
  '{"delivery":"من 24 إلى 48 ساعة إن شاء الله","shipping":"مجاني لكل المحافظات ما عدا شمال سيناء","payment":"الدفع عند الاستلام، وإنستا باي مع المندوب. الفيزا على الموقع بس","discount_code":{"code":"cash5","percent":5},"pickup":{"address":"مدينة السلام - أطلس 3 - خلف مستشفى السلام - بلوك 102","hours":"من السبت للخميس، من 12 الضهر لـ 6 مساءً"},"deposit":"ما يتطلبش","wholesale":"تصعيد فوري من غير أي سعر","policy_url":"https://www.3ataba.com/pages/refund-policy"}'::jsonb)
on conflict (tenant_id) do nothing;
