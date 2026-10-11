// Makes a license signing key pair.
//   node license-worker/scripts/keygen.js <kid> <private-key-file>
// The private half (PKCS #8 PEM) goes to the file, which must not exist yet and
// must stay out of the repository: set it as the Worker's SIGNING_KEY secret and
// keep a copy somewhere safe, since a Worker secret can't be read back. The
// public half is printed, for PUBLIC_KEYS in ../backseat-driver's
// plugin/core/licensekey.ts.

import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const [kid, file] = process.argv.slice(2);
if (!kid || !file) {
  console.error('usage: node scripts/keygen.js <kid> <private-key-file>');
  process.exit(1);
}
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
writeFileSync(file, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600, flag: 'wx' });
const { x, y } = publicKey.export({ format: 'jwk' });
console.log(JSON.stringify({ kid, x, y }));
