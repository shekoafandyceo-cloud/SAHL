-- التقاط بيانات إعلانات Click-to-WhatsApp (CTWA) الجاية في الـ webhook
-- الرسالة الجاية من إعلان بتحمل object اسمه referral جنب نص الرسالة.
-- بنخزّنه خام على الرسالة (مرونة لو Meta ضافت حقول) + مسطّح على المحادثة
-- للعرض السريع ولإرسال Conversions API لاحقاً بالـ ctwa_clid.

ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS referral jsonb;

ALTER TABLE wa_conversations ADD COLUMN IF NOT EXISTS ctwa_clid        text;
ALTER TABLE wa_conversations ADD COLUMN IF NOT EXISTS ctwa_ad_id       text;
ALTER TABLE wa_conversations ADD COLUMN IF NOT EXISTS ctwa_headline    text;
ALTER TABLE wa_conversations ADD COLUMN IF NOT EXISTS ctwa_source_type text;
ALTER TABLE wa_conversations ADD COLUMN IF NOT EXISTS ctwa_first_at    timestamptz;
ALTER TABLE wa_conversations ADD COLUMN IF NOT EXISTS ctwa_last_at     timestamptz;

COMMENT ON COLUMN wa_messages.referral IS
  'referral object الخام من webhook واتساب — بيتملى بس للرسايل الجاية من إعلان CTWA';
COMMENT ON COLUMN wa_conversations.ctwa_clid IS
  'آخر ctwa_clid — لازم لإرسال Conversions API بـ action_source=business_messaging';
COMMENT ON COLUMN wa_conversations.ctwa_ad_id IS
  'referral.source_id = معرّف الإعلان اللي جه منه العميل';
COMMENT ON COLUMN wa_conversations.ctwa_first_at IS
  'أول مرة العميل كلّمنا من إعلان (بتتكتب مرة واحدة)';

-- للتحليل: كام محادثة جات من كل إعلان
CREATE INDEX IF NOT EXISTS idx_wa_conv_ctwa_ad
  ON wa_conversations (tenant_id, ctwa_ad_id)
  WHERE ctwa_ad_id IS NOT NULL;
