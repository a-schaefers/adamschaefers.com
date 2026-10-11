-- Once, on a database made before licenses had a product (2026-10-10):
--   npx wrangler d1 execute <database> --remote --file migrations/0003-products.sql
ALTER TABLE licenses ADD COLUMN product TEXT NOT NULL DEFAULT 'backseat-driver';
