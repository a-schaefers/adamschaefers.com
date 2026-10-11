// Makes a license signing key pair, one per product (never share one: src/products.ts).
//   node license-worker/scripts/keygen.ts <kid> <private-key-file>
// The private half (PKCS #8 PEM) goes to the file, which must not exist yet and
// must stay out of the repository: set it as the product's signing secret
// (SIGNING_KEY for Backseat Driver, SIGNING_KEY_<PRODUCT> for another) and keep a
// copy in the private repo, since a Worker secret can't be read back. The public
// half is printed, for the product's app to ship (Backseat Driver: PUBLIC_KEYS in
// ../backseat-driver's plugin/core/licensekey.ts).

import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const [kid, file] = process.argv.slice(2);
if (!kid || !file) {
  console.error('usage: node scripts/keygen.ts <kid> <private-key-file>');
  process.exit(1);
}
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
writeFileSync(file, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600, flag: 'wx' });
const { x, y } = publicKey.export({ format: 'jwk' });
console.log(JSON.stringify({ kid, x, y }));
