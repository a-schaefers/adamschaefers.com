/* Contact form handler for adamschaefers.com. POST only.
   Rate limits per IP, verifies the Turnstile token, then emails the message
   to CONTACT_TO (a verified Email Routing destination). TURNSTILE_SECRET is a
   Worker secret; everything else is in wrangler.jsonc. */

const ALLOWED_ORIGINS = ['https://adamschaefers.com'];
const FROM = { email: 'contact-form@adamschaefers.com', name: 'adamschaefers.com contact form' };

function cors(request) {
  const origin = request.headers.get('Origin');
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function json(body, status, request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors(request) },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request) });
    if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405, request);

    const origin = request.headers.get('Origin');
    if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ ok: false, error: 'Bad origin.' }, 403, request);

    // Throttle before Turnstile and the send so a flood can't burn either quota.
    const ip = request.headers.get('CF-Connecting-IP') || '';
    const { success } = await env.SEND_LIMIT.limit({ key: ip });
    if (!success) return json({ ok: false, error: 'Too many messages. Wait a minute and try again.' }, 429, request);

    let form;
    try {
      form = await request.formData();
    } catch {
      return json({ ok: false, error: 'Bad request.' }, 400, request);
    }

    // Honeypot: people never see this field, bots fill it. Pretend success.
    if (form.get('website')) return json({ ok: true }, 200, request);

    const name = String(form.get('name') || '').replace(/[\r\n\t]+/g, ' ').slice(0, 200).trim();
    const email = String(form.get('email') || '').replace(/[\r\n\t]+/g, '').slice(0, 200).trim();
    const message = String(form.get('message') || '').slice(0, 5000).trim();
    if (!message) return json({ ok: false, error: 'The message is empty.' }, 400, request);

    const verify = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: new URLSearchParams({
        secret: env.TURNSTILE_SECRET,
        response: String(form.get('cf-turnstile-response') || ''),
        remoteip: ip,
      }),
    });
    const verdict = await verify.json();
    const hosts = String(env.TURNSTILE_HOSTNAMES || '').split(',').map((h) => h.trim()).filter(Boolean);
    if (!verdict.success || (hosts.length && !hosts.includes(verdict.hostname))) {
      return json({ ok: false, error: 'Verification failed. Reload the page and try again.' }, 403, request);
    }

    const send = {
      to: env.CONTACT_TO,
      from: FROM,
      subject: 'adamschaefers.com: message from ' + (name || 'anonymous'),
      text: 'Name: ' + (name || '(none given)') + '\nEmail: ' + (email || '(none given)') + '\n\n' + message + '\n',
    };
    // Reply-To the sender when the address looks plausible, so answering is one click.
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) send.replyTo = { email, name: name || undefined };

    try {
      await env.EMAIL.send(send);
    } catch (err) {
      console.log(JSON.stringify({ event: 'send_failed', error: String(err) }));
      return json({ ok: false, error: 'Could not deliver the message. Please try again later.' }, 502, request);
    }
    return json({ ok: true }, 200, request);
  },
};
