-- Once, on a database made before seat emails (2026-10-11), after 0007:
--   npx wrangler d1 execute <database> --remote --file migrations/0008-seat-emails.sql
ALTER TABLE licenses ADD COLUMN over_since INTEGER NOT NULL DEFAULT 0;
ALTER TABLE licenses ADD COLUMN nudged_at INTEGER NOT NULL DEFAULT 0;
