-- Once, on a database made before key recovery (2026-10-10), after 0003:
--   npx wrangler d1 execute <database> --remote --file migrations/0004-recovery.sql
CREATE TABLE IF NOT EXISTS recoveries (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  sent_at INTEGER NOT NULL
);
