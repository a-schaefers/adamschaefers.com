/* The little of Stripe's API this Worker uses, over fetch: form-encoded calls
   with the restricted key STRIPE_SECRET_KEY, and webhook signature checks with
   STRIPE_WEBHOOK_SECRET (both Worker secrets). */

const API = 'https://api.stripe.com/v1/';

/** { a: { b: [1] } } -> a[b][0]=1, Stripe's form encoding. */
function encode(params, prefix = '', out = new URLSearchParams()) {
  for (const [name, value] of Object.entries(params)) {
    const field = prefix ? `${prefix}[${name}]` : name;
    if (value === undefined || value === null) continue;
    if (typeof value === 'object') encode(value, field, out);
    else out.append(field, String(value));
  }
  return out;
}

export async function stripe(env, method, path, params) {
  const response = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    ...(params ? { body: encode(params) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Stripe ${method} ${path}: ${data.error?.message || response.status}`);
  return data;
}

function hex(bytes) {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Compares in time that doesn't depend on where the strings differ. */
function sameText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The event in a webhook body, if its Stripe-Signature header is genuine and recent, else null. */
export async function webhookEvent(body, header, secret, now = Date.now(), tolerance = 300) {
  if (!header || !secret) return null;
  const parts = header.split(',').map((part) => part.split('='));
  const t = parts.find(([k]) => k === 't')?.[1];
  const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !signatures.length || Math.abs(now / 1000 - Number(t)) > tolerance) return null;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`)));
  if (!signatures.some((s) => sameText(s, expected))) return null;
  return JSON.parse(body);
}
