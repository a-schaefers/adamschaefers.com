/* The license key email, sent through Resend with the send-only key
   RESEND_API_KEY (a Worker secret) from FROM_EMAIL (licenses@adamschaefers.com).
   That address only sends: nothing receives mail for it, so the email says not
   to reply and points to the contact form instead.

   EMAIL_ONLY_TO, when set (it isn't, live), limits who gets mail at all: a test copy
   of this Worker, where anyone could buy with test cards, would email only those
   addresses rather than strangers from this domain. */

import { productOf } from './products.js';

export const SUPPORT = 'https://adamschaefers.com/inquiries/';

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function keyEmail(license) {
  const product = productOf(license.product) ?? productOf('backseat-driver');
  const seats = `${license.seats} seat${license.seats === 1 ? '' : 's'}`;
  const page = `https://adamschaefers.com/${product.page}`;
  // A key from adding seats is a new key for the whole family: say so, and that the old one still works.
  const added = Boolean(license.root_id && license.root_id !== license.id);
  const thanks = added
    ? `Thank you for adding seats! Your ${product.license} now covers ${seats}, and this is its new key. Your old key keeps working, but use this one from now on.`
    : `Thank you for buying a ${product.license}!`;
  const use = `${product.howToUse(seats)} Need more seats later? Paste the key at ${page}`;
  const text = `${thanks} Please don't reply to this email: nobody reads this address. If you need anything, use the contact form at ${SUPPORT}

Licensee: ${license.licensee}
Seats: ${license.seats}

Your license key:

${license.key}

${use}

The license is for life. Keep this email: the key is also your proof of purchase.

Adam Schaefers
https://adamschaefers.com

--
This is an automated email and replies aren't read. Questions or problems: ${SUPPORT}
`;
  // No colors or backgrounds anywhere: the mail app's own light or dark theme stays readable.
  const html = `<div>
<p>${escape(thanks)} Please don't reply to this email: nobody reads this address. If you need anything, use the <a href="${SUPPORT}">contact form</a>.</p>
<p>Licensee: <b>${escape(license.licensee)}</b><br>Seats: <b>${license.seats}</b></p>
<p>Your license key:</p>
<pre style="white-space:pre-wrap;word-break:break-all;font-family:ui-monospace,Menlo,Consolas,monospace">${escape(license.key)}</pre>
<p>${escape(product.howToUse(seats))} Need more seats later? Paste the key on the <a href="${page}">store page</a>.</p>
<p>The license is for life. Keep this email: the key is also your proof of purchase.</p>
<p>Adam Schaefers<br><a href="https://adamschaefers.com">adamschaefers.com</a></p>
<hr>
<p><small>This is an automated email and replies aren't read. Questions or problems? Use the <a href="${SUPPORT}">contact form</a>.</small></p>
</div>`;
  return { subject: added ? `Your ${product.name} license now has ${seats}` : `Your ${product.name} license key`, text, html };
}

/** Sends the key to license.email; false when EMAIL_ONLY_TO skipped it. idempotency stops a retried request sending twice. */
export async function sendKeyEmail(env, license, idempotency) {
  return sendEmail(env, license.email, keyEmail(license), idempotency);
}

/** Every key on file for an address (one per license: its newest), for someone who lost theirs. */
export function recoveryEmail(email, licenses) {
  const blocks = licenses.map((l) => {
    const product = productOf(l.product) ?? productOf('backseat-driver');
    return { product, l, seats: `${l.seats} seat${l.seats === 1 ? '' : 's'}` };
  });
  const many = licenses.length > 1;
  const intro = `Here ${many ? `are the ${licenses.length} license keys` : 'is the license key'} on file for ${email}, as asked for on adamschaefers.com. Please don't reply to this email: nobody reads this address.`;
  const text = `${intro}

${blocks.map(({ product, l, seats }) => `${product.license}
Licensee: ${l.licensee}
Seats: ${l.seats}

${l.key}

${product.howToUse(seats)}`).join('\n\n----\n\n')}

${many ? 'Each key is the newest for its license and covers all its seats. ' : ''}Older keys you may have keep working too. Anything else, or didn't ask for this? Use the contact form: ${SUPPORT}

Adam Schaefers
https://adamschaefers.com

--
This is an automated email and replies aren't read. Questions or problems: ${SUPPORT}
`;
  const html = `<div>
<p>${escape(intro)}</p>
${blocks.map(({ product, l, seats }) => `<p><b>${escape(product.license)}</b><br>Licensee: <b>${escape(l.licensee)}</b><br>Seats: <b>${l.seats}</b></p>
<pre style="white-space:pre-wrap;word-break:break-all;font-family:ui-monospace,Menlo,Consolas,monospace">${escape(l.key)}</pre>
<p>${escape(product.howToUse(seats))}</p>`).join('\n<hr>\n')}
<p>${many ? 'Each key is the newest for its license and covers all its seats. ' : ''}Older keys you may have keep working too. Anything else, or didn't ask for this? Use the <a href="${SUPPORT}">contact form</a>.</p>
<p>Adam Schaefers<br><a href="https://adamschaefers.com">adamschaefers.com</a></p>
<hr>
<p><small>This is an automated email and replies aren't read. Questions or problems? Use the <a href="${SUPPORT}">contact form</a>.</small></p>
</div>`;
  return { subject: many ? `Your ${licenses.length} license keys` : 'Your license key', text, html };
}

/**
 * The one reminder about seats, to the license's latest buyer, sent only when its installs
 * have clearly outnumbered its seats for two weeks (src/index.js), while the app shows its
 * users a small note asking the same. The key keeps working; the likely harmless reason
 * comes first.
 */
export function seatsEmail({ product: id, licensee, seats, installs }) {
  const product = productOf(id) ?? productOf('backseat-driver');
  const page = `https://adamschaefers.com/${product.page}`;
  const covers = `${seats} seat${seats === 1 ? '' : 's'}`;
  const text = `Hi,

Your ${product.license} for ${licensee} covers ${covers}. Over the last two weeks, about ${installs} installs have checked in with its key.

That can simply be people using it on more than one machine, a laptop and a desktop say, and then there's nothing to do. If more people use it now than when you bought it, you can add seats any time: paste your key at ${page}. Your key keeps working either way. Until there are seats enough, ${product.name} shows the people using it a small note asking for them, which goes away once they are added.

Installs are counted by an anonymous number each one picks at random, nothing else, and we won't write about this more than once every three months. Questions, or think we've got it wrong? ${SUPPORT}

Thank you for supporting ${product.name}!
Adam Schaefers

--
This is an automated email and replies aren't read. Questions or problems: ${SUPPORT}
`;
  return { subject: `Your ${product.name} seats`, text };
}

/** An amount in a currency's minor unit, for people: 89100 usd -> $891.00. */
export function money(amount, currency = 'usd') {
  const format = new Intl.NumberFormat('en-US', { style: 'currency', currency: String(currency).toUpperCase() });
  return format.format(Number(amount || 0) / 10 ** format.resolvedOptions().maximumFractionDigits);
}

/** The owner's notice of a sale: plain text, everything needed at a glance, and where to look closer. */
export function saleEmail(license, { number, origin, dashboard, mode }) {
  const product = productOf(license.product) ?? productOf('backseat-driver');
  const added = Boolean(license.root_id && license.root_id !== license.id);
  const bought = added ? Number(/adds (\d+)/.exec(license.note)?.[1] || 0) : license.seats;
  const what = added
    ? `${bought} more seat${bought === 1 ? '' : 's'} (${license.seats} in all)`
    : `${license.seats} seat${license.seats === 1 ? '' : 's'}`;
  const paid = license.amount_total == null ? '?' : money(license.amount_total, license.currency || 'usd');
  const label = mode ? `[${mode.toLowerCase()}] ` : '';
  const text = `You made a sale${mode ? ` (${mode.toLowerCase()}: a test purchase, no real money)` : ''}.

Product: ${product.license}
Licensee: ${license.licensee}
Buyer: ${license.email}
Seats: ${what}${added ? ', added to an existing license' : ', a new license'}
Paid: ${paid}${license.currency ? ` ${String(license.currency).toUpperCase()}` : ''}
License: ${license.id}
Purchase number: ${number} of ${product.name}

${license.stripe_payment_intent && dashboard ? `Payment in Stripe: ${dashboard}/payments/${license.stripe_payment_intent}\n` : ''}Every license: ${origin}/admin
`;
  return { subject: `${label}Sale: ${product.name}, ${what}, ${paid} (${license.licensee})`, text };
}


export function mayEmail(env, to) {
  const only = String(env.EMAIL_ONLY_TO || '').split(',').map((a) => a.trim().toLowerCase()).filter(Boolean);
  return !only.length || only.includes(String(to).trim().toLowerCase());
}

/** Sends any built email ({ subject, text, html }) to one address through Resend: true, or false when EMAIL_ONLY_TO skipped it. */
export async function sendEmail(env, to, message, idempotency) {
  if (!mayEmail(env, to)) {
    console.log(JSON.stringify({ event: 'email_skipped', reason: 'EMAIL_ONLY_TO' }));
    return false;
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotency },
    body: JSON.stringify({ from: env.FROM_EMAIL, to: [to], ...message }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(`Resend: ${data.message || response.status}`);
  }
  return true;
}
