/* What this server sells. One entry per product; its Stripe prices are in
   wrangler.jsonc's PRICES var, keyed the same ({ seat, volume } price ids). To
   sell something new: an entry here, its two prices in Stripe and PRICES, and a
   page on adamschaefers.com whose buy form posts { product: '<id>', seats }.

   Keys are signed with the server's one signing key; the prefix says which
   product a key is for, so a product's app can tell its keys from others'. */

export const PRODUCTS = {
  'backseat-driver': {
    name: 'Backseat Driver',
    license: 'Backseat Driver commercial license',
    keyPrefix: 'BSD1',
    // The volume price applies to every seat once a license has this many in all.
    volumeSeats: 10,
    // Its page on the site, where Checkout's Back button returns.
    page: 'backseat-driver/',
    howToUse: (seats) => `To use it, run /backseat license in Claude Code, choose commercial use and paste the key. Everyone using Backseat Driver under this license uses the same key, up to ${seats}.`,
  },
};

export const productOf = (id) => (Object.hasOwn(PRODUCTS, id) ? { id, ...PRODUCTS[id] } : null);

export const productByPrefix = (prefix) => {
  const id = Object.keys(PRODUCTS).find((p) => PRODUCTS[p].keyPrefix === prefix);
  return id ? productOf(id) : null;
};

export const keyPrefixes = () => Object.values(PRODUCTS).map((p) => p.keyPrefix);
