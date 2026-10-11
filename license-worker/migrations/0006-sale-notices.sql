-- Once, on a database made before sale notices (2026-10-11), after 0005:
--   npx wrangler d1 execute <database> --remote --file migrations/0006-sale-notices.sql
ALTER TABLE licenses ADD COLUMN notified_at INTEGER NOT NULL DEFAULT 0;
-- Sales made before this are known already: no notice for them.
UPDATE licenses SET notified_at = issued_at;
