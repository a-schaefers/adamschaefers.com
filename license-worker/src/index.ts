/* Licenses for the products in src/products.ts (Backseat Driver first): sells
   them through Stripe Checkout, signs and emails the keys, keeps them in D1 and
   answers the apps' checks.

   For adamschaefers.com (CORS: SITE_ORIGINS):
     POST /v1/checkout              { product, seats } -> { url } of a Stripe Checkout page;
                                    { seats, key }: that many more seats on the key's license
     GET  /v1/checkout/<session>    the key bought in that Checkout, once paid; 410 a week on
     POST /v1/lookup                { key } -> its licensee, seats and installs, to add seats
     POST /v1/recover               { email } -> emails that address every key on file for it
   From Stripe (signed with STRIPE_WEBHOOK_SECRET):
     POST /v1/stripe/webhook        a paid Checkout issues and emails the key and tells the owner
                                    (ADMIN_EMAIL) of the sale; a full refund or a
                                    lost chargeback revokes it; a paid Checkout with no key emails the owner
   For the apps (any origin), each product's under /v1/products/<product>:
     GET  .../keys/<id>[?install=]  { status: "active" | "revoked" | "unknown", seats, installs, outgrown };
                                    install is the app's anonymous id, counted for seats; another
                                    product's license is unknown
     GET  .../public-keys           the public keys that check the product's signatures (each
                                    product signs with its own key: src/products.ts)
     GET  /v1/keys/<id>, /v1/public-keys
                                    the same for Backseat Driver (FIRST_PRODUCT), whose shipped
                                    copies ask there; they never answer for another product
     POST /v1/verify                { key } -> its signature check and status, any product
   For the owner, behind Cloudflare Access (src/access.ts):
     GET  /admin                    every license, searchable; revoke, restore, resend, issue by hand
     /admin/api/...                 what that page calls

   Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SIGNING_KEY, RESEND_API_KEY, TURNSTILE_SECRET.
   Recovery, which sends email, needs a Turnstile token ({ turnstile }) from the store's widget.
   Buying and adding seats don't: they only make a Stripe Checkout page, which has its own
   CAPTCHA and card-testing defenses, and every site route is rate-limited per IP (LIMIT,
   and the zone's rule). Adding seats also needs a signed key.
   Everything else is in wrangler.jsonc (PRICES: each product's two Stripe prices).
   Licenses are lifetime, one key per purchase covering every seat bought, the
   volume price for every seat once a license reaches the product's volumeSeats
   (Backseat Driver: $99 a seat, $74.25 from 10).
   Adding seats issues a new key for the new total in the same family (root_id); the
   older keys keep working. A family is the license: it stands while any of its keys
   does (so refunding only an add-on never withdraws the seats paid before it), has the
   seats of its biggest unrevoked key, and counts the installs that checked any of its
   keys in the last 14 days. Installs can't tell people from machines, so nothing is
   said until a family's installs clearly outnumber its seats for two weeks running
   (seatsCheck). Then, on the honor system, the apps using it show a small note asking
   for more seats (outgrown: true) until there are enough, and its latest buyer gets one
   polite email, at most every 90 days. Nothing is ever locked. */

import { checkKey, loadSigningKey, newLicenseId, signKey } from './keys.ts';
import type { KeyCheck, PublicKey, SigningKey } from './keys.ts';
import { stripe, webhookEvent } from './stripe.ts';
import { mayEmail, recoveryEmail, saleEmail, seatsEmail, sendEmail, sendKeyEmail } from './email.ts';
import { adminEmail } from './access.ts';
import { ADMIN_PAGE } from './admin.ts';
import { FIRST_PRODUCT, PRODUCTS, productByPrefix, productOf } from './products.ts';
import type { ProductWithId } from './products.ts';

// wrangler.jsonc's bindings and vars, and the secrets (wrangler secret put). Each product's
// signing secret, kid and retired keys are the vars its `signing` names (src/products.ts):
// SIGNING_KEY, SIGNING_KID and OLD_PUBLIC_KEYS for Backseat Driver.
export interface Env {
  DB: D1Database;
  LIMIT?: RateLimit;
  SITE_ORIGINS: string;
  PRICES?: Record<string, { seat?: string; volume?: string }>;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_DASHBOARD?: string;
  RESEND_API_KEY: string;
  FROM_EMAIL: string;
  EMAIL_ONLY_TO?: string;
  TURNSTILE_SECRET?: string;
  TURNSTILE_HOSTNAMES?: string;
  ACCESS_TEAM?: string;
  ACCESS_AUD?: string;
  ADMIN_EMAIL?: string;
  MODE?: string;
  [signing: string]: unknown;
}

// A row of the licenses table (schema.sql): one key.
export interface License {
  id: string;
  product: string;
  root_id: string;
  key: string;
  licensee: string;
  email: string;
  seats: number;
  issued_at: number;
  revoked_at: number;
  source: 'stripe' | 'admin';
  stripe_session: string | null;
  stripe_payment_intent: string | null;
  amount_total: number | null;
  currency: string | null;
  emailed_at: number;
  notified_at: number;
  over_since: number;
  nudged_at: number;
  email_error: string;
  note: string;
}

// A license's family (family()), a pasted key (knownKey()), what a paid Checkout became
// (fulfil()).
interface Family { root: string; seats: number; installs: number; live: boolean }
type Known =
  | { license: License; product: ProductWithId; error?: undefined; status?: undefined }
  | { error: string; status: number; license?: undefined; product?: undefined };
type Fulfilled =
  | { license: License; pending?: undefined; error?: undefined }
  | { pending: true; license?: undefined; error?: undefined }
  | { error: string; license?: undefined; pending?: undefined };

// What this Worker reads of a Stripe Checkout Session (from the webhook, or asked of Stripe).
interface CheckoutSession {
  id: string;
  mode: string;
  payment_status: string;
  metadata?: { product?: string; seats?: string; add_to?: string };
  customer_details?: { email?: string; name?: string } | null;
  custom_fields?: { key: string; text?: { value?: string } }[];
  payment_intent?: string | { id: string } | null;
  amount_total?: number | null;
  currency?: string | null;
}

const MAX_SEATS = 1000;
const INSTALL_WINDOW = 14 * 24 * 3600_000;
const DAY = 24 * 3600_000;
const RECOVERY_GAP = 30_000;
// The thank-you page shows a key this long after it was issued. Its address (the Checkout's id)
// lives on in the buyer's browser history; after this, the key is in their email and recovery.
const KEY_SHOWN_FOR = 7 * DAY;
// Recovery emails a day: per address, and in all, which leaves most of Resend's free
// 100 a day for key emails.
const RECOVERY_PER_ADDRESS = 5;
const RECOVERY_PER_DAY = 40;
// Distinct installs kept per license, so one leaked key can't flood the table (and the
// account's daily D1 writes): plenty above any honest count.
const installCap = (seats: number) => Math.max(50, seats * 3);
// Outgrown, the apps' note and the seats email: only when installs are more than twice the
// seats and at least 5 over (one person on a laptop, a desktop and WSL is three installs),
// for 14 days running; the email at most every 90 days.
const clearlyOver = (seats: number, installs: number) => installs > 2 * seats && installs - seats >= 5;
const OVER_FOR = 14 * DAY;
const NUDGE_EVERY = 90 * DAY;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** decodeURIComponent, or null for a malformed % sequence. */
function decoded(text: string) {
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
}

// ---- Responses

function siteCors(request: Request, env: Env) {
  const origins = String(env.SITE_ORIGINS || '').split(',').map((o) => o.trim());
  const origin = request.headers.get('Origin');
  return {
    'Access-Control-Allow-Origin': origins.includes(origin!) ? origin! : origins[0],
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

const ANY_ORIGIN = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}

// ---- Licenses

const signingCache = new Map<string, { pem: string; kid: string; key: SigningKey }>();

/** A product's own signing key (its `signing` secret and kid; src/products.ts), never another product's. */
async function signing(env: Env, product: ProductWithId) {
  const pem = env[product.signing.secret] as string | undefined;
  const kid = env[product.signing.kid] as string | undefined;
  if (!pem || !kid) throw new Error(`${product.id} has no signing key: set ${product.signing.secret} and ${product.signing.kid}`);
  // Another product's key (or kid) here would let its keys pass as this product's.
  for (const [id, other] of Object.entries(PRODUCTS)) {
    if (id !== product.id && (env[other.signing.secret] === pem || env[other.signing.kid] === kid)) {
      throw new Error(`${product.id} and ${id} share a signing key or kid; each product needs its own`);
    }
  }
  const cached = signingCache.get(product.id);
  if (cached?.pem === pem && cached.kid === kid) return cached.key;
  const key = await loadSigningKey(kid, pem);
  signingCache.set(product.id, { pem, kid, key });
  return key;
}

const byId = (env: Env, id: string) => env.DB.prepare('SELECT * FROM licenses WHERE id = ?').bind(id).first<License>();
const bySession = (env: Env, session: string) => env.DB.prepare('SELECT * FROM licenses WHERE stripe_session = ?').bind(session).first<License>();

const statusOf = (license: License | null) => (!license ? 'unknown' : license.revoked_at > 0 ? 'revoked' : 'active');

/**
 * A license's family: its seats (the biggest unrevoked key's), the installs seen in the
 * last 14 days, and whether any of its keys still stands (live: false once all are revoked).
 */
async function family(env: Env, license: License): Promise<Family> {
  const root = license.root_id || license.id;
  const seats = await env.DB.prepare('SELECT max(seats) AS seats FROM licenses WHERE root_id = ? AND revoked_at = 0').bind(root).first<{ seats: number | null }>();
  const installs = await env.DB.prepare('SELECT count(*) AS n FROM installs WHERE root_id = ? AND last_seen > ?').bind(root, Date.now() - INSTALL_WINDOW).first<{ n: number }>();
  const live = seats?.seats != null;
  return { root, seats: live ? seats.seats! : license.seats, installs: installs?.n ?? 0, live };
}

/**
 * Notes that an install checked a family's key: at most one write a day per install. Installs
 * not seen for 14 days are dropped, and a new one is kept only while the family has fewer than
 * `cap`, so a leaked key can't fill the table.
 */
async function sawInstall(env: Env, root: string, install: string, cap: number) {
  const now = Date.now();
  await env.DB.prepare('DELETE FROM installs WHERE root_id = ? AND last_seen <= ?').bind(root, now - INSTALL_WINDOW).run();
  await env.DB.prepare(
    `INSERT INTO installs (root_id, install, last_seen)
     SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM installs WHERE root_id = ?1 AND install = ?2)
                          OR (SELECT count(*) FROM installs WHERE root_id = ?1) < ?4
     ON CONFLICT (root_id, install) DO UPDATE SET last_seen = excluded.last_seen WHERE installs.last_seen < excluded.last_seen - ?5`,
  ).bind(root, install, now, cap, DAY).run();
}

/** Revokes every unrevoked key a payment bought, saying why in its note. */
async function revokePayment(env: Env, paymentIntent: string, why: string) {
  await env.DB.prepare("UPDATE licenses SET revoked_at = ?, note = trim(note || ' ' || ?) WHERE stripe_payment_intent = ? AND revoked_at = 0")
    .bind(Date.now(), why, paymentIntent).run();
}

/**
 * Tells the owner (ADMIN_EMAIL) of a sale, once per license: the thank-you page and the webhook
 * can both get here, and the first to claim notified_at sends. Hand-issued keys aren't sales.
 * Never throws; a notice that can't be sent is released for the next caller to try.
 */
async function notifySaleOnce(env: Env, license: License, origin: string) {
  if (!env.ADMIN_EMAIL || license.source !== 'stripe' || license.notified_at) return;
  const claim = await env.DB.prepare('UPDATE licenses SET notified_at = ? WHERE id = ? AND notified_at = 0').bind(Date.now(), license.id).run();
  if (claim.meta.changes !== 1) return;
  try {
    const count = await env.DB.prepare("SELECT count(*) AS n FROM licenses WHERE source = 'stripe' AND product = ? AND issued_at <= ?").bind(license.product, license.issued_at).first<{ n: number }>();
    await sendEmail(env, env.ADMIN_EMAIL, saleEmail(license, { number: count?.n ?? 0, origin, dashboard: env.STRIPE_DASHBOARD, mode: env.MODE }), `sale/${license.id}`);
  } catch (error) {
    console.log(JSON.stringify({ event: 'sale_notice_failed', id: license.id, error: String(error) }));
    await env.DB.prepare('UPDATE licenses SET notified_at = 0 WHERE id = ?').bind(license.id).run();
  }
}

/**
 * After a plugin's check: notes when a live family's installs start or stop clearly
 * outnumbering its seats (over_since, on its first key), and once that has lasted 14 days,
 * emails its latest buyer, at most every 90 days (nudged_at). Never throws.
 */
async function seatsCheck(env: Env, fam: Family) {
  try {
    if (!fam.live) return;
    const root = await byId(env, fam.root);
    if (!root) return;
    const now = Date.now();
    if (!clearlyOver(fam.seats, fam.installs)) {
      if (root.over_since) await env.DB.prepare('UPDATE licenses SET over_since = 0 WHERE id = ?').bind(root.id).run();
      return;
    }
    if (!root.over_since) {
      await env.DB.prepare('UPDATE licenses SET over_since = ? WHERE id = ? AND over_since = 0').bind(now, root.id).run();
      return;
    }
    if (now - root.over_since < OVER_FOR || now - root.nudged_at < NUDGE_EVERY) return;
    const claim = await env.DB.prepare('UPDATE licenses SET nudged_at = ? WHERE id = ? AND nudged_at = ?').bind(now, root.id, root.nudged_at).run();
    if (claim.meta.changes !== 1) return;
    const latest = (await env.DB.prepare('SELECT email, licensee, product FROM licenses WHERE root_id = ? AND revoked_at = 0 ORDER BY issued_at DESC LIMIT 1').bind(root.id).first<Pick<License, 'email' | 'licensee' | 'product'>>())!;
    try {
      await sendEmail(env, latest.email, seatsEmail({ product: latest.product, licensee: latest.licensee, seats: fam.seats, installs: fam.installs }),
        `seats/${root.id}/${new Date(now).toISOString().slice(0, 10)}`);
      console.log(JSON.stringify({ event: 'seats_email', root: root.id, seats: fam.seats, installs: fam.installs }));
    } catch (error) {
      console.log(JSON.stringify({ event: 'seats_email_failed', root: root.id, error: String(error) }));
      await env.DB.prepare('UPDATE licenses SET nudged_at = ? WHERE id = ?').bind(root.nudged_at, root.id).run();
    }
  } catch (error) {
    console.log(JSON.stringify({ event: 'seats_check_failed', error: String(error) }));
  }
}

/**
 * Whether a live family has outgrown its seats: its installs clearly outnumber them now, and
 * have for 14 days running (over_since, kept by seatsCheck). Asked fresh on every check, so
 * adding seats ends it at once. Reads the database only when the family is over.
 */
async function outgrown(env: Env, fam: Family) {
  if (!fam.live || !clearlyOver(fam.seats, fam.installs)) return false;
  const root = await env.DB.prepare('SELECT over_since FROM licenses WHERE id = ?').bind(fam.root).first<{ over_since: number }>();
  return Boolean(root?.over_since) && Date.now() - root!.over_since >= OVER_FOR;
}

/** Tells the owner something needs a person. Never throws: an alert that can't be sent is only logged. */
async function alertOwner(env: Env, subject: string, text: string, idempotency: string) {
  try {
    if (env.ADMIN_EMAIL) await sendEmail(env, env.ADMIN_EMAIL, { subject, text }, idempotency);
  } catch (error) {
    console.log(JSON.stringify({ event: 'alert_failed', error: String(error) }));
  }
}

/**
 * A key's signature check against its own product's public keys (the prefix says which
 * product): { state, payload, prefix, product }. A key relabelled with another product's
 * prefix is checked against that product's keys, which never signed it, so it's forged.
 */
async function checkAnyKey(env: Env, text: unknown): Promise<(KeyCheck & { product: ProductWithId }) | { state: 'malformed'; payload?: undefined; product?: undefined }> {
  // A key is text: anything else sent in its place (an object, say) is malformed, not an error.
  const key = typeof text === 'string' ? text : '';
  const prefix = key.replace(/\s+/g, '').split('.')[0];
  const product = productByPrefix(prefix);
  if (!product) return { state: 'malformed' };
  return { ...(await checkKey(key, await publicKeys(env, product), [product.keyPrefix])), product };
}

/** A pasted key that is ours and on record: { license, product } or { error, status }. */
async function knownKey(env: Env, text: unknown): Promise<Known> {
  const check = await checkAnyKey(env, text);
  if (check.state !== 'valid') return { error: "That doesn't look like a license key. Paste the whole key.", status: 400 };
  const license = await byId(env, check.payload.id);
  if (!license || license.product !== check.product.id) return { error: "That key isn't on record. Get in touch and we'll sort it out.", status: 404 };
  return { license, product: check.product };
}

/**
 * The public keys a product's keys are checked against: its signing key's, and its retired
 * keys' ({ kid, x, y } each, in the var its `signing.retired` names, a JSON list), so keys
 * they signed before a rotation still work here.
 */
async function publicKeys(env: Env, product: ProductWithId): Promise<PublicKey[]> {
  let old = env[product.signing.retired] || [];
  if (typeof old === 'string') {
    try {
      old = JSON.parse(old);
    } catch {
      old = [];
    }
  }
  return [(await signing(env, product)).publicKey, ...(Array.isArray(old) ? old.filter((k) => k?.kid && k?.x && k?.y) : [])];
}

/** Signs and stores a new license. A second call for the same Checkout gets the first one's row. */
async function issue(env: Env, { product, licensee, email, seats, source, root = null, session = null, paymentIntent = null, amount = null, currency = null, note = '' }: {
  product: ProductWithId; licensee: string; email: string; seats: number; source: License['source'];
  root?: string | null; session?: string | null; paymentIntent?: string | null; amount?: number | null; currency?: string | null; note?: string;
}) {
  const id = newLicenseId();
  const iat = Date.now();
  const { key, payload } = await signKey(await signing(env, product), product.keyPrefix, { id, to: licensee, seats, iat });
  await env.DB.prepare(
    `INSERT INTO licenses (id, product, root_id, key, licensee, email, seats, issued_at, source, stripe_session, stripe_payment_intent, amount_total, currency, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (stripe_session) DO NOTHING`,
  ).bind(id, product.id, root || id, key, payload.to, email, seats, iat, source, session, paymentIntent, amount, currency, note).run();
  return (session ? bySession(env, session) : byId(env, id)) as Promise<License>;
}

/** Emails a license's key unless it has been already. Claims the send first so two callers can't both send. */
async function emailOnce(env: Env, license: License) {
  const now = Date.now();
  const claim = await env.DB.prepare('UPDATE licenses SET emailed_at = ? WHERE id = ? AND emailed_at = 0').bind(now, license.id).run();
  if (claim.meta.changes !== 1) return true;
  try {
    const sent = await sendKeyEmail(env, license, `license-email/${license.id}`);
    await env.DB.prepare('UPDATE licenses SET email_error = ? WHERE id = ?').bind(sent ? '' : 'not sent: EMAIL_ONLY_TO leaves this address out', license.id).run();
    return true;
  } catch (error) {
    console.log(JSON.stringify({ event: 'email_failed', id: license.id, error: String(error) }));
    await env.DB.prepare('UPDATE licenses SET emailed_at = 0, email_error = ? WHERE id = ?').bind(String((error as Error).message || error), license.id).run();
    return false;
  }
}

/** The license a Checkout Session paid for, issued now if it hasn't been: { license } or { pending } or { error }. */
async function fulfil(env: Env, session: CheckoutSession): Promise<Fulfilled> {
  const product = productOf(session.metadata?.product);
  if (session.mode !== 'payment' || !product) return { error: 'not a license purchase' };
  if (session.payment_status !== 'paid') return { pending: true };
  const existing = await bySession(env, session.id);
  if (existing) return { license: existing };
  const bought = Number.parseInt(session.metadata!.seats!, 10);
  const email = session.customer_details?.email;
  let licensee: string, seats = bought, root: string | null = null, note = '';
  if (session.metadata!.add_to) {
    // Seats added to a license: one new key for the family's new total, same licensee.
    const base = await byId(env, session.metadata!.add_to);
    if (!base) return { error: 'no such license to add to' };
    const fam = await family(env, base);
    root = fam.root;
    licensee = base.licensee;
    // Refunded meanwhile (every key revoked): the new key covers only what was just paid for.
    seats = (fam.live ? fam.seats : 0) + bought;
    note = fam.live ? `adds ${bought} seat${bought === 1 ? '' : 's'} to ${fam.seats}` : `adds ${bought} seat${bought === 1 ? '' : 's'} to a withdrawn license`;
  } else {
    const named = session.custom_fields?.find((f) => f.key === 'licensee')?.text?.value;
    licensee = String(named || session.customer_details?.name || email || '').trim();
  }
  if (!Number.isInteger(bought) || bought < 1 || !email || !licensee) return { error: 'incomplete purchase' };
  const license = await issue(env, {
    product, licensee, email, seats, root, note, source: 'stripe', session: session.id,
    paymentIntent: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null,
    amount: session.amount_total, currency: session.currency,
  });
  console.log(JSON.stringify({ event: 'issued', id: license.id, seats, session: session.id }));
  return { license };
}

// ---- The site

/** Whether a Turnstile token from the store's recovery widget is good (and from one of TURNSTILE_HOSTNAMES, when set). */
async function human(env: Env, token: unknown, request: Request) {
  if (!token || !env.TURNSTILE_SECRET) return false;
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: String(token), remoteip: request.headers.get('CF-Connecting-IP') || '' }),
  });
  const verdict: { success?: boolean; hostname?: string } = await response.json<{ success?: boolean; hostname?: string }>().catch(() => ({}));
  const hosts = String(env.TURNSTILE_HOSTNAMES || '').split(',').map((h) => h.trim()).filter(Boolean);
  return verdict.success === true && (!hosts.length || hosts.includes(verdict.hostname!));
}

const NOT_HUMAN = { error: "Couldn't check that you're not a bot. Reload the page and try again." };

function siteOrigin(request: Request, env: Env) {
  const origins = String(env.SITE_ORIGINS || '').split(',').map((o) => o.trim());
  const origin = request.headers.get('Origin');
  return origins.includes(origin!) ? origin : null;
}

async function createCheckout(request: Request, env: Env) {
  const site = siteOrigin(request, env);
  if (!site) return json({ error: 'Bad origin.' }, 403);
  let body: { seats?: unknown; product?: unknown; key?: unknown } | null;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Bad request.' }, 400);
  }
  const seats = Number(body?.seats);
  if (!Number.isInteger(seats) || seats < 1 || seats > MAX_SEATS) {
    return json({ error: `Choose between 1 and ${MAX_SEATS} seats.` }, 400);
  }
  const plural = (n: number) => `${n} seat${n === 1 ? '' : 's'}`;
  let product = productOf(body?.product);
  if (!body?.key && !product) return json({ error: 'Unknown product.' }, 400);
  let total = seats;
  let addTo: { root: string; licensee: string } | null = null;
  let fields: object = {
    custom_fields: [{
      key: 'licensee', type: 'text',
      label: { type: 'custom', custom: 'Licensee (company, or your name)' },
      text: { minimum_length: 2, maximum_length: 100 },
    }],
  };
  if (body?.key) {
    // Adding seats: priced by the new total, so growing past 10 gets the volume price.
    const found = await knownKey(env, body.key);
    if (found.error) return json({ error: found.error }, found.status);
    if (found.license!.revoked_at) return json({ error: 'That key was withdrawn, so seats can\'t be added to it. Get in touch and we\'ll sort it out.' }, 400);
    if (!found.product) return json({ error: 'Seats can\'t be added to that key here. Get in touch.' }, 400);
    product = found.product;
    const fam = await family(env, found.license);
    total = fam.seats + seats;
    if (total > MAX_SEATS) return json({ error: `A license can have up to ${MAX_SEATS} seats.` }, 400);
    addTo = { root: fam.root, licensee: found.license.licensee };
    fields = {};
  }
  const prices = env.PRICES?.[product!.id];
  if (!prices?.seat || !prices?.volume) return json({ error: `${product!.name} isn't on sale yet.` }, 400);
  const metadata = { product: product!.id, seats, ...(addTo ? { add_to: addTo.root } : {}) };
  const description = addTo
    ? `${product!.license} for ${addTo.licensee}: ${plural(seats)} more, ${total} in all`
    : `${product!.license}, ${plural(seats)}`;
  const session = await stripe(env, 'POST', 'checkout/sessions', {
    mode: 'payment',
    line_items: [{ price: total >= product!.volumeSeats ? prices.volume : prices.seat, quantity: seats }],
    metadata,
    payment_intent_data: { metadata, description },
    ...fields,
    submit_type: 'pay',
    success_url: `${site}/#license/{CHECKOUT_SESSION_ID}`,
    cancel_url: `${site}/${product!.page}`,
  });
  return json({ url: session.url });
}

async function checkoutResult(env: Env, ctx: ExecutionContext, sessionId: string | null, origin: string) {
  if (!sessionId || !/^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(sessionId)) return json({ error: 'Not found.' }, 404);
  let license = await bySession(env, sessionId);
  if (!license) {
    // The webhook hasn't landed yet: ask Stripe and issue it here (whichever comes first wins).
    let session: CheckoutSession;
    try {
      session = await stripe(env, 'GET', `checkout/sessions/${sessionId}`);
    } catch {
      return json({ error: 'Not found.' }, 404);
    }
    const result = await fulfil(env, session);
    if (result.pending) return json({ status: 'pending' }, 202);
    if (result.error) return json({ error: 'Not found.' }, 404);
    license = result.license!;
  }
  if (license.emailed_at === 0) ctx.waitUntil(emailOnce(env, license));
  if (!license.notified_at) ctx.waitUntil(notifySaleOnce(env, license, origin));
  if (Date.now() - license.issued_at > KEY_SHOWN_FOR) return json({ error: 'expired' }, 410);
  return json({
    status: statusOf(license), id: license.id, key: license.key, licensee: license.licensee,
    seats: license.seats, email: license.email, issuedAt: license.issued_at,
    added: Boolean(license.root_id && license.root_id !== license.id),
    product: license.product, productName: productOf(license.product)?.name ?? '', howToUse: productOf(license.product)?.howToUse(`${license.seats} seat${license.seats === 1 ? '' : 's'}`) ?? '',
  });
}

/**
 * Lost keys: emails the address every license connected to it (a key ever sent
 * there), each license's newest unrevoked key. The answer is the same whether
 * or not there are any, and it goes out before the lookup (sendKeys, after it), so
 * neither its words, its timing nor a failed send can tell anyone who bought.
 */
async function recover(request: Request, env: Env, ctx: ExecutionContext) {
  if (!siteOrigin(request, env)) return json({ error: 'Bad origin.' }, 403);
  const body = await request.json<{ email?: unknown; turnstile?: unknown }>().catch(() => null);
  const email = String(body?.email || '').trim().slice(0, 200);
  if (!EMAIL.test(email)) return json({ error: 'Please enter a valid email address.' }, 400);
  if (!(await human(env, body?.turnstile, request))) return json(NOT_HUMAN, 403);
  ctx.waitUntil(sendKeys(env, email));
  return json({ ok: true, message: "If we have keys for that address, we've emailed them to it. Give it a minute, and check your spam folder." });
}

/**
 * Recovery's lookup and email, once its answer is out. An address gets at most one every
 * 30 seconds and RECOVERY_PER_ADDRESS a day, and all addresses RECOVERY_PER_DAY; a send that
 * fails is released, so asking again works at once. Never throws.
 */
async function sendKeys(env: Env, email: string) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT l.* FROM licenses l
       WHERE l.revoked_at = 0
         AND l.root_id IN (SELECT root_id FROM licenses WHERE email = ? COLLATE NOCASE)
         AND l.issued_at = (SELECT max(issued_at) FROM licenses m WHERE m.root_id = l.root_id AND m.revoked_at = 0)
       ORDER BY l.issued_at DESC`,
    ).bind(email).all<License>();
    if (!results.length) return;
    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);
    const all = await env.DB.prepare('SELECT coalesce(sum(day_count), 0) AS n FROM recoveries WHERE day = ?').bind(today).first<{ n: number }>();
    if ((all?.n ?? 0) >= RECOVERY_PER_DAY) {
      console.log(JSON.stringify({ event: 'recover_capped', scope: 'day' }));
      return;
    }
    // Claimed only when the last send to this address was over 30 seconds ago and it has had
    // fewer than RECOVERY_PER_ADDRESS today. The SET reads the row as it was.
    const claim = await env.DB.prepare(
      `INSERT INTO recoveries (email, sent_at, day, day_count) VALUES (?1, ?2, ?3, 1)
       ON CONFLICT (email) DO UPDATE SET sent_at = excluded.sent_at, day = excluded.day,
         day_count = CASE WHEN recoveries.day = excluded.day THEN recoveries.day_count + 1 ELSE 1 END
       WHERE recoveries.sent_at < ?4 AND (recoveries.day != excluded.day OR recoveries.day_count < ?5)`,
    ).bind(email.toLowerCase(), now, today, now - RECOVERY_GAP, RECOVERY_PER_ADDRESS).run();
    if (claim.meta.changes !== 1) return;
    try {
      await sendEmail(env, email, recoveryEmail(email, results), `recover/${email.toLowerCase()}/${now}`);
    } catch (error) {
      await env.DB.prepare('UPDATE recoveries SET sent_at = 0, day_count = max(day_count - 1, 0) WHERE email = ?').bind(email.toLowerCase()).run();
      throw error;
    }
    console.log(JSON.stringify({ event: 'recovered', keys: results.length }));
  } catch (error) {
    console.log(JSON.stringify({ event: 'recover_failed', error: String(error) }));
  }
}

async function lookup(request: Request, env: Env) {
  if (!siteOrigin(request, env)) return json({ error: 'Bad origin.' }, 403);
  const body = await request.json<{ key?: unknown }>().catch(() => null);
  const found = await knownKey(env, body?.key);
  if (found.error) return json({ error: found.error }, found.status);
  const { license, product } = found as Extract<Known, { license: License }>;
  const fam = await family(env, license);
  const newest = await env.DB.prepare('SELECT max(issued_at) AS at FROM licenses WHERE root_id = ? AND revoked_at = 0').bind(fam.root).first<{ at: number | null }>();
  return json({
    product: license.product, productName: product?.name ?? '', volumeSeats: product?.volumeSeats ?? 0,
    licensee: license.licensee, status: fam.live ? 'active' : 'revoked', seats: fam.seats, installs: fam.installs,
    keySeats: license.seats, isNewest: license.revoked_at === 0 && license.issued_at >= (newest?.at ?? 0),
  });
}

async function webhook(request: Request, env: Env) {
  const body = await request.text();
  const event = await webhookEvent(body, request.headers.get('Stripe-Signature'), env.STRIPE_WEBHOOK_SECRET);
  if (!event) return json({ error: 'Bad signature.' }, 400);
  const object = event.data?.object;
  const pi = typeof object?.payment_intent === 'string' ? object.payment_intent : object?.payment_intent?.id;
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const result = await fulfil(env, object);
    if (result.error && productOf(object?.metadata?.product) && object?.payment_status === 'paid') {
      // Paid for, and still no key: a person has to look (issue one from /admin, or refund).
      console.log(JSON.stringify({ event: 'unfulfilled', session: object.id, error: result.error }));
      await alertOwner(env, `Paid, but no license key: ${object.id}`,
        `A paid Checkout couldn't be turned into a key (${result.error}).\n\nSession: ${object.id}\nPayment: ${pi || '?'}\nBuyer: ${object.customer_details?.email || '?'}\n\nIssue a key by hand at /admin, or refund it in Stripe.\n`,
        `alert/unfulfilled/${object.id}`);
    }
    if (result.license) await notifySaleOnce(env, result.license, new URL(request.url).origin);
    // A failed email answers 500, so Stripe sends the event again and the email is tried again.
    if (result.license && !(await emailOnce(env, result.license))) return json({ error: 'Email failed; retry.' }, 500);
  } else if (event.type === 'charge.refunded' && object?.amount_refunded >= object?.amount && pi) {
    await revokePayment(env, pi, 'refunded');
  } else if (event.type === 'charge.dispute.closed' && object?.status === 'lost' && pi) {
    await revokePayment(env, pi, 'chargeback lost');
  }
  return json({ received: true });
}

// ---- The plugin

/**
 * The app's weekly check of a product's license. The status is the license's (its family's):
 * revoked only once every key of it is. Another product's license id is unknown here. Installs
 * are counted for seatsCheck; the app shows the seats, never the installs, and a small note
 * asking for more seats while the license has outgrown them.
 */
async function keyStatus(env: Env, ctx: ExecutionContext, product: string, id: string | null, install: string | null) {
  const license = id ? await byId(env, id) : null;
  if (!license || license.product !== product) return json({ status: 'unknown' }, 200, ANY_ORIGIN);
  const root = license.root_id || license.id;
  const counted = Boolean(install && /^[A-Za-z0-9_-]{8,64}$/.test(install));
  if (counted) await sawInstall(env, root, install!, installCap(license.seats));
  const fam = await family(env, license);
  if (counted) ctx.waitUntil(seatsCheck(env, fam));
  return json({ status: fam.live ? 'active' : 'revoked', seats: fam.seats, installs: fam.installs, outgrown: await outgrown(env, fam) }, 200, ANY_ORIGIN);
}

async function verify(request: Request, env: Env) {
  let body: { key?: unknown } | null;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Bad request.' }, 400, ANY_ORIGIN);
  }
  const check = await checkAnyKey(env, body?.key);
  const found = check.state === 'valid' ? await byId(env, check.payload.id) : null;
  const license = found?.product === check.product?.id ? found : null;
  const status = license ? ((await family(env, license)).live ? 'active' : 'revoked') : 'unknown';
  return json({
    valid: check.state === 'valid' && status === 'active', signature: check.state, status,
    ...(check.payload ? { product: check.product.id, licensee: check.payload.to, seats: check.payload.seats, id: check.payload.id } : {}),
  }, 200, ANY_ORIGIN);
}

// ---- The owner

async function admin(request: Request, env: Env, path: string) {
  const who = await adminEmail(request, env);
  if (!who) return new Response('Forbidden', { status: 403 });
  if (path === '/admin' || path === '/admin/') {
    return new Response(ADMIN_PAGE.replaceAll('{{MODE}}', env.MODE || ''), {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' },
    });
  }
  if (request.method === 'POST' && request.headers.get('Origin') !== new URL(request.url).origin) {
    return json({ error: 'Bad origin.' }, 403);
  }
  if (path === '/admin/api/licenses' && request.method === 'GET') {
    const params = new URL(request.url).searchParams;
    const q = params.get('q')?.trim() || '';
    const only = params.get('product') || '';
    const like = `%${q}%`;
    const { results } = await env.DB.prepare(
      `SELECT licenses.*, (SELECT count(*) FROM installs i WHERE i.root_id = licenses.root_id AND i.last_seen > ?) AS installs
       FROM licenses WHERE (? = '' OR product = ?)
         AND (? = '' OR email LIKE ? OR licensee LIKE ? OR id LIKE ? OR root_id LIKE ? OR stripe_payment_intent LIKE ?)
       ORDER BY issued_at DESC LIMIT 500`,
    ).bind(Date.now() - INSTALL_WINDOW, only, only, q, like, like, like, like, like).all<License & { installs: number }>();
    // Each product's licenses (families), those standing, and what its unrevoked sales took in.
    const { results: totals } = await env.DB.prepare(
      `SELECT product, count(DISTINCT root_id) AS licenses,
              count(DISTINCT CASE WHEN revoked_at = 0 THEN root_id END) AS live,
              coalesce(sum(CASE WHEN source = 'stripe' AND revoked_at = 0 THEN amount_total END), 0) AS taken,
              max(currency) AS currency
       FROM licenses GROUP BY product`,
    ).all<{ product: string; licenses: number; live: number; taken: number; currency: string | null }>();
    // Every product sold now, and any that's on record but no longer in src/products.ts.
    const products: Record<string, string> = Object.fromEntries(Object.entries(PRODUCTS).map(([id, p]) => [id, p.name]));
    for (const t of totals) products[t.product] ??= t.product;
    return json({ licenses: results, totals, dashboard: env.STRIPE_DASHBOARD || '', products, selling: Object.keys(PRODUCTS) });
  }
  if (path === '/admin/api/licenses' && request.method === 'POST') {
    const body = await request.json<{ email?: unknown; licensee?: unknown; seats?: unknown; product?: unknown; note?: unknown; send?: unknown }>().catch(() => null);
    const email = String(body?.email || '').trim();
    const licensee = String(body?.licensee || '').trim();
    const seats = Number(body?.seats);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !licensee || !Number.isInteger(seats) || seats < 1) {
      return json({ error: 'Email, licensee and a whole number of seats, please.' }, 400);
    }
    const product = productOf(body?.product);
    if (!product) return json({ error: 'Choose a product.' }, 400);
    const license = await issue(env, { product, licensee, email, seats, source: 'admin', note: String(body?.note || '').slice(0, 500) });
    const emailed = body?.send ? await emailOnce(env, license) : null;
    return json({ license: await byId(env, license.id), emailed });
  }
  const action = path.match(/^\/admin\/api\/licenses\/(lic_[A-Za-z0-9_-]+)\/(revoke|restore|resend)$/);
  if (action && request.method === 'POST') {
    const [, id, verb] = action;
    const license = await byId(env, id);
    if (!license) return json({ error: 'No such license.' }, 404);
    // Withdrawing or restoring acts on the whole license: all the keys of its family.
    const root = license.root_id || license.id;
    if (verb === 'revoke') await env.DB.prepare('UPDATE licenses SET revoked_at = ? WHERE root_id = ? AND revoked_at = 0').bind(Date.now(), root).run();
    if (verb === 'restore') await env.DB.prepare('UPDATE licenses SET revoked_at = 0 WHERE root_id = ?').bind(root).run();
    if (verb === 'resend') {
      if (!mayEmail(env, license.email)) return json({ error: 'Not sent: EMAIL_ONLY_TO leaves this address out.' }, 400);
      try {
        await sendKeyEmail(env, license, `license-resend/${id}/${Date.now()}`);
        await env.DB.prepare("UPDATE licenses SET emailed_at = ?, email_error = '' WHERE id = ?").bind(Date.now(), id).run();
      } catch (error) {
        await env.DB.prepare('UPDATE licenses SET email_error = ? WHERE id = ?').bind(String((error as Error).message || error), id).run();
        return json({ error: String((error as Error).message || error) }, 502);
      }
    }
    return json({ license: await byId(env, id) });
  }
  return json({ error: 'Not found.' }, 404);
}

// ---- Routing

async function limited(env: Env, request: Request) {
  if (!env.LIMIT) return false;
  const { success } = await env.LIMIT.limit({ key: request.headers.get('CF-Connecting-IP') || '' });
  return !success;
}

const routes = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path === '/admin' || path.startsWith('/admin/')) return await admin(request, env, path);

      if (path === '/v1/checkout' || path.startsWith('/v1/checkout/') || path === '/v1/lookup' || path === '/v1/recover') {
        const cors = siteCors(request, env);
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (await limited(env, request)) return json({ error: 'Too many requests. Wait a minute and try again.' }, 429, cors);
        let response: Response;
        try {
          response = path === '/v1/lookup' && request.method === 'POST' ? await lookup(request, env)
            : path === '/v1/recover' && request.method === 'POST' ? await recover(request, env, ctx)
            : path === '/v1/checkout' && request.method === 'POST'
            ? await createCheckout(request, env)
            : request.method === 'GET' ? await checkoutResult(env, ctx, decoded(path.slice('/v1/checkout/'.length)), url.origin)
            : json({ error: 'Method not allowed.' }, 405);
        } catch (error) {
          // Answered with CORS headers, so the page can show it.
          console.log(JSON.stringify({ event: 'error', path, error: String((error as Error)?.stack || error) }));
          response = json({ error: 'Something went wrong. Please try again, or get in touch: https://adamschaefers.com/inquiries/' }, 500);
        }
        for (const [k, v] of Object.entries(cors)) response.headers.set(k, v);
        return response;
      }

      if (path === '/v1/stripe/webhook' && request.method === 'POST') return await webhook(request, env);

      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: ANY_ORIGIN });
      // A product's own paths, /v1/products/<id>/...; the unscoped ones are FIRST_PRODUCT's.
      const scoped = path.match(/^\/v1\/products\/([a-z0-9-]+)(\/.*)$/);
      const product = scoped ? productOf(scoped[1]) : productOf(FIRST_PRODUCT);
      if (scoped && !product) return json({ error: 'Unknown product.' }, 404, ANY_ORIGIN);
      const key = scoped ? scoped[2].match(/^\/keys\/([^/]+)$/) : path.match(/^\/v1\/keys\/([^/]+)$/);
      if (key && request.method === 'GET') {
        // Apps ask about once a week; more than that from one address is someone else.
        if (await limited(env, request)) return json({ error: 'Too many requests.' }, 429, ANY_ORIGIN);
        return await keyStatus(env, ctx, product!.id, decoded(key[1]), url.searchParams.get('install'));
      }
      if ((scoped ? scoped[2] === '/public-keys' : path === '/v1/public-keys') && request.method === 'GET') {
        return json(await publicKeys(env, product!), 200, ANY_ORIGIN);
      }
      if (path === '/v1/verify' && request.method === 'POST') {
        if (await limited(env, request)) return json({ error: 'Too many requests.' }, 429, ANY_ORIGIN);
        return await verify(request, env);
      }
      if (path === '/') return new Response('License server for adamschaefers.com. Buy at https://adamschaefers.com/store/\n');
      return json({ error: 'Not found.' }, 404);
    } catch (error) {
      console.log(JSON.stringify({ event: 'error', path, error: String((error as Error)?.stack || error) }));
      return json({ error: 'Something went wrong. Please try again, or get in touch: https://adamschaefers.com/inquiries/' }, 500);
    }
  },
};

/**
 * Every answer this server gives is for one caller at one moment (a key, a license's seats,
 * the admin page), so no cache may keep any of it: each says Cache-Control: no-store, the
 * ones that don't set it themselves included. Cloudflare doesn't cache a Worker's own answers
 * anyway, unless Workers Cache ("cache" in wrangler.jsonc) is switched on, and that stays off
 * (test/worker.test.ts); even on, it would honor no-store.
 */
function uncached(response: Response) {
  if (!response.headers.has('Cache-Control')) response.headers.set('Cache-Control', 'no-store');
  return response;
}

export default {
  async fetch(request, env, ctx) {
    return uncached(await routes.fetch(request, env, ctx));
  },
} satisfies ExportedHandler<Env>;
