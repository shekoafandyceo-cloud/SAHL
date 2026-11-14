-- ai_agent_core — 14 نوفمبر 2026
-- المرحلة الأولى من الـ AI Agent (shadow mode): جداول جديدة + عمود nullable + دالة.
-- مفيش trigger هنا. مفيش FK عن قصد (نفس قاعدة wa_media_ids).

-- 1) إعدادات الـ Agent: صف لكل متجر، والوضع off لحد ما يتفتح بالإيد
create table if not exists public.ai_settings (
  tenant_id  uuid        primary key,
  mode       text        not null default 'off'
             check (mode in ('off','shadow','auto')),
  model      text,
  facts      jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 2) معلومات المنتجات
create table if not exists public.ai_products (
  id                uuid        primary key default gen_random_uuid(),
  tenant_id         uuid        not null,
  name              text        not null,
  aliases           text[]      not null default '{}',
  site_names        text[]      not null default '{}',
  quick_reply_id    uuid,
  stock_product_ids uuid[]      not null default '{}',
  assembled         boolean,
  facts             jsonb       not null default '{}'::jsonb,
  active            boolean     not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists ai_products_tenant_idx
  on public.ai_products (tenant_id) where active;

-- 3) الردود المقترحة
create table if not exists public.wa_ai_drafts (
  id                 uuid        primary key default gen_random_uuid(),
  tenant_id          uuid        not null,
  conversation_id    uuid        not null,
  trigger_message_id uuid        not null unique,
  intent             text,
  behavior           text        not null
                     check (behavior in ('answer','collect','order_lookup','clarify','escalate','skip')),
  body               text,
  media              jsonb,
  status             text        not null default 'pending'
                     check (status in ('pending','sent','edited','rejected','expired')),
  final_body         text,
  reviewed_by        uuid,
  reviewed_at        timestamptz,
  model              text,
  tokens_in          integer,
  tokens_out         integer,
  latency_ms         integer,
  error              text,
  created_at         timestamptz not null default now()
);
create index if not exists wa_ai_drafts_conv_idx
  on public.wa_ai_drafts (conversation_id, created_at desc);

-- 4) ربط الإعلان بالمنتج
alter table public.ctwa_ads add column if not exists ai_product_id uuid;

-- 5) RLS: القراية لأعضاء المتجر، والكتابة للـ service والدالة بس
alter table public.ai_settings  enable row level security;
alter table public.ai_products  enable row level security;
alter table public.wa_ai_drafts enable row level security;

revoke all on table public.ai_settings, public.ai_products, public.wa_ai_drafts
  from anon, authenticated;
grant select on table public.ai_settings, public.ai_products, public.wa_ai_drafts
  to authenticated;
grant insert, update, delete on table public.ai_products to authenticated;
grant select, insert, update, delete
  on table public.ai_settings, public.ai_products, public.wa_ai_drafts
  to service_role;

create policy ai_settings_select on public.ai_settings for select
  using (is_super_admin() or tenant_id = app.current_tenant_id());

create policy ai_products_select on public.ai_products for select
  using (is_super_admin() or tenant_id = app.current_tenant_id());
create policy ai_products_write on public.ai_products for all
  using (is_super_admin() or (app.is_admin() and tenant_id = app.current_tenant_id()))
  with check (is_super_admin() or (app.is_admin() and tenant_id = app.current_tenant_id()));

create policy wa_ai_drafts_select on public.wa_ai_drafts for select
  using (is_super_admin() or tenant_id = app.current_tenant_id());

-- 6) مراجعة الموظف للـ draft: الكتابة من الدالة دي بس
create or replace function public.wa_ai_draft_review(
  p_id uuid, p_status text, p_final_body text default null)
returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if p_status not in ('sent','edited','rejected') then
    raise exception 'bad status';
  end if;
  if not app.is_active_member() then
    raise exception 'not allowed';
  end if;
  update public.wa_ai_drafts d set
    status      = p_status,
    final_body  = p_final_body,
    reviewed_by = auth.uid(),
    reviewed_at = now()
  where d.id = p_id
    and d.tenant_id = app.current_tenant_id()
    and d.status = 'pending';
end$$;
revoke all on function public.wa_ai_draft_review(uuid, text, text) from public, anon;
grant execute on function public.wa_ai_draft_review(uuid, text, text) to authenticated;
