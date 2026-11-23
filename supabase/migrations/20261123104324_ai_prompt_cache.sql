-- كاش Gemini الصريح للـAI Agent (23 نوفمبر — البند 5 من 5: طلب المالك «تصليح الكاش»)
-- سجل لكل كاش (cachedContents عند Gemini) لكل متجر + دالة حجز ذرية: مسودة واحدة بس هي اللي بتعمل الكاش في المرة،
-- والباقي بيمشي من غير كاش لحد ما يجهز. الكتابة من wa-ai-draft (service_role) بس — المتصفح مالوش أي صلاحية.
-- ⚠️ مالوش أي أثر لحد ما facts.prompt_layout = 'v4' (الحي v3). الرجوع = prompt_layout يرجع 'v3' — الجدول والدالة بيفضلوا من غير استخدام.
-- 🔴 حد «فاضل أقل من دقيقتين = مايتستخدمش» = CACHE_MIN_LEFT_MS في _shared/ai-cache.ts — لازم يفضلوا متطابقين.
-- اتجرّب بترانزاكشن راجعة الأول (T1–T12): create · creating · ready بالاسم · قرب يخلص = create والصف اتصفّر · failed · failed قديم = create ·
-- creating واقف = create · دخل غلط · التنضيف · القيود · الصلاحيات (service_role بس · RLS) · الشبكة 0.
-- اتطبّق 23 نوفمبر 10:43 UTC (12:43 القاهرة) بـapply_migration — الحي: ACL الجدول والدالة = postgres + service_role بس · RLS من غير سياسات ·
-- الدالة INVOKER و search_path فاضي · md5(prosrc) = 3d372da20d0079b0f2a853f2f302529a.

CREATE TABLE IF NOT EXISTS public.ai_prompt_cache (
  tenant_id uuid NOT NULL,
  cache_key text NOT NULL,
  model text NOT NULL,
  status text NOT NULL,
  name text,
  tokens integer,
  expire_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_prompt_cache_pkey PRIMARY KEY (tenant_id, cache_key),
  CONSTRAINT ai_prompt_cache_key_hex CHECK (cache_key ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ai_prompt_cache_status_chk CHECK (status IN ('creating', 'ready', 'failed')),
  CONSTRAINT ai_prompt_cache_name_chk CHECK (name IS NULL OR name ~ '^cachedContents/[A-Za-z0-9_-]{1,200}$'),
  CONSTRAINT ai_prompt_cache_ready_chk CHECK (status <> 'ready' OR (name IS NOT NULL AND expire_at IS NOT NULL)),
  CONSTRAINT ai_prompt_cache_model_len CHECK (char_length(model) BETWEEN 1 AND 80),
  CONSTRAINT ai_prompt_cache_error_len CHECK (error IS NULL OR char_length(error) <= 300),
  CONSTRAINT ai_prompt_cache_tokens_chk CHECK (tokens IS NULL OR tokens > 0)
);
COMMENT ON TABLE public.ai_prompt_cache IS 'كاش Gemini الصريح للـAI Agent (التعليمات + بيانات المتجر الثابتة) — سجل الحالة والاسم وإمتى بيخلص. الكتابة من wa-ai-draft بس.';
ALTER TABLE public.ai_prompt_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_prompt_cache FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_prompt_cache TO service_role;

-- الحجز: create = المسودة دي اللي تعمل الكاش · ready = موجود (الاسم وإمتى بيخلص) · creating = حد تاني بيعمله (أقل من 90 ثانية) ·
-- failed = وقع من أقل من 10 دقايق. creating أقدم من 90 ثانية أو failed أقدم من 10 دقايق أو ready فاضل فيه أقل من دقيقتين = حجز جديد.
-- كل نداء بيمسح صفوف المتجر الأقدم من يومين (الكاش عند Gemini بيعيش 30 دقيقة وبيتمد مع الاستخدام).
CREATE OR REPLACE FUNCTION public.ai_prompt_cache_claim(p_tenant uuid, p_key text, p_model text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $fn$
DECLARE
  r public.ai_prompt_cache%ROWTYPE;
  v_claimed boolean;
BEGIN
  IF p_tenant IS NULL OR p_key IS NULL OR p_key !~ '^[0-9a-f]{64}$' OR coalesce(char_length(p_model), 0) NOT BETWEEN 1 AND 80 THEN
    RETURN jsonb_build_object('state', 'bad_args');
  END IF;
  DELETE FROM public.ai_prompt_cache WHERE tenant_id = p_tenant AND updated_at < now() - interval '2 days';
  INSERT INTO public.ai_prompt_cache AS c (tenant_id, cache_key, model, status, updated_at)
  VALUES (p_tenant, p_key, p_model, 'creating', now())
  ON CONFLICT (tenant_id, cache_key) DO UPDATE
    SET status = 'creating', name = NULL, tokens = NULL, expire_at = NULL, error = NULL, model = excluded.model, updated_at = now()
    WHERE NOT (c.status = 'ready' AND c.expire_at > now() + interval '2 minutes')
      AND NOT (c.status = 'creating' AND c.updated_at > now() - interval '90 seconds')
      AND NOT (c.status = 'failed' AND c.updated_at > now() - interval '10 minutes')
  RETURNING true INTO v_claimed;
  IF coalesce(v_claimed, false) THEN
    RETURN jsonb_build_object('state', 'create');
  END IF;
  SELECT * INTO r FROM public.ai_prompt_cache WHERE tenant_id = p_tenant AND cache_key = p_key;
  IF NOT FOUND THEN RETURN jsonb_build_object('state', 'missing'); END IF;
  IF r.status = 'ready' THEN
    RETURN jsonb_build_object('state', 'ready', 'name', r.name, 'expire_at', r.expire_at, 'tokens', r.tokens);
  END IF;
  RETURN jsonb_build_object('state', r.status);
END;
$fn$;
REVOKE ALL ON FUNCTION public.ai_prompt_cache_claim(uuid, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_prompt_cache_claim(uuid, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
