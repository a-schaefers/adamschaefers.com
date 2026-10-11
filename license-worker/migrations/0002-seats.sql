-- Once, on a database made before families and installs (2026-10-10), before 0003:
--   npx wrangler d1 execute <database> --remote --file migrations/0002-seats.sql
ALTER TABLE licenses ADD COLUMN root_id TEXT;
UPDATE licenses SET root_id = id WHERE root_id IS NULL;
CREATE INDEX IF NOT EXISTS licenses_root ON licenses (root_id);
CREATE TABLE IF NOT EXISTS installs (
  root_id TEXT NOT NULL,
  install TEXT NOT NULL,
  last_seen INTEGER NOT NULL,
  PRIMARY KEY (root_id, install)
);
