-- Once, on a database made before recovery had daily caps (2026-10-11), after 0004:
--   npx wrangler d1 execute <database> --remote --file migrations/0005-recovery-caps.sql
ALTER TABLE recoveries ADD COLUMN day TEXT NOT NULL DEFAULT '';
ALTER TABLE recoveries ADD COLUMN day_count INTEGER NOT NULL DEFAULT 0;
