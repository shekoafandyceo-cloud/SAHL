-- 4 نوفمبر (المراجعة العدائية على jt_set_cod_batch): `lock_timeout = 1s` على مستوى الدالة.
--
-- 🔴 السبب: `app.jt_set_cod` بتعمل `for update` على صف الأوردر. الـRPC كله ماشي تحت `statement_timeout`
-- بتاع `authenticator` (8 ثواني — اتقاس على الحي). لو صف واحد في الدفعة مقفول عند حد تاني ≥ 8ث، الـstatement
-- كله بيتلغي بـ`query_canceled` (57014) — و`exception when others` في plpgsql **مابيمسكش** 57014، فالـ≤20 عنصر
-- كلهم بيترجعوا (قبل الدفعة كان العنصر ده لوحده اللي بيقع).
-- بـ`lock_timeout = 1s` انتظار القفل بيقع بـ`lock_not_available` (55P03) وده **بيتمسك** جوّه العنصر = `error`
-- للعنصر ده بس، والباقي بيكمّل. العنصر اللي وقع `jt_cod_synced_at` بتاعه ماتغيّرش = مرشّح في الدورة الجاية (15 دقيقة).
-- (الإعداد بيطبّق على كل حاجة جوّه الدالة — ومنها `app.jt_set_cod` — وبيرجع زي ما كان بعدها.)
alter function app.jt_set_cod_batch(jsonb) set lock_timeout = '1s';
