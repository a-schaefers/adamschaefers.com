// The Worker end to end, offline: D1 is node:sqlite, and Stripe, Resend and
// Cloudflare Access are fakes behind globalThis.fetch. Keys are checked with
// the plugin's own checker when ../backseat-driver is next to this repo.
//   node --test license-worker/test/

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';

import worker from '../src/index.js';
import { toBase64url } from '../src/keys.js';

const here = new URL('.', import.meta.url);
const schema = readFileSync(new URL('../schema.sql', here), 'utf8');
const pluginChecker = new URL('../../../backseat-driver/plugin/core/licensekey.ts', here);

/** D1's API over node:sqlite: prepare().bind().first() / all() / run(). */
function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  return {
    raw: db,
    prepare(sql) {
      let args = [];
      const statement = {
        bind: (...values) => ((args = values), statement),
        first: async () => {
          const row = db.prepare(sql).get(...args);
          return row ? { ...row } : null;
        },
        all: async () => ({ results: db.prepare(sql).all(...args).map((r) => ({ ...r })) }),
        run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
      };
      return statement;
    },
  };
}

const SITE = 'https://adamschaefers.com';
const WEBHOOK_SECRET = 'whsec_test_secret';
let env, sessions, emails, notices, failEmail, failNotice, waits;

function ctx() {
  return { waitUntil: (p) => waits.push(p) };
}

beforeEach(() => {
  const pem = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
  env = {
    DB: d1(), SIGNING_KEY: pem, SIGNING_KID: 'test-1', SITE_ORIGINS: `${SITE},http://localhost:8000`,
    STRIPE_SECRET_KEY: 'rk_test_x', STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, PRICES: { 'backseat-driver': { seat: 'price_99', volume: 'price_7425' } },
    RESEND_API_KEY: 're_test', TURNSTILE_SECRET: 'ts_secret', TURNSTILE_HOSTNAMES: 'adamschaefers.com', STRIPE_DASHBOARD: 'https://dashboard.stripe.com/test', FROM_EMAIL: 'Adam Schaefers <licenses@adamschaefers.com>',
    ACCESS_TEAM: 'team.cloudflareaccess.com', ACCESS_AUD: 'aud123', ADMIN_EMAIL: 'adam.schaefers@icloud.com', MODE: 'TEST',
  };
  sessions = new Map();
  emails = [];
  notices = [];
  failEmail = false;
  failNotice = false;
  waits = [];
});

// ---- Fakes

let accessKeys;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const body = init.body;
  if (url === 'https://api.stripe.com/v1/checkout/sessions' && init.method === 'POST') {
    const form = new URLSearchParams(body);
    const id = `cs_test_${'a'.repeat(20)}${sessions.size}`;
    const session = {
      id, mode: form.get('mode'), url: `https://checkout.stripe.com/c/pay/${id}`, payment_status: 'unpaid',
      metadata: { product: form.get('metadata[product]'), seats: form.get('metadata[seats]'), ...(form.get('metadata[add_to]') ? { add_to: form.get('metadata[add_to]') } : {}) },
      hasLicenseeField: form.has('custom_fields[0][key]'),
      price: form.get('line_items[0][price]'), quantity: Number(form.get('line_items[0][quantity]')),
      success_url: form.get('success_url'), cancel_url: form.get('cancel_url'),
      custom_fields: [], customer_details: null, payment_intent: null, amount_total: null, currency: 'usd',
    };
    sessions.set(id, session);
    return Response.json(session);
  }
  const get = url.match(/^https:\/\/api\.stripe\.com\/v1\/checkout\/sessions\/(.+)$/);
  if (get) return sessions.has(get[1]) ? Response.json(sessions.get(get[1])) : Response.json({ error: { message: 'No such session' } }, { status: 404 });
  if (url === 'https://api.resend.com/emails') {
    const mail = { ...JSON.parse(body), idempotency: init.headers['Idempotency-Key'] };
    // The owner's sale notices are kept apart, so the counts of buyers' emails stay simple.
    if (/Sale: /.test(mail.subject)) {
      if (failNotice) return Response.json({ message: 'nope' }, { status: 500 });
      notices.push(mail);
      return Response.json({ id: `notice_${notices.length}` });
    }
    if (failEmail) return Response.json({ message: 'nope' }, { status: 500 });
    emails.push(mail);
    return Response.json({ id: `email_${emails.length}` });
  }
  if (url === 'https://team.cloudflareaccess.com/cdn-cgi/access/certs') return Response.json({ keys: [accessKeys.jwk] });
  if (url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify') {
    const token = new URLSearchParams(body).get('response');
    return Response.json({ success: token === 'human' || token === 'wrong-site', hostname: token === 'wrong-site' ? 'evil.test' : 'adamschaefers.com' });
  }
  throw new Error(`unexpected fetch ${url}`);
};

function pay(id, { licensee = 'Acme, Inc.', email = 'buyer@acme.test' } = {}) {
  const s = sessions.get(id);
  Object.assign(s, {
    payment_status: 'paid', payment_intent: `pi_${id.slice(-6)}`, amount_total: s.quantity * (s.price === 'price_99' ? 9900 : 7425),
    customer_details: { email, name: 'Buyer' }, custom_fields: [{ key: 'licensee', text: { value: licensee } }],
  });
  return s;
}

const call = (method, path, { body, headers = {} } = {}) =>
  worker.fetch(new Request(`https://licenses.test${path}`, { method, headers, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) }), env, ctx());

async function signed(event, secret = WEBHOOK_SECRET, t = Math.floor(Date.now() / 1000)) {
  const body = JSON.stringify(event);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`))), (b) => b.toString(16).padStart(2, '0')).join('');
  return { body, headers: { 'Stripe-Signature': `t=${t},v1=${sig}` } };
}

async function checkout(seats, origin = SITE) {
  const r = await call('POST', '/v1/checkout', { body: { product: 'backseat-driver', seats }, headers: { Origin: origin, 'Content-Type': 'application/json' } });
  return { r, data: await r.json() };
}

// ---- Tests

test('checkout picks the price by seat count and returns to the site it came from', async () => {
  const one = await checkout(1);
  assert.equal(one.r.status, 200);
  assert.match(one.data.url, /^https:\/\/checkout\.stripe\.com\//);
  const nine = [...sessions.values()][0];
  assert.equal(nine.price, 'price_99');
  assert.equal(nine.success_url, `${SITE}/#license/{CHECKOUT_SESSION_ID}`);
  await checkout(9);
  await checkout(10, 'http://localhost:8000');
  const [, s9, s10] = [...sessions.values()];
  assert.equal(s9.price, 'price_99');
  assert.equal(s10.price, 'price_7425');
  assert.equal(s10.quantity, 10);
  assert.equal(s10.cancel_url, 'http://localhost:8000/backseat-driver/');
});

test('checkout refuses bad seat counts, unknown products and other origins', async () => {
  for (const product of [undefined, 'nope', '__proto__', 'toString']) {
    const r = await call('POST', '/v1/checkout', { body: { product, seats: 1 }, headers: { Origin: SITE, 'Content-Type': 'application/json' } });
    assert.equal(r.status, 400, String(product));
  }
  for (const seats of [0, -1, 1.5, 'three', 1001, null]) assert.equal((await checkout(seats)).r.status, 400, String(seats));
  assert.equal((await checkout(1, 'https://evil.test')).r.status, 403);
  assert.equal(sessions.size, 0);
});

test('a paid checkout: the success page and the webhook issue one key between them, emailed once', async () => {
  await checkout(3);
  const [s] = sessions.values();
  const early = await call('GET', `/v1/checkout/${s.id}`, { headers: { Origin: SITE } });
  assert.equal(early.status, 202, 'unpaid is pending');
  pay(s.id);
  const page = await (await call('GET', `/v1/checkout/${s.id}`, { headers: { Origin: SITE } })).json();
  assert.equal(page.status, 'active');
  assert.equal(page.seats, 3);
  assert.equal(page.licensee, 'Acme, Inc.');
  assert.equal(page.email, 'buyer@acme.test');
  assert.match(page.key, /^BSD1\./);
  await Promise.all(waits);
  // The webhook arrives after the page already issued it.
  const hook = await call('POST', '/v1/stripe/webhook', await signed({ type: 'checkout.session.completed', data: { object: sessions.get(s.id) } }));
  assert.equal(hook.status, 200);
  const again = await (await call('GET', `/v1/checkout/${s.id}`)).json();
  assert.equal(again.key, page.key, 'same key every time');
  assert.equal(env.DB.raw.prepare('SELECT count(*) n FROM licenses').get().n, 1);
  assert.equal(emails.length, 1);
  assert.equal(emails[0].to[0], 'buyer@acme.test');
  assert.equal(emails[0].from, 'Adam Schaefers <licenses@adamschaefers.com>');
  assert.ok(emails[0].text.includes(page.key));
  assert.ok(emails[0].text.includes("Please don't reply"));
  assert.ok(emails[0].text.includes('https://adamschaefers.com/inquiries/'));
});

test('the webhook alone issues and emails; a failed email answers 500 so Stripe retries', async () => {
  await checkout(12);
  const [s] = sessions.values();
  pay(s.id, { licensee: 'Ελληνική ΑΕ', email: 'x@y.test' });
  failEmail = true;
  const first = await call('POST', '/v1/stripe/webhook', await signed({ type: 'checkout.session.completed', data: { object: s } }));
  assert.equal(first.status, 500);
  const row = env.DB.raw.prepare('SELECT * FROM licenses').get();
  assert.equal(row.emailed_at, 0);
  assert.match(row.email_error, /Resend/);
  failEmail = false;
  const retry = await call('POST', '/v1/stripe/webhook', await signed({ type: 'checkout.session.completed', data: { object: s } }));
  assert.equal(retry.status, 200);
  assert.equal(emails.length, 1);
  const after = env.DB.raw.prepare('SELECT * FROM licenses').get();
  assert.equal(after.seats, 12);
  assert.equal(after.amount_total, 12 * 7425);
  assert.equal(after.email_error, '');
});

test('webhooks with a bad or stale signature are refused', async () => {
  const event = { type: 'checkout.session.completed', data: { object: {} } };
  assert.equal((await call('POST', '/v1/stripe/webhook', await signed(event, 'whsec_wrong'))).status, 400);
  assert.equal((await call('POST', '/v1/stripe/webhook', await signed(event, WEBHOOK_SECRET, Math.floor(Date.now() / 1000) - 3600))).status, 400);
  assert.equal((await call('POST', '/v1/stripe/webhook', { body: JSON.stringify(event) })).status, 400);
});

test("checkouts that aren't license purchases issue nothing", async () => {
  const other = { id: 'cs_test_other00000000', mode: 'payment', payment_status: 'paid', metadata: {}, customer_details: { email: 'a@b.c' } };
  const elsewhere = { ...other, id: 'cs_test_other00000001', metadata: { product: 'something-else', seats: '1' } };
  assert.equal((await call('POST', '/v1/stripe/webhook', await signed({ type: 'checkout.session.completed', data: { object: elsewhere } }))).status, 200);
  assert.equal((await call('POST', '/v1/stripe/webhook', await signed({ type: 'checkout.session.completed', data: { object: other } }))).status, 200);
  assert.equal(env.DB.raw.prepare('SELECT count(*) n FROM licenses').get().n, 0);
  assert.equal((await call('GET', '/v1/checkout/not-a-session')).status, 404);
  assert.equal((await call('GET', '/v1/checkout/cs_test_doesnotexist0000')).status, 404);
});

test('the plugin: status, public key, verify; a full refund revokes, a partial one does not', async () => {
  await checkout(2);
  const [s] = sessions.values();
  pay(s.id);
  const { id, key } = await (await call('GET', `/v1/checkout/${s.id}`)).json();
  assert.deepEqual(await (await call('GET', `/v1/keys/${id}`)).json(), { status: 'active', seats: 2, installs: 0, outgrown: false });
  assert.deepEqual(await (await call('GET', '/v1/keys/lic_nope')).json(), { status: 'unknown' });
  const [pub] = await (await call('GET', '/v1/public-keys')).json();
  assert.equal(pub.kid, 'test-1');
  if (existsSync(pluginChecker)) {
    const { checkKey } = await import(pluginChecker.href);
    const check = await checkKey(key, [pub]);
    assert.equal(check.state, 'valid', "the plugin's checker accepts it");
    assert.equal(check.payload.exp, 0, 'lifetime');
  }
  const ok = await (await call('POST', '/v1/verify', { body: { key } })).json();
  assert.deepEqual([ok.valid, ok.signature, ok.status, ok.seats], [true, 'valid', 'active', 2]);
  const forged = key.slice(0, -4) + (key.endsWith('AAAA') ? 'BBBB' : 'AAAA');
  assert.equal((await (await call('POST', '/v1/verify', { body: { key: forged } })).json()).valid, false);

  const charge = { amount: 19800, amount_refunded: 9900, payment_intent: s.payment_intent };
  await call('POST', '/v1/stripe/webhook', await signed({ type: 'charge.refunded', data: { object: charge } }));
  assert.equal((await (await call('GET', `/v1/keys/${id}`)).json()).status, 'active', 'partial refund keeps it');
  await call('POST', '/v1/stripe/webhook', await signed({ type: 'charge.refunded', data: { object: { ...charge, amount_refunded: 19800 } } }));
  assert.equal((await (await call('GET', `/v1/keys/${id}`)).json()).status, 'revoked');
  assert.equal((await (await call('POST', '/v1/verify', { body: { key } })).json()).valid, false);
});

// ---- Admin

let accessPair;
async function accessToken(claims) {
  // One key pair, like Access's: the Worker caches its public half.
  accessPair ??= await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const pair = accessPair;
  accessKeys = { jwk: { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1' } };
  const enc = (o) => toBase64url(new TextEncoder().encode(JSON.stringify(o)));
  const head = enc({ alg: 'RS256', kid: 'k1' });
  const body = enc({ aud: ['aud123'], iss: 'https://team.cloudflareaccess.com', exp: Math.floor(Date.now() / 1000) + 600, email: 'adam.schaefers@icloud.com', ...claims });
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${toBase64url(sig)}`;
}

test('admin needs a valid Access token for the admin email', async () => {
  assert.equal((await call('GET', '/admin')).status, 403);
  for (const claims of [{ email: 'someone@else.test' }, { aud: ['other'] }, { exp: 1 }, { iss: 'https://evil.cloudflareaccess.com' }]) {
    const token = await accessToken(claims);
    assert.equal((await call('GET', '/admin', { headers: { 'Cf-Access-Jwt-Assertion': token } })).status, 403, JSON.stringify(claims));
  }
  const token = await accessToken({});
  const page = await call('GET', '/admin', { headers: { 'Cf-Access-Jwt-Assertion': token } });
  assert.equal(page.status, 200);
  assert.ok((await page.text()).includes('Licenses <small>TEST</small>'));
});

test('admin: issue by hand, search, revoke, restore, resend; POSTs must come from the admin page', async () => {
  const auth = { 'Cf-Access-Jwt-Assertion': await accessToken({}), Origin: 'https://licenses.test', 'Content-Type': 'application/json' };
  const made = await (await call('POST', '/admin/api/licenses', { headers: auth, body: { email: 'friend@co.test', licensee: 'Friend Co', seats: 5, note: 'comp', send: true } })).json();
  assert.equal(made.emailed, true);
  assert.equal(made.license.source, 'admin');
  assert.equal(emails.length, 1);
  const id = made.license.id;
  const found = await (await call('GET', '/admin/api/licenses?q=friend', { headers: auth })).json();
  assert.equal(found.licenses.length, 1);
  assert.equal((await (await call('GET', '/admin/api/licenses?q=nobody', { headers: auth })).json()).licenses.length, 0);
  assert.equal((await call('POST', `/admin/api/licenses/${id}/revoke`, { headers: { ...auth, Origin: 'https://evil.test' }, body: '{}' })).status, 403);
  await call('POST', `/admin/api/licenses/${id}/revoke`, { headers: auth, body: '{}' });
  assert.equal((await (await call('GET', `/v1/keys/${id}`)).json()).status, 'revoked');
  await call('POST', `/admin/api/licenses/${id}/restore`, { headers: auth, body: '{}' });
  assert.equal((await (await call('GET', `/v1/keys/${id}`)).json()).status, 'active');
  await call('POST', `/admin/api/licenses/${id}/resend`, { headers: auth, body: '{}' });
  assert.equal(emails.length, 2);
  assert.notEqual(emails[0].idempotency, emails[1].idempotency, 'a resend really sends again');
});

// ---- Seats: looking a key up, counting installs, adding seats

async function buy(seats, opts) {
  const before = sessions.size;
  const { data } = await (async () => {
    const r = await call('POST', '/v1/checkout', { body: opts?.key ? { seats, key: opts.key } : { product: 'backseat-driver', seats }, headers: { Origin: SITE, 'Content-Type': 'application/json' } });
    return { data: await r.json() };
  })();
  assert.ok(data.url, JSON.stringify(data));
  const s = [...sessions.values()][before];
  pay(s.id, opts);
  return { session: s, page: await (await call('GET', `/v1/checkout/${s.id}`)).json() };
}

const lookupKey = async (key, origin = SITE) => call('POST', '/v1/lookup', { body: { key }, headers: { Origin: origin, 'Content-Type': 'application/json' } });

test('the plugin check counts installs per license, once each, and reports seats', async () => {
  const { page } = await buy(2);
  for (const install of ['install-aaaa', 'install-bbbb', 'install-aaaa', 'install-cccc']) {
    await call('GET', `/v1/keys/${page.id}?install=${install}`);
  }
  const answer = await (await call('GET', `/v1/keys/${page.id}?install=install-aaaa`)).json();
  assert.deepEqual(answer, { status: 'active', seats: 2, installs: 3, outgrown: false });
  assert.deepEqual(await (await call('GET', `/v1/keys/${page.id}?install=bad id!`)).json(), { status: 'active', seats: 2, installs: 3, outgrown: false }, 'junk ids are ignored');
  assert.deepEqual(await (await call('GET', `/v1/keys/${page.id}`)).json(), { status: 'active', seats: 2, installs: 3, outgrown: false }, 'old plugins send none');
  // Installs not seen for 30 days drop out.
  env.DB.raw.prepare('UPDATE installs SET last_seen = ? WHERE install = ?').run(Date.now() - 31 * 24 * 3600_000, 'install-cccc');
  assert.equal((await (await call('GET', `/v1/keys/${page.id}`)).json()).installs, 2);
});

test('looking a key up: licensee, seats and installs; bad and unknown keys say so', async () => {
  const { page } = await buy(3, { licensee: 'Lookup Co' });
  await call('GET', `/v1/keys/${page.id}?install=install-1111`);
  const found = await (await lookupKey(page.key)).json();
  assert.deepEqual([found.licensee, found.seats, found.installs, found.status, found.isNewest], ['Lookup Co', 3, 1, 'active', true]);
  assert.equal((await lookupKey('BSD1.junk.junk')).status, 400);
  assert.equal((await lookupKey(page.key, 'https://evil.test')).status, 403);
  env.DB.raw.prepare('DELETE FROM licenses').run();
  assert.equal((await lookupKey(page.key)).status, 404);
});

test('adding seats: priced by the new total, one new key for it, the old key still works', async () => {
  const first = await buy(8, { licensee: 'Grow Co', email: 'boss@grow.test' });
  assert.equal(first.session.price, 'price_99');
  const more = await buy(2, { key: first.page.key, email: 'it@grow.test' });
  assert.equal(more.session.price, 'price_7425', '8 + 2 = 10 seats: the volume price');
  assert.equal(more.session.quantity, 2, 'only the added seats are charged');
  assert.equal(more.session.hasLicenseeField, false, 'no licensee question: it is the same license');
  assert.equal(more.page.seats, 10);
  assert.equal(more.page.licensee, 'Grow Co');
  assert.equal(more.page.added, true);
  assert.notEqual(more.page.key, first.page.key);
  if (existsSync(pluginChecker)) {
    const { checkKey } = await import(pluginChecker.href);
    const [pub] = await (await call('GET', '/v1/public-keys')).json();
    assert.equal((await checkKey(more.page.key, [pub])).payload.seats, 10);
  }
  // Both keys answer for the whole family.
  assert.equal((await (await call('GET', `/v1/keys/${first.page.id}`)).json()).seats, 10);
  assert.equal((await (await call('GET', `/v1/keys/${more.page.id}`)).json()).status, 'active');
  const old = await (await lookupKey(first.page.key)).json();
  assert.deepEqual([old.seats, old.keySeats, old.isNewest], [10, 8, false]);
  await Promise.all(waits);
  const addEmail = emails.find((e) => e.to[0] === 'it@grow.test');
  assert.match(addEmail.subject, /now has 10 seats/);
  assert.ok(addEmail.text.includes('Your old key keeps working'));
  // Installs on either key count together.
  await call('GET', `/v1/keys/${first.page.id}?install=install-old1`);
  await call('GET', `/v1/keys/${more.page.id}?install=install-new1`);
  assert.equal((await (await call('GET', `/v1/keys/${first.page.id}`)).json()).installs, 2);
  // Refunding the added seats takes the family back to 8.
  await call('POST', '/v1/stripe/webhook', await signed({ type: 'charge.refunded', data: { object: { amount: 14850, amount_refunded: 14850, payment_intent: more.session.payment_intent } } }));
  assert.deepEqual(await (await call('GET', `/v1/keys/${first.page.id}`)).json(), { status: 'active', seats: 8, installs: 2, outgrown: false });
  // Adding again counts from 8.
  const again = await buy(1, { key: first.page.key });
  assert.equal(again.page.seats, 9);
  assert.equal(again.session.price, 'price_99');
});

test("seats can't be added to a withdrawn or unknown key", async () => {
  const { page, session } = await buy(1);
  await call('POST', '/v1/stripe/webhook', await signed({ type: 'charge.refunded', data: { object: { amount: 9900, amount_refunded: 9900, payment_intent: session.payment_intent } } }));
  const r = await call('POST', '/v1/checkout', { body: { seats: 1, key: page.key }, headers: { Origin: SITE, 'Content-Type': 'application/json' } });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /withdrawn/);
  const junk = await call('POST', '/v1/checkout', { body: { seats: 1, key: 'BSD1.x.y' }, headers: { Origin: SITE, 'Content-Type': 'application/json' } });
  assert.equal(junk.status, 400);
});

// ---- Lost keys

const recoverFor = (email, origin = SITE) => call('POST', '/v1/recover', { body: { email, turnstile: 'human' }, headers: { Origin: origin, 'Content-Type': 'application/json' } });

test('recovery emails every license on file for an address, newest key each, never more than every 30 seconds', async () => {
  const a = await buy(3, { licensee: 'First Co', email: 'Owner@Corp.test' });
  const a2 = await buy(2, { key: a.page.key, email: 'it@corp.test' });          // seats added: a new key for 5
  const b = await buy(1, { licensee: 'Second Co', email: 'owner@corp.test' });  // bought again instead of adding
  const gone = await buy(1, { licensee: 'Refunded Co', email: 'owner@corp.test' });
  await call('POST', '/v1/stripe/webhook', await signed({ type: 'charge.refunded', data: { object: { amount: 9900, amount_refunded: 9900, payment_intent: gone.session.payment_intent } } }));
  await Promise.all(waits);
  emails.length = 0;

  const r = await recoverFor('  OWNER@corp.test ');
  assert.equal(r.status, 200);
  const said = (await r.json()).message;
  assert.equal(emails.length, 1);
  const [mail] = emails;
  assert.equal(mail.to[0], 'OWNER@corp.test');
  assert.equal(mail.subject, 'Your 2 license keys');
  assert.ok(mail.text.includes(a2.page.key), 'the newest key of the first license');
  assert.ok(!mail.text.includes(a.page.key), 'not its older key');
  assert.ok(mail.text.includes(b.page.key), 'the second license');
  assert.ok(!mail.text.includes(gone.page.key), 'not a refunded one');
  assert.ok(mail.text.includes('Seats: 5'));
  assert.ok(mail.text.includes('https://adamschaefers.com/inquiries/'));

  // The add-on buyer's address finds the same license too.
  emails.length = 0;
  await recoverFor('it@corp.test');
  assert.equal(emails.length, 1);
  assert.ok(emails[0].text.includes(a2.page.key));

  // Asking again straight away: the same answer, no second email.
  emails.length = 0;
  const again = await recoverFor('owner@corp.test');
  assert.equal((await again.json()).message, said);
  assert.equal(emails.length, 0);
  // 30 seconds later it sends again.
  env.DB.raw.prepare('UPDATE recoveries SET sent_at = sent_at - 30001').run();
  await recoverFor('owner@corp.test');
  assert.equal(emails.length, 1);
});

test("recovery answers the same for an address with no keys, and refuses junk and other sites", async () => {
  await buy(1, { email: 'real@co.test' });
  await Promise.all(waits);
  emails.length = 0;
  const known = await (await recoverFor('real@co.test')).json();
  emails.length = 0;
  const unknown = await (await recoverFor('nobody@co.test')).json();
  assert.deepEqual(unknown, known, 'no way to tell who bought');
  assert.equal(emails.length, 0);
  assert.equal((await recoverFor('not an email')).status, 400);
  assert.equal((await recoverFor('real@co.test', 'https://evil.test')).status, 403);
  // A failed send lets them try again at once.
  env.DB.raw.prepare('DELETE FROM recoveries').run();
  failEmail = true;
  assert.equal((await recoverFor('real@co.test')).status, 502);
  failEmail = false;
  assert.equal((await recoverFor('real@co.test')).status, 200);
  assert.equal(emails.length, 1);
});

test('recovery needs a Turnstile token from the store, from the right site; buying and adding seats leave bots to Stripe Checkout', async () => {
  const post = (path, body) => call('POST', path, { body, headers: { Origin: SITE, 'Content-Type': 'application/json' } });
  for (const turnstile of [undefined, '', 'bot', 'wrong-site']) {
    assert.equal((await post('/v1/recover', { email: 'a@b.test', turnstile })).status, 403, String(turnstile));
  }
  assert.equal(emails.length, 0, 'no email was sent');
  // Checkout has its own CAPTCHA; the page here only asks for one.
  assert.equal(sessions.size, 0);
  assert.equal((await post('/v1/checkout', { product: 'backseat-driver', seats: 1 })).status, 200);
  assert.equal(sessions.size, 1, 'a Checkout was made, with no token');
});

// ---- Hardening (2026-10-11 audit)

test('EMAIL_ONLY_TO (a test copy) emails only those addresses, and skipping is not a failure Stripe would retry', async () => {
  env.EMAIL_ONLY_TO = 'owner@allowed.test';
  const stranger = await buy(1, { email: 'stranger@else.test' });
  const hook = await call('POST', '/v1/stripe/webhook', await signed({ type: 'checkout.session.completed', data: { object: stranger.session } }));
  await Promise.all(waits);
  assert.equal(hook.status, 200);
  assert.equal(emails.length, 0, 'nothing went to the stranger');
  assert.match(env.DB.raw.prepare('SELECT email_error FROM licenses WHERE id = ?').get(stranger.page.id).email_error, /EMAIL_ONLY_TO/);
  await buy(1, { email: 'Owner@Allowed.test' });
  await Promise.all(waits);
  assert.equal(emails.length, 1, 'the allowed address still gets its key');
  emails.length = 0;
  assert.equal((await recoverFor('stranger@else.test')).status, 200);
  assert.equal(emails.length, 0, 'recovery skips strangers too');
  const auth = { 'Cf-Access-Jwt-Assertion': await accessToken({}), Origin: 'https://licenses.test', 'Content-Type': 'application/json' };
  assert.equal((await call('POST', `/admin/api/licenses/${stranger.page.id}/resend`, { headers: auth, body: '{}' })).status, 400);
  assert.equal(emails.length, 0);
});

test('recovery: at most 5 a day per address and 40 a day in all', async () => {
  await buy(1, { email: 'daily@co.test' });
  await Promise.all(waits);
  emails.length = 0;
  for (let i = 0; i < 7; i++) {
    await recoverFor('daily@co.test');
    env.DB.raw.prepare('UPDATE recoveries SET sent_at = sent_at - 30001').run();  // past the 30 seconds each time
  }
  assert.equal(emails.length, 5);
  // A new day starts the count again.
  env.DB.raw.prepare("UPDATE recoveries SET day = '2000-01-01'").run();
  await recoverFor('daily@co.test');
  assert.equal(emails.length, 6);
  // 40 sent today across all addresses: no more for anyone.
  env.DB.raw.prepare("INSERT INTO recoveries (email, sent_at, day, day_count) VALUES ('busy@else.test', 0, ?, 40)").run(new Date().toISOString().slice(0, 10));
  env.DB.raw.prepare('UPDATE recoveries SET sent_at = 0').run();
  await recoverFor('daily@co.test');
  assert.equal(emails.length, 6);
});

test('installs: a license keeps at most max(50, 3 x seats), stale ones drop out, and the check is rate-limited', async () => {
  const { page } = await buy(2);
  for (let i = 0; i < 60; i++) await call('GET', `/v1/keys/${page.id}?install=flood-install-${i}`);
  assert.equal(env.DB.raw.prepare('SELECT count(*) n FROM installs').get().n, 50, 'capped');
  assert.equal((await (await call('GET', `/v1/keys/${page.id}?install=flood-install-0`)).json()).installs, 50, 'a known install still checks in');
  env.DB.raw.prepare("UPDATE installs SET last_seen = ? WHERE install LIKE 'flood-install-1%'").run(Date.now() - 31 * 24 * 3600_000);
  await call('GET', `/v1/keys/${page.id}?install=fresh-install-1`);
  assert.equal(env.DB.raw.prepare("SELECT count(*) n FROM installs WHERE install = 'fresh-install-1'").get().n, 1, 'room again once stale ones are pruned');
  env.LIMIT = { limit: async () => ({ success: false }) };
  assert.equal((await call('GET', `/v1/keys/${page.id}`)).status, 429);
  delete env.LIMIT;
});

test('a lost chargeback revokes the key; a won one does not', async () => {
  const a = await buy(1);
  const b = await buy(1);
  await call('POST', '/v1/stripe/webhook', await signed({ type: 'charge.dispute.closed', data: { object: { status: 'won', payment_intent: a.session.payment_intent } } }));
  assert.equal((await (await call('GET', `/v1/keys/${a.page.id}`)).json()).status, 'active');
  await call('POST', '/v1/stripe/webhook', await signed({ type: 'charge.dispute.closed', data: { object: { status: 'lost', payment_intent: b.session.payment_intent } } }));
  assert.equal((await (await call('GET', `/v1/keys/${b.page.id}`)).json()).status, 'revoked');
  assert.match(env.DB.raw.prepare('SELECT note FROM licenses WHERE id = ?').get(b.page.id).note, /chargeback lost/);
});

test('a paid Checkout that cannot become a key emails the owner, once', async () => {
  const broken = { id: 'cs_test_brokenbroken0001', mode: 'payment', payment_status: 'paid', metadata: { product: 'backseat-driver', seats: '2', add_to: 'lic_gone' },
    customer_details: { email: 'buyer@co.test' }, payment_intent: 'pi_broken' };
  for (let i = 0; i < 2; i++) {
    const r = await call('POST', '/v1/stripe/webhook', await signed({ type: 'checkout.session.completed', data: { object: broken } }));
    assert.equal(r.status, 200);
  }
  const alerts = emails.filter((e) => e.to[0] === env.ADMIN_EMAIL);
  assert.equal(alerts.length, 2, 'sent per event; Resend drops the repeat by its idempotency key');
  assert.equal(alerts[0].idempotency, alerts[1].idempotency);
  assert.match(alerts[0].subject, /Paid, but no license key/);
  assert.ok(alerts[0].text.includes('pi_broken'));
});

test('adding seats to a license refunded meanwhile covers only the seats just paid for', async () => {
  const first = await buy(3);
  const before = sessions.size;
  await call('POST', '/v1/checkout', { body: { seats: 2, key: first.page.key }, headers: { Origin: SITE, 'Content-Type': 'application/json' } });
  const addOn = [...sessions.values()][before];
  await call('POST', '/v1/stripe/webhook', await signed({ type: 'charge.refunded', data: { object: { amount: 29700, amount_refunded: 29700, payment_intent: first.session.payment_intent } } }));
  pay(addOn.id);
  const page = await (await call('GET', `/v1/checkout/${addOn.id}`)).json();
  assert.equal(page.seats, 2);
  assert.match(env.DB.raw.prepare('SELECT note FROM licenses WHERE id = ?').get(page.id).note, /withdrawn license/);
});

test('malformed % sequences are not found, not errors', async () => {
  assert.equal((await call('GET', '/v1/checkout/%ZZ')).status, 404);
  assert.deepEqual(await (await call('GET', '/v1/keys/%E0%A4%A')).json(), { status: 'unknown' });
});

// ---- Sale notices

test('the owner hears of each sale once, however many paths reach it', async () => {
  const { session, page } = await buy(12, { licensee: 'Acme, Inc.', email: 'buyer@acme.test' });
  await Promise.all(waits);
  await call('POST', '/v1/stripe/webhook', await signed({ type: 'checkout.session.completed', data: { object: session } }));
  await call('GET', `/v1/checkout/${session.id}`);
  await Promise.all(waits);
  assert.equal(notices.length, 1);
  const [notice] = notices;
  assert.equal(notice.to[0], 'adam.schaefers@icloud.com');
  assert.equal(notice.subject, '[test] Sale: Backseat Driver, 12 seats, $891.00 (Acme, Inc.)');
  assert.ok(notice.text.includes('Buyer: buyer@acme.test'));
  assert.ok(notice.text.includes(page.id));
  assert.ok(notice.text.includes('Purchase number: 1'));
  assert.ok(notice.text.includes(`/payments/${session.payment_intent}`));
  assert.ok(notice.text.includes('https://licenses.test/admin'));
  // Adding seats is a sale too, said as such.
  await buy(2, { key: page.key, email: 'it@acme.test' });
  await Promise.all(waits);
  assert.equal(notices.length, 2);
  assert.match(notices[1].subject, /Sale: Backseat Driver, 2 more seats \(14 in all\), \$148\.50 \(Acme, Inc\.\)/);
  assert.ok(notices[1].text.includes('Purchase number: 2'));
});

test('no notice for a key issued by hand; a notice that fails is tried again', async () => {
  const auth = { 'Cf-Access-Jwt-Assertion': await accessToken({}), Origin: 'https://licenses.test', 'Content-Type': 'application/json' };
  await call('POST', '/admin/api/licenses', { headers: auth, body: { email: 'comp@co.test', licensee: 'Comp Co', seats: 1, send: false } });
  assert.equal(notices.length, 0);
  failNotice = true;
  const { session } = await buy(1);
  await Promise.all(waits);
  assert.equal(notices.length, 0);
  assert.equal(env.DB.raw.prepare('SELECT notified_at FROM licenses WHERE stripe_session = ?').get(session.id).notified_at, 0, 'released');
  failNotice = false;
  await call('POST', '/v1/stripe/webhook', await signed({ type: 'checkout.session.completed', data: { object: session } }));
  assert.equal(notices.length, 1);
});

test('after a signing-key rotation, keys the old key signed still work when it is in OLD_PUBLIC_KEYS', async () => {
  const { loadSigningKey, signKey } = await import('../src/keys.js');
  const oldPem = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
  const old = await loadSigningKey('old-1', oldPem);
  const { key } = await signKey(old, 'BSD1', { id: 'lic_oldkeyoldkey0001', to: 'Old Co', seats: 4, iat: 1 });
  env.DB.raw.prepare("INSERT INTO licenses (id, root_id, key, licensee, email, seats, issued_at, source) VALUES ('lic_oldkeyoldkey0001', 'lic_oldkeyoldkey0001', ?, 'Old Co', 'old@co.test', 4, 1, 'stripe')").run(key);
  assert.equal((await lookupKey(key)).status, 400, 'unknown signer without it');
  env.OLD_PUBLIC_KEYS = JSON.stringify([old.publicKey]);
  const found = await (await lookupKey(key)).json();
  assert.deepEqual([found.licensee, found.seats], ['Old Co', 4]);
  assert.equal((await (await call('POST', '/v1/verify', { body: { key } })).json()).valid, true);
  assert.deepEqual((await (await call('GET', '/v1/public-keys')).json()).map((k) => k.kid), ['test-1', 'old-1']);
  delete env.OLD_PUBLIC_KEYS;
});

// ---- Never a false alarm for a paying customer (2026-10-11)

test('refunding only an add-on never withdraws the license: its keys stay active with the seats still paid for', async () => {
  const base = await buy(8, { licensee: 'Keep Co' });
  const more = await buy(2, { key: base.page.key });
  await call('POST', '/v1/stripe/webhook', await signed({ type: 'charge.refunded', data: { object: { amount: 14850, amount_refunded: 14850, payment_intent: more.session.payment_intent } } }));
  for (const id of [base.page.id, more.page.id]) {
    const answer = await (await call('GET', `/v1/keys/${id}`)).json();
    assert.deepEqual([answer.status, answer.seats], ['active', 8], id);
  }
  assert.equal((await (await call('POST', '/v1/verify', { body: { key: more.page.key } })).json()).valid, true);
  // Refunding the original too ends it.
  await call('POST', '/v1/stripe/webhook', await signed({ type: 'charge.refunded', data: { object: { amount: 79200, amount_refunded: 79200, payment_intent: base.session.payment_intent } } }));
  assert.equal((await (await call('GET', `/v1/keys/${more.page.id}`)).json()).status, 'revoked');
});

test('withdrawing and restoring from admin act on the whole license', async () => {
  const base = await buy(3);
  const more = await buy(1, { key: base.page.key });
  const auth = { 'Cf-Access-Jwt-Assertion': await accessToken({}), Origin: 'https://licenses.test', 'Content-Type': 'application/json' };
  await call('POST', `/admin/api/licenses/${more.page.id}/revoke`, { headers: auth, body: '{}' });
  for (const id of [base.page.id, more.page.id]) assert.equal((await (await call('GET', `/v1/keys/${id}`)).json()).status, 'revoked');
  await call('POST', `/admin/api/licenses/${base.page.id}/restore`, { headers: auth, body: '{}' });
  for (const id of [base.page.id, more.page.id]) assert.equal((await (await call('GET', `/v1/keys/${id}`)).json()).status, 'active');
});

test('outgrown and the seats email: only clearly over (more than 2x and 5+ over) for 14 days; the email to the latest buyer, at most every 90 days', async () => {
  const base = await buy(2, { licensee: 'Busy Co', email: 'lead@busy.test' });
  const more = await buy(1, { key: base.page.key, email: 'it@busy.test' });   // 3 seats now
  await Promise.all(waits);
  emails.length = 0;
  const check = async (n, from = 0) => {
    for (let i = from; i < from + n; i++) await call('GET', `/v1/keys/${base.page.id}?install=busy-install-${i}`);
    await Promise.all(waits);
  };
  const rootRow = () => env.DB.raw.prepare('SELECT over_since, nudged_at FROM licenses WHERE id = ?').get(base.page.id);
  const isOutgrown = async (key = base.page.id) => (await (await call('GET', `/v1/keys/${key}`)).json()).outgrown;
  // 3 seats: 6 installs is twice, not more than twice; 7 is more than twice but only 4 over; 8 is clearly over.
  await check(7);
  assert.equal(rootRow().over_since, 0, '7 installs on 3 seats is not clearly over');
  await check(1, 7);
  assert.ok(rootRow().over_since > 0, '8 is: the clock starts');
  assert.equal(emails.length, 0, 'but nothing is sent yet');
  assert.equal(await isOutgrown(), false, 'and the apps show nothing yet');
  // Dropping back (installs not seen for 14 days fall away) stops the clock.
  env.DB.raw.prepare("UPDATE installs SET last_seen = ? WHERE install IN ('busy-install-0', 'busy-install-1', 'busy-install-2')").run(Date.now() - 15 * 24 * 3600_000);
  await check(1, 3);
  assert.equal(rootRow().over_since, 0, 'a spike that passes resets it');
  // Over again, and for 15 days: one email, to whoever bought last.
  await check(3, 20);
  env.DB.raw.prepare('UPDATE licenses SET over_since = ? WHERE id = ?').run(Date.now() - 15 * 24 * 3600_000, base.page.id);
  await check(1, 20);
  assert.equal(await isOutgrown(), true, 'outgrown: the apps ask for more seats');
  assert.equal(await isOutgrown(more.page.id), true, 'on every key of the license');
  assert.equal(emails.length, 1);
  assert.equal(emails[0].to[0], 'it@busy.test');
  assert.equal(emails[0].subject, 'Your Backseat Driver seats');
  assert.match(emails[0].text, /covers 3 seats\. Over the last two weeks, about 8 installs/);
  assert.ok(emails[0].text.includes('more than one machine'));
  assert.ok(emails[0].text.includes('a small note asking for them'));
  // Not again for 90 days, however often they check.
  await check(5, 20);
  assert.equal(emails.length, 1);
  env.DB.raw.prepare('UPDATE licenses SET nudged_at = ? WHERE id = ?').run(Date.now() - 91 * 24 * 3600_000, base.page.id);
  await check(1, 20);
  assert.equal(emails.length, 2, 'after 90 days, once more');
  // Adding seats ends it at the next check: 10 installs on 6 seats is not clearly over.
  env.DB.raw.prepare("UPDATE licenses SET seats = 6 WHERE id = ?").run(more.page.id);
  assert.equal(await isOutgrown(), false, 'enough seats now');
  env.DB.raw.prepare("UPDATE licenses SET seats = 1 WHERE id = ?").run(more.page.id);
  // Never for a withdrawn license.
  env.DB.raw.prepare('UPDATE licenses SET revoked_at = 1, nudged_at = 0').run();
  await check(1, 20);
  assert.equal(emails.length, 2);
  assert.equal(await isOutgrown(), false, 'a withdrawn license is not outgrown');
});
