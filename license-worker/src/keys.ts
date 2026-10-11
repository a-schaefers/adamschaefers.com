/* License keys, made and checked with WebCrypto.

   The format is Backseat Driver's (plugin/core/licensekey.ts in ../backseat-driver):
   `<prefix>.<payload>.<signature>`, the prefix the product's (src/products.ts), BSD1
   for Backseat Driver. The payload is `{ v: 1, kid, id, to, seats, iat, exp }`
   as UTF-8 JSON in base64url; the signature is ECDSA P-256 with SHA-256 over the
   payload's base64url text, as the 64 bytes of r and s (WebCrypto's own format).
   kid names the signing key, id the license, to the licensee, iat when it was
   issued and exp the end of its term in epoch milliseconds; these licenses are
   lifetime, so exp is always 0.

   The private key is the Worker secret SIGNING_KEY (PKCS #8 PEM). Its public
   half, which the plugin carries in PUBLIC_KEYS, is derived from it. */

const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN = { name: 'ECDSA', hash: 'SHA-256' };

// A public key as the apps carry it, and the private key that signs with it.
export interface PublicKey { kid: string; x: string; y: string }
export interface SigningKey { kid: string; privateKey: CryptoKey; publicKey: PublicKey }
// A key's payload, and what checking a key found.
export interface Payload { v: 1; kid: string; id: string; to: string; seats: number; iat: number; exp: number }
export type KeyCheck =
  | { state: 'malformed'; payload?: undefined; prefix?: undefined }
  | { state: 'valid' | 'forged'; payload: Payload; prefix: string };

export function toBase64url(bytes: Uint8Array) {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64url(text: string) {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function pemBody(pem: string) {
  return fromBase64url(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
}

/** The signing key from its PKCS #8 PEM, with its public half as the plugin carries it. */
export async function loadSigningKey(kid: string, pem: string): Promise<SigningKey> {
  const der = pemBody(pem);
  if (!der) throw new Error('SIGNING_KEY is not a PEM private key');
  const privateKey = await crypto.subtle.importKey('pkcs8', der, ECDSA, true, ['sign']);
  // The public half is the private JWK without d.
  const { x, y } = await crypto.subtle.exportKey('jwk', privateKey) as { x: string; y: string };
  return { kid, privateKey, publicKey: { kid, x, y } };
}

/** A new license id: short, unguessable, safe in a URL. Same shape as the reference server's. */
export function newLicenseId() {
  return 'lic_' + toBase64url(crypto.getRandomValues(new Uint8Array(12)));
}

/** Signs a new lifetime license into a key with the product's prefix. */
export async function signKey(signing: SigningKey, prefix: string, { id, to, seats, iat }: { id: string; to: string; seats: number; iat: number }) {
  const licensee = String(to).trim();
  if (!licensee) throw new Error('a license needs a licensee');
  if (!Number.isInteger(seats) || seats < 1) throw new Error('a license needs at least one seat');
  const payload: Payload = { v: 1, kid: signing.kid, id, to: licensee, seats, iat, exp: 0 };
  const signed = toBase64url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = new Uint8Array(await crypto.subtle.sign(SIGN, signing.privateKey, new TextEncoder().encode(signed)));
  return { key: `${prefix}.${signed}.${toBase64url(signature)}`, payload };
}

/** A key's payload and signature check against the public keys: { state, payload, prefix }, the plugin's states. */
export async function checkKey(text: unknown, publicKeys: PublicKey[], prefixes: string[]): Promise<KeyCheck> {
  const parts = String(text).replace(/\s+/g, '').split('.');
  if (parts.length !== 3 || !prefixes.includes(parts[0])) return { state: 'malformed' };
  const prefix = parts[0];
  const json = fromBase64url(parts[1]);
  const signature = fromBase64url(parts[2]);
  if (!json || !signature || signature.length !== 64) return { state: 'malformed' };
  let payload;
  try {
    payload = JSON.parse(new TextDecoder('utf-8', { fatal: true } as TextDecoderConstructorOptions).decode(json));
  } catch {
    return { state: 'malformed' };
  }
  const { v, kid, id, to, seats, iat, exp } = payload || {};
  if (v !== 1 || typeof kid !== 'string' || typeof id !== 'string' || !id || typeof to !== 'string'
      || typeof seats !== 'number' || typeof iat !== 'number' || typeof exp !== 'number') return { state: 'malformed' };
  payload = { v, kid, id, to, seats, iat, exp };
  const known = publicKeys.find((k) => k.kid === kid);
  if (!known) return { state: 'forged', payload, prefix };
  const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: known.x, y: known.y }, ECDSA, false, ['verify']);
  const good = await crypto.subtle.verify(SIGN, key, signature, new TextEncoder().encode(parts[1]));
  return { state: good ? 'valid' : 'forged', payload, prefix };
}
