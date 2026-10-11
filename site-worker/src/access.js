/* Who is asking for /admin. Cloudflare Access stands in front of it (the application
   "adamschaefers.com assets admin") and signs in only ADMIN_EMAIL, with a one-time code by
   email; this checks the token Access adds, so a request that somehow got past Access
   without one gets nowhere. The same check as license-worker/src/access.js.
   ACCESS_TEAM is the Access team domain, ACCESS_AUD the application's audience tag. */

let certs = { at: 0, keys: [] };

function fromBase64url(text) {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** Access's public keys, cached for an hour, fetched again early when a token names one we don't have (they rotate). */
async function signingCert(team, kid) {
  const fresh = Date.now() - certs.at < 3600_000;
  let jwk = fresh ? certs.keys.find((k) => k.kid === kid) : undefined;
  if (!jwk && (!fresh || Date.now() - certs.at > 60_000)) {
    const response = await fetch(`https://${team}/cdn-cgi/access/certs`);
    const { keys = [] } = await response.json();
    certs = { at: Date.now(), keys };
    jwk = keys.find((k) => k.kid === kid);
  }
  return jwk;
}

function decode(part) {
  const bytes = fromBase64url(part);
  return bytes && JSON.parse(new TextDecoder().decode(bytes));
}

/** The signed-in admin's email, or null. */
export async function adminEmail(request, env) {
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || !env.ACCESS_TEAM || !env.ACCESS_AUD || !env.ADMIN_EMAIL) return null;
  const [h, p, s] = token.split('.');
  try {
    const header = decode(h);
    const claims = decode(p);
    const signature = fromBase64url(s);
    if (header?.alg !== 'RS256' || !claims || !signature) return null;
    const jwk = await signingCert(env.ACCESS_TEAM, header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, new TextEncoder().encode(`${h}.${p}`)))) return null;
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    const now = Date.now() / 1000;
    if (!audiences.includes(env.ACCESS_AUD) || claims.iss !== `https://${env.ACCESS_TEAM}` || !(claims.exp > now)) return null;
    const email = String(claims.email || '').toLowerCase();
    return email === env.ADMIN_EMAIL.toLowerCase() ? email : null;
  } catch {
    return null;
  }
}
