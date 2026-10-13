/* The Inquiries form's handler (src/contact.ts), adamschaefers.com's alone: until
   2026-10-12 it served ../enchant.games' Press page too, which now has its own. POST only.
   Rate limits per IP, verifies the Turnstile token, then emails the message to CONTACT_TO
   (a verified Email Routing destination). TURNSTILE_SECRET is a Worker secret; everything
   else is in wrangler.jsonc. */

interface Env {
  CONTACT_TO: string;
  TURNSTILE_HOSTNAME: string;
  TURNSTILE_SECRET: string;
  SEND_LIMIT: RateLimit;
  EMAIL: SendEmail;
}

// The one site that posts here, from another origin (the Worker is at contact-api.), so
// it answers with CORS for that origin alone.
const ORIGIN = 'https://adamschaefers.com';
const FROM = { email: 'contact-form@adamschaefers.com', name: 'adamschaefers.com contact form' };

function cors() {
  return {
    'Access-Control-Allow-Origin': ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors() },
  });
}

export default {
  async fetch(request: Request, env: Env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
    if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);

    const origin = request.headers.get('Origin');
    if (origin && origin !== ORIGIN) return json({ ok: false, error: 'Bad origin.' }, 403);

    // Throttle before Turnstile and the send so a flood can't burn either quota.
    const ip = request.headers.get('CF-Connecting-IP') || '';
    const { success } = await env.SEND_LIMIT.limit({ key: ip });
    if (!success) return json({ ok: false, error: 'Too many messages. Wait a minute and try again.' }, 429);

    let form;
    try {
      form = await request.formData();
    } catch {
      return json({ ok: false, error: 'Bad request.' }, 400);
    }

    // Honeypot: people never see this field, bots fill it. Pretend success.
    if (form.get('website')) return json({ ok: true }, 200);

    const name = String(form.get('name') || '').replace(/[\r\n\t]+/g, ' ').slice(0, 200).trim();
    const email = String(form.get('email') || '').replace(/[\r\n\t]+/g, '').slice(0, 200).trim();
    const message = String(form.get('message') || '').slice(0, 5000).trim();
    if (!message) return json({ ok: false, error: 'The message is empty.' }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ ok: false, error: 'Please enter a valid email address.' }, 400);
    }

    const verify = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: new URLSearchParams({
        secret: env.TURNSTILE_SECRET,
        response: String(form.get('cf-turnstile-response') || ''),
        remoteip: ip,
      }),
    });
    const verdict: { success: boolean; hostname?: string } = await verify.json();
    if (!verdict.success || verdict.hostname !== env.TURNSTILE_HOSTNAME) {
      return json({ ok: false, error: 'Verification failed. Reload the page and try again.' }, 403);
    }

    const send = {
      to: env.CONTACT_TO,
      from: FROM,
      subject: 'adamschaefers.com: message from ' + (name || 'anonymous'),
      text: 'Name: ' + (name || '(none given)') + '\nEmail: ' + email + '\n\n' + message + '\n',
      replyTo: { email, name: name || undefined } as EmailAddress,
    };

    try {
      await env.EMAIL.send(send);
    } catch (err) {
      console.log(JSON.stringify({ event: 'send_failed', error: String(err) }));
      return json({ ok: false, error: 'Could not deliver the message. Please try again later.' }, 502);
    }
    return json({ ok: true }, 200);
  },
} satisfies ExportedHandler<Env>;
