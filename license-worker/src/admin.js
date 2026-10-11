/* The owner's page at /admin: every license, newest first, searchable by email,
   licensee, license id or payment. Copy a key, resend its email, revoke or
   restore it, or issue one by hand. Served only after Cloudflare Access signs
   the owner in (src/access.js); it calls /admin/api/... on the same origin. */

export const ADMIN_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Licenses {{MODE}}</title>
<style>
  :root { --sky:#161A33; --mesa:#1F2445; --ridge:#2C3260; --sand:#EEE7D7; --dust:#A8A6BE; --turq:#46D3C3; --chile:#E5533D; }
  body { margin:0; padding:1.5rem; background:var(--sky); color:var(--sand); font:15px/1.5 system-ui,sans-serif; }
  h1 { margin:0 0 1rem; font-size:1.4rem; } h1 small { color:var(--chile); font-size:.9rem; margin-left:.5rem; }
  input, button, textarea { font:inherit; color:inherit; background:var(--mesa); border:1px solid var(--ridge); border-radius:8px; padding:.45rem .7rem; }
  button { cursor:pointer; } button:hover { border-color:var(--turq); color:var(--turq); }
  .bar { display:flex; gap:.5rem; flex-wrap:wrap; margin-bottom:1rem; } .bar input { flex:1; min-width:14rem; }
  table { width:100%; border-collapse:collapse; } th, td { text-align:left; padding:.5rem; border-bottom:1px solid var(--ridge); vertical-align:top; }
  th { color:var(--dust); font-weight:600; font-size:.85rem; } td small { color:var(--dust); display:block; }
  .key { font:12px/1.4 ui-monospace,monospace; word-break:break-all; color:var(--dust); max-width:28rem; }
  .revoked { color:var(--chile); } .active { color:var(--turq); } .err { color:var(--chile); }
  .actions { display:flex; gap:.35rem; flex-wrap:wrap; } .actions button { padding:.25rem .55rem; font-size:.85rem; }
  details { margin:0 0 1.25rem; background:var(--mesa); border:1px solid var(--ridge); border-radius:12px; padding:.75rem 1rem; }
  summary { cursor:pointer; font-weight:600; } form { display:grid; gap:.5rem; max-width:28rem; margin-top:.75rem; }
  #msg { min-height:1.5em; color:var(--turq); } a { color:var(--turq); }
</style></head>
<body>
<h1>Licenses <small>{{MODE}}</small></h1>
<details><summary>Issue a license by hand</summary>
  <form id="issue">
    <select id="product" name="product"></select>
    <input name="email" type="email" placeholder="Email" required>
    <input name="licensee" placeholder="Licensee (company or name)" required>
    <input name="seats" type="number" min="1" value="1" required>
    <input name="note" placeholder="Note (only you see it)">
    <label><input name="send" type="checkbox" checked> Email the key to them</label>
    <button>Issue</button>
  </form>
</details>
<div class="bar"><input id="q" type="search" placeholder="Search email, licensee, lic_ id or pi_ payment"><button id="go">Search</button></div>
<p id="msg"></p>
<table><thead><tr><th>Issued</th><th>Email / licensee</th><th>Seats / installs</th><th>Paid</th><th>Status</th><th>Key</th><th></th></tr></thead><tbody id="rows"></tbody></table>
<script>
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
let dashboard = '';
let products = {};
function say(text, bad) { $('#msg').textContent = text; $('#msg').className = bad ? 'err' : ''; }
async function api(path, options) {
  const r = await fetch('/admin/api/' + path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || r.status);
  return data;
}
function row(l) {
  const paid = l.amount_total == null ? '<small>' + esc(l.source) + '</small>'
    : esc((l.amount_total / 100).toFixed(2) + ' ' + String(l.currency || '').toUpperCase())
      + (l.stripe_payment_intent ? '<small>' + (dashboard ? '<a target="_blank" rel="noopener" href="' + esc(dashboard + '/payments/' + l.stripe_payment_intent) + '">' + esc(l.stripe_payment_intent) + '</a>' : esc(l.stripe_payment_intent)) + '</small>' : '');
  const status = l.revoked_at ? '<span class="revoked">revoked</span><small>' + new Date(l.revoked_at).toLocaleString() + '</small>' : '<span class="active">active</span>';
  const mail = l.email_error ? '<small class="err">email failed: ' + esc(l.email_error) + '</small>' : l.emailed_at ? '<small>emailed ' + new Date(l.emailed_at).toLocaleString() + '</small>' : '<small>not emailed</small>';
  return '<tr data-id="' + esc(l.id) + '"><td>' + new Date(l.issued_at).toLocaleString() + '<small>' + esc(l.id) + '</small></td>'
    + '<td>' + esc(l.email) + '<small>' + esc(l.licensee) + ' · ' + esc(products[l.product] || l.product) + '</small>' + mail + (l.note ? '<small>' + esc(l.note) + '</small>' : '') + '</td>'
    + '<td>' + l.seats + '<small' + (l.installs > l.seats ? ' class="err"' : '') + '>' + l.installs + ' install' + (l.installs === 1 ? '' : 's') + ' in 14 days</small>'
      + (l.nudged_at ? '<small>seats email ' + new Date(l.nudged_at).toLocaleDateString() + '</small>' : '')
      + (l.root_id && l.root_id !== l.id ? '<small>family ' + esc(l.root_id) + '</small>' : '') + '</td><td>' + paid + '</td><td>' + status + '</td><td class="key">' + esc(l.key) + '</td>'
    + '<td><div class="actions"><button data-do="copy">Copy key</button><button data-do="resend">Resend email</button>'
    + (l.revoked_at ? '<button data-do="restore">Restore</button>' : '<button data-do="revoke">Revoke</button>') + '</div></td></tr>';
}
let shown = [];
async function load() {
  try {
    const data = await api('licenses?q=' + encodeURIComponent($('#q').value));
    dashboard = data.dashboard; shown = data.licenses;
    if (!Object.keys(products).length) { products = data.products; $('#product').innerHTML = Object.entries(products).map(([id, name]) => '<option value="' + esc(id) + '">' + esc(name) + '</option>').join(''); }
    $('#rows').innerHTML = shown.map(row).join('') || '<tr><td colspan="7">No licenses' + ($('#q').value ? ' match.' : ' yet.') + '</td></tr>';
    say(shown.length + ' license' + (shown.length === 1 ? '' : 's'));
  } catch (e) { say('Could not load: ' + e.message, true); }
}
$('#rows').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-do]'); if (!b) return;
  const id = b.closest('tr').dataset.id; const l = shown.find((x) => x.id === id); const act = b.dataset.do;
  if (act === 'copy') { try { await navigator.clipboard.writeText(l.key); return say('Key copied for ' + l.email); } catch { return say('Copy blocked: select the key in the table instead.', true); } }
  if (act === 'revoke' && !confirm('Withdraw the whole license of ' + l.licensee + ' (every key of it, ' + l.email + ')? Its plugins will say withdrawn.')) return;
  b.disabled = true;
  try { await api('licenses/' + id + '/' + act, { method: 'POST', body: '{}' }); say(act === 'resend' ? 'Emailed ' + l.email : id + ' ' + act + 'd'); await load(); }
  catch (err) { say(act + ' failed: ' + err.message, true); b.disabled = false; }
});
$('#issue').addEventListener('submit', async (e) => {
  e.preventDefault(); const f = new FormData(e.target);
  try {
    const data = await api('licenses', { method: 'POST', body: JSON.stringify({ product: f.get('product'), email: f.get('email'), licensee: f.get('licensee'), seats: Number(f.get('seats')), note: f.get('note'), send: f.get('send') === 'on' }) });
    e.target.reset(); say('Issued ' + data.license.id + (data.emailed === false ? ', but the email failed' : data.emailed ? ' and emailed it' : '')); await load();
  } catch (err) { say('Issue failed: ' + err.message, true); }
});
$('#go').addEventListener('click', load);
$('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') load(); });
load();
</script>
</body></html>`;
