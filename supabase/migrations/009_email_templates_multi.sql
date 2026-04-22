-- 009: multi-template email_templates
--
-- Turn email_templates from a single-row-per-locale config into a library of
-- named templates (monthly, former student, reminders, holiday greetings).
-- Existing rows are preserved; the current Yiddish row becomes the default
-- so send behaviour is unchanged until an operator picks a different one.

-- 1. Add new columns (id, name, is_default, sort_order) without dropping data.
--    The PK was (locale); we drop it and add a surrogate id PK.
ALTER TABLE email_templates
  ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS name VARCHAR(120),
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- Fill id/name for any existing rows.
UPDATE email_templates SET id = gen_random_uuid() WHERE id IS NULL;
UPDATE email_templates
   SET name = CASE locale
                WHEN 'yi' THEN 'תבנית ראשית'
                WHEN 'en' THEN 'English default'
                ELSE COALESCE(name, 'Template ' || locale)
              END
 WHERE name IS NULL;

-- Promote the Yiddish row (the one the code has actually been using) to
-- default. Safe to do even if someone had already set is_default elsewhere —
-- we null the others out first.
UPDATE email_templates SET is_default = FALSE;
UPDATE email_templates SET is_default = TRUE WHERE locale = 'yi';

-- If no row got is_default=true (fresh DB with no yi row — unlikely but
-- defensive), mark the first row by insertion order.
UPDATE email_templates
   SET is_default = TRUE
 WHERE id = (SELECT id FROM email_templates ORDER BY updated_at LIMIT 1)
   AND NOT EXISTS (SELECT 1 FROM email_templates WHERE is_default = TRUE);

-- 2. Swap the primary key: drop locale-PK, add id-PK.
--    locale is kept as a plain column (not unique) — still written by legacy
--    code but no longer constrains the table.
ALTER TABLE email_templates DROP CONSTRAINT IF EXISTS email_templates_pkey;
ALTER TABLE email_templates ALTER COLUMN id SET NOT NULL;
ALTER TABLE email_templates ADD PRIMARY KEY (id);
ALTER TABLE email_templates ALTER COLUMN name SET NOT NULL;

-- 3. Seed additional starter templates (idempotent — keyed by name).
INSERT INTO email_templates (name, locale, subject, body, is_default, sort_order)
SELECT 'חבר לשעבר - יתרה פתוחה',
       'yi',
       'יתרה פתוחה — {{hebrew_family_name}}',
       'חשובע משפחה {{hebrew_contact_name}},

מיר ווענדן זיך אײַך וועגן די אָפֿענע יתרה אין אײַער חשבון: {{balance}}, פון די תקופה פֿון לימודים.

צוגעבונדן דעם חשבון מיט די פֿולע פּרטים. מיר בעטן אײַך צו סדר די יתרה אין דער גיכסטער צײַט.

פֿאַר פֿראַגן אָדער קלערונגען, ביטע קאָנטאַקטירט אונדז.

אַ דאַנק,
{{org_name}}',
       FALSE,
       10
WHERE NOT EXISTS (SELECT 1 FROM email_templates WHERE name = 'חבר לשעבר - יתרה פתוחה');

INSERT INTO email_templates (name, locale, subject, body, is_default, sort_order)
SELECT 'תזכורת עדינה',
       'yi',
       'תזכורת — {{hebrew_family_name}}',
       'חשובע משפחה {{hebrew_contact_name}},

מיר ווילן אויפֿמערקזאַם מאַכן אײַך אויף די יתרה אין חשבון: {{balance}}.

אויב איר האָט שוין באצאָלט — ביטע איגנאָרירט דעם בריוו. אַנדערש, מיר וואָלטן עס זייער שעצן ווען איר וועט סדר דעם חוב אין דער נאָענטער צײַט.

אַ האַרציקן דאַנק,
{{org_name}}',
       FALSE,
       20
WHERE NOT EXISTS (SELECT 1 FROM email_templates WHERE name = 'תזכורת עדינה');

INSERT INTO email_templates (name, locale, subject, body, is_default, sort_order)
SELECT 'תזכורת שנייה',
       'yi',
       'תזכורת צווייטע — {{hebrew_family_name}}',
       'חשובע משפחה {{hebrew_contact_name}},

דאָס איז אַ צווייטע תזכורת וועגן די אָפֿענע יתרה: {{balance}}.

מיר בעטן אײַך צו סדר דעם חוב אין דער גיכסטער צײַט. צוגעבונדן דעם חשבון מיט די פֿולע פּרטים.

אויב איר האָט שוין באצאָלט, ביטע לאָזט אונדז וויסן כדי מיר זאָלן אַקטואַליזירן די רעקאָרדס.

מיט דרך ארץ,
{{org_name}}',
       FALSE,
       30
WHERE NOT EXISTS (SELECT 1 FROM email_templates WHERE name = 'תזכורת שנייה');

INSERT INTO email_templates (name, locale, subject, body, is_default, sort_order)
SELECT 'ברכת חג + חשבון',
       'yi',
       'ברכת חג — {{hebrew_family_name}}',
       'חשובע משפחה {{hebrew_contact_name}},

פֿאַר דעם נאָענטן חג, ווילן מיר ווינטשן אײַך און אײַער גאַנצער משפחה אַ פֿרייליכן, כשרן און אַ בריקטן חג.

צוגעבונדן דעם אַקטועלן חשבון — יתרה: {{balance}}.

אַ גוט יום טוב!
{{org_name}}',
       FALSE,
       40
WHERE NOT EXISTS (SELECT 1 FROM email_templates WHERE name = 'ברכת חג + חשבון');

INSERT INTO email_templates (name, locale, subject, body, is_default, sort_order)
SELECT 'סיכום סוף שנה',
       'yi',
       'סיכום יאָריק חשבון — {{hebrew_family_name}}',
       'חשובע משפחה {{hebrew_contact_name}},

צום סוף פֿונעם יאָר, צוגעבונדן די יערלעכע סיכום פֿון אײַער חשבון.

סך הכל חיובים: {{total_charged}}
סך הכל תשלומים: {{total_paid}}
יתרה לסוף יאָר: {{balance}}

מיר דאַנקן אײַך פֿאַר אײַער שותפֿות אויפֿן גאַנצן יאָר.

אַ גוטס יאָר,
{{org_name}}',
       FALSE,
       50
WHERE NOT EXISTS (SELECT 1 FROM email_templates WHERE name = 'סיכום סוף שנה');

-- 4. Enforce a single default via a partial unique index. Application code
--    also clears other defaults on write, but this makes it airtight.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_email_templates_default
  ON email_templates (is_default) WHERE is_default = TRUE;
