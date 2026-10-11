-- Once, on a database made before recovery's case-insensitive index (2026-10-11), after 0006:
--   npx wrangler d1 execute <database> --remote --file migrations/0007-email-nocase.sql
CREATE INDEX IF NOT EXISTS licenses_email_nocase ON licenses (email COLLATE NOCASE);
