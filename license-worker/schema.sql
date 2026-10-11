-- Licenses for the products in src/products.js. Apply to a new database with
--   npx wrangler d1 execute <database> --remote --file schema.sql
-- (safe to run again). A database made before root_id and installs existed
-- also needs the files in migrations/, in order, once each.

-- One row per key. Adding seats issues a new key in the same family (root_id,
-- the first key's id) covering the new total; the older keys keep working.
CREATE TABLE IF NOT EXISTS licenses (
  id TEXT PRIMARY KEY,                 -- lic_...: the key's id, what the plugin asks about
  product TEXT NOT NULL DEFAULT 'backseat-driver', -- what it licenses: a key of src/products.js
  root_id TEXT,                        -- the family: the first key's id (its own id for a first key)
  key TEXT NOT NULL,                   -- the whole key, as sent to the buyer
  licensee TEXT NOT NULL,              -- the key's "to": company or person
  email TEXT NOT NULL,                 -- where the key was sent
  seats INTEGER NOT NULL,              -- seats this key covers: the family's total when it was issued
  issued_at INTEGER NOT NULL,          -- epoch ms, the key's iat
  revoked_at INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,                -- 'stripe', or 'admin' for one issued by hand
  stripe_session TEXT UNIQUE,          -- Checkout Session that paid for it
  stripe_payment_intent TEXT,          -- what a refund points at
  amount_total INTEGER,                -- paid, in the currency's minor unit
  currency TEXT,
  emailed_at INTEGER NOT NULL DEFAULT 0,
  notified_at INTEGER NOT NULL DEFAULT 0,  -- when the owner was told of the sale
  over_since INTEGER NOT NULL DEFAULT 0,   -- first key of a family: since when its installs have clearly outnumbered its seats
  nudged_at INTEGER NOT NULL DEFAULT 0,    -- first key of a family: when its buyer was last emailed about seats
  email_error TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS licenses_email ON licenses (email);
CREATE INDEX IF NOT EXISTS licenses_email_nocase ON licenses (email COLLATE NOCASE);  -- recovery's lookup
CREATE INDEX IF NOT EXISTS licenses_payment_intent ON licenses (stripe_payment_intent);
CREATE INDEX IF NOT EXISTS licenses_root ON licenses (root_id);

-- Installs that checked a family's keys: a random id each plugin install makes,
-- nothing else about it. Counted over the last 14 days against the seats, to
-- nudge, never to block. last_seen is written at most once a day per install;
-- a family keeps at most max(50, 3 x seats).
CREATE TABLE IF NOT EXISTS installs (
  root_id TEXT NOT NULL,
  install TEXT NOT NULL,
  last_seen INTEGER NOT NULL,
  PRIMARY KEY (root_id, install)
);

-- Key recovery: when each address was last sent its keys and how many it has had
-- today (day, UTC), so one address gets at most one every 30 seconds and a few a
-- day, and all of them together a few dozen a day.
CREATE TABLE IF NOT EXISTS recoveries (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  sent_at INTEGER NOT NULL,
  day TEXT NOT NULL DEFAULT '',
  day_count INTEGER NOT NULL DEFAULT 0
);
