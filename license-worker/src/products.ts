/* What this server sells. One entry per product; its Stripe prices are in
   wrangler.jsonc's PRICES var, keyed the same ({ seat, volume } price ids). To
   sell something new: an entry here, its own signing key (below), its two
   prices in Stripe and PRICES, and a page on adamschaefers.com whose buy form
   posts { product: '<id>', seats }.

   Every product signs with its own key, never another's. A key's signature
   covers its payload but not its prefix, so a key signed with a key Backseat
   Driver trusts could be relabelled BSD1 and pass as a Backseat Driver license
   in copies already installed. `signing` names the product's Worker secret (its
   PKCS #8 PEM, from scripts/keygen.ts), the var holding its kid, and the var
   listing the public halves of its retired keys ({ kid, x, y } each, after a
   rotation). Its app ships that public key and asks
   /v1/products/<id>/keys/<license id>; the unscoped /v1/keys and
   /v1/public-keys are Backseat Driver's (FIRST_PRODUCT), as its shipped
   copies expect. */

export interface Product {
  name: string;
  license: string;
  keyPrefix: string;
  signing: { secret: string; kid: string; retired: string };
  volumeSeats: number;
  page: string;
  howToUse: (seats: string) => string;
}
export type ProductWithId = Product & { id: string };

export const PRODUCTS: Record<string, Product> = {
  'backseat-driver': {
    name: 'Backseat Driver',
    license: 'Backseat Driver commercial license',
    keyPrefix: 'BSD1',
    signing: { secret: 'SIGNING_KEY', kid: 'SIGNING_KID', retired: 'OLD_PUBLIC_KEYS' },
    // The volume price applies to every seat once a license has this many in all.
    volumeSeats: 10,
    // Its page on the site, store/<id>/, where Checkout's Back button returns.
    page: 'store/backseat-driver/',
    howToUse: (seats) => `To use it, run /backseat license in Claude Code, choose commercial use and paste the key. Everyone using Backseat Driver under this license uses the same key, up to ${seats}.`,
  },
};

// The product the unscoped /v1/keys/<id> and /v1/public-keys answer for: shipped copies of
// Backseat Driver ask there, and its release script checks every key /v1/public-keys lists.
export const FIRST_PRODUCT = 'backseat-driver';

export const productOf = (id: unknown): ProductWithId | null => (typeof id === 'string' && Object.hasOwn(PRODUCTS, id) ? { id, ...PRODUCTS[id] } : null);

export const productByPrefix = (prefix: string) => {
  const id = Object.keys(PRODUCTS).find((p) => PRODUCTS[p].keyPrefix === prefix);
  return id ? productOf(id) : null;
};

export const keyPrefixes = () => Object.values(PRODUCTS).map((p) => p.keyPrefix);
