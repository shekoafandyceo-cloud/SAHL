# سهل (Sahl)

لوحة تشغيل متجر 3ataba (أوردرات COD · واتساب · شحن J&T · مخزن) — خاصة بمتجر واحد، مش منتج SaaS.

> **المرجع الوحيد للحقيقة: [`CLAUDE.md`](./CLAUDE.md)** — اقراه كله قبل أي شغل.
> `AGENTS.md` متولّد منه (`python3 tools/make-agents-md.py`) — متعدّلوش بإيدك.

| المسار | الوصف |
|---|---|
| `app/` | لوحة التاجر → Cloudflare Worker (Static Assets) — الفولدر بيترفع كله |
| `admin/` | لوحة السوبر أدمن (مشروع منفصل) |
| `supabase/` | مرآة للـEdge Functions والـmigrations — الحقيقة على Supabase |
| `tools/` | الفحص والهارنسات والمعاينة — مش بيتنشر |

قبل أي نشر: `bash check.sh`. ترتيب ملفات `app/css/` وترتيب السكربتات في `index.html` عقد — التفاصيل في `CLAUDE.md`.
