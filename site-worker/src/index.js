// adamschaefers.com. The built site is static assets (wrangler.jsonc), served without this
// script; only /admin runs it: the asset manager (src/admin.js), behind Cloudflare Access.
import { admin } from './admin.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) return admin(request, env, url);
    return env.ASSETS.fetch(request);
  },
};
