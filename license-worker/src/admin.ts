/* The owner's page at /admin: every license of every product, newest first,
   with each product's totals; filter by product, search by email, licensee,
   license id or payment. Copy a key, resend its email, revoke or restore it,
   or issue one by hand for any product. Served only after Cloudflare Access signs
   the owner in (src/access.ts); it calls /admin/api/... on the same origin. */

import { SCRIPT, STYLE } from './admin-page.gen.ts';

// Its styles and script are compiled from src/admin-page.css and src/admin-page.ts
// (scripts/build.ts) and inlined; its classes are Tailwind's.
export const ADMIN_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Licenses {{MODE}}</title>
<style>${STYLE}</style></head>
<body>
<h1>Licenses <small>{{MODE}}</small></h1>
<ul class="m-0 mb-5 flex list-none flex-wrap gap-3 p-0" id="totals"></ul>
<details><summary>Issue a license by hand</summary>
  <form id="issue">
    <select id="product" name="product" required></select>
    <input name="email" type="email" placeholder="Email" required>
    <input name="licensee" placeholder="Licensee (company or name)" required>
    <input name="seats" type="number" min="1" value="1" required>
    <input name="note" placeholder="Note (only you see it)">
    <label><input name="send" type="checkbox" checked> Email the key to them</label>
    <button>Issue</button>
  </form>
</details>
<div class="mb-4 flex flex-wrap gap-2"><select id="only"><option value="">All products</option></select><input class="min-w-56 flex-1" id="q" type="search" placeholder="Search email, licensee, lic_ id or pi_ payment"><button id="go">Search</button></div>
<p class="min-h-[1.5em] text-turq" id="msg"></p>
<table><thead><tr><th>Issued</th><th>Product</th><th>Email / licensee</th><th>Seats / installs</th><th>Paid</th><th>Status</th><th>Key</th><th></th></tr></thead><tbody id="rows"></tbody></table>
<script>${SCRIPT}</script>
</body></html>`;
