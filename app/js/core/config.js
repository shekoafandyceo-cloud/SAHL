// ثوابت الاتصال. الـanon key عام بطبيعته — الحماية من RLS مش من إخفاؤه

// ── SUPABASE CONFIG (hardcoded — anon key is safe to expose, RLS + Auth protect data) ──
export var SUPABASE_URL = 'https://gdphjfhelxaofugyiknb.supabase.co';

export var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdkcGhqZmhlbHhhb2Z1Z3lpa25iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNjk2MjQsImV4cCI6MjA5Mzc0NTYyNH0.RoMFhaj7zvIxKdds6mgQPv1lmT_rijNKc1lu--0sLQY';

// ============================================================
//  SETTINGS PAGE — profile, webhook, bosta, whatsapp, telegram
// ============================================================
export var WEBHOOK_BASE_URL = 'https://play.sheko.tech/webhook/orders?s=';
