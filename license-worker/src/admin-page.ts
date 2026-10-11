/* The licenses page's script (src/index.ts serves the page, src/admin.ts): every license of
   every product, newest first, with each product's totals; filter by product, search; copy a
   key, resend its email, revoke or restore it; issue one by hand. Browser code:
   scripts/build.ts bundles it into src/admin-page.gen.ts, which the page inlines. Its classes
   are Tailwind's (src/admin-page.css). */

// A license as /admin/api/licenses lists it: its row (src/index.ts's License) and its installs.
interface License {
  id: string; product: string; root_id: string; key: string; licensee: string; email: string; seats: number;
  issued_at: number; revoked_at: number; source: string; stripe_payment_intent: string | null;
  amount_total: number | null; currency: string | null; emailed_at: number; email_error: string;
  nudged_at: number; note: string; installs: number;
}
interface Total { product: string; licenses: number; live: number; taken: number; currency?: string | null }

// The classes of what this draws: a product's totals, an alarm, a row's buttons.
const TOTAL = 'cursor-pointer rounded-xl border border-ridge bg-mesa px-[.9rem] py-[.6rem] [&.on]:border-turq';
const ALARM = 'text-chile';
const SMALL = 'px-[.55rem] py-1 text-[.85rem]';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' } as Record<string, string>)[c]);
let dashboard = '';
let products: Record<string, string> = {};
function say(text: string, bad?: boolean) { $('#msg').textContent = text; $('#msg').classList.toggle('err', Boolean(bad)); }
async function api(path: string, options?: RequestInit) {
  const r = await fetch('/admin/api/' + path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || r.status);
  return data;
}
function row(l: License) {
  const paid = l.amount_total == null ? '<small>' + esc(l.source) + '</small>'
    : esc((l.amount_total / 100).toFixed(2) + ' ' + String(l.currency || '').toUpperCase())
      + (l.stripe_payment_intent ? '<small>' + (dashboard ? '<a target="_blank" rel="noopener" href="' + esc(dashboard + '/payments/' + l.stripe_payment_intent) + '">' + esc(l.stripe_payment_intent) + '</a>' : esc(l.stripe_payment_intent)) + '</small>' : '');
  const status = l.revoked_at ? '<span class="' + ALARM + '">revoked</span><small>' + new Date(l.revoked_at).toLocaleString() + '</small>' : '<span class="text-turq">active</span>';
  const mail = l.email_error ? '<small class="' + ALARM + '">email failed: ' + esc(l.email_error) + '</small>' : l.emailed_at ? '<small>emailed ' + new Date(l.emailed_at).toLocaleString() + '</small>' : '<small>not emailed</small>';
  return '<tr data-id="' + esc(l.id) + '"><td>' + new Date(l.issued_at).toLocaleString() + '<small>' + esc(l.id) + '</small></td>'
    + '<td>' + esc(products[l.product] || l.product) + '</td>'
    + '<td>' + esc(l.email) + '<small>' + esc(l.licensee) + '</small>' + mail + (l.note ? '<small>' + esc(l.note) + '</small>' : '') + '</td>'
    + '<td>' + l.seats + '<small' + (l.installs > l.seats ? ' class="' + ALARM + '"' : '') + '>' + l.installs + ' install' + (l.installs === 1 ? '' : 's') + ' in 14 days</small>'
      + (l.nudged_at ? '<small>seats email ' + new Date(l.nudged_at).toLocaleDateString() + '</small>' : '')
      + (l.root_id && l.root_id !== l.id ? '<small>family ' + esc(l.root_id) + '</small>' : '') + '</td><td>' + paid + '</td><td>' + status + '</td>'
    + '<td class="max-w-[28rem] font-mono text-[12px] leading-[1.4] font-normal break-all text-dust">' + esc(l.key) + '</td>'
    + '<td><div class="flex flex-wrap gap-[.35rem]"><button class="' + SMALL + '" data-do="copy">Copy key</button><button class="' + SMALL + '" data-do="resend">Resend email</button>'
    + (l.revoked_at ? '<button class="' + SMALL + '" data-do="restore">Restore</button>' : '<button class="' + SMALL + '" data-do="revoke">Revoke</button>') + '</div></td></tr>';
}
const money = (n: number, c?: string | null) => new Intl.NumberFormat('en-US', { style: 'currency', currency: String(c || 'usd').toUpperCase() }).format(n / 100);
const options = (list: [string, string][]) => list.map(([id, name]) => '<option value="' + esc(id) + '">' + esc(name) + '</option>').join('');
function totals(list: Total[]) {
  const only = $<HTMLSelectElement>('#only').value;
  $('#totals').innerHTML = Object.entries(products).map(([id, name]) => {
    const t = list.find((x) => x.product === id) || { licenses: 0, live: 0, taken: 0, currency: undefined };
    return '<li class="' + TOTAL + (only === id ? ' on' : '') + '" data-product="' + esc(id) + '"><b class="block">' + esc(name) + '</b><small class="text-dust">' + t.live + ' active of ' + t.licenses + ' license' + (t.licenses === 1 ? '' : 's') + ' · ' + money(t.taken, t.currency) + '</small></li>';
  }).join('');
}
let shown: License[] = [];
async function load() {
  try {
    const data = await api('licenses?q=' + encodeURIComponent($<HTMLInputElement>('#q').value) + '&product=' + encodeURIComponent($<HTMLSelectElement>('#only').value));
    dashboard = data.dashboard; shown = data.licenses;
    if (!Object.keys(products).length) {
      products = data.products;
      // Hand-issued keys are only for products on sale; with more than one, choosing is required.
      const sold = Object.entries(products).filter(([id]) => data.selling.includes(id));
      $('#product').innerHTML = (sold.length > 1 ? '<option value="">Product…</option>' : '') + options(sold);
      $('#only').innerHTML = '<option value="">All products</option>' + options(Object.entries(products));
    }
    totals(data.totals);
    $('#rows').innerHTML = shown.map(row).join('') || '<tr><td colspan="8">No licenses' + ($<HTMLInputElement>('#q').value || $<HTMLSelectElement>('#only').value ? ' match.' : ' yet.') + '</td></tr>';
    say(shown.length + ' license' + (shown.length === 1 ? '' : 's') + ($<HTMLSelectElement>('#only').value ? ' of ' + products[$<HTMLSelectElement>('#only').value] : ''));
  } catch (e) { say('Could not load: ' + (e as Error).message, true); }
}
$('#totals').addEventListener('click', (e) => {
  const li = (e.target as Element).closest<HTMLElement>('li[data-product]'); if (!li) return;
  $<HTMLSelectElement>('#only').value = $<HTMLSelectElement>('#only').value === li.dataset.product ? '' : li.dataset.product!; load();
});
$('#only').addEventListener('change', load);
$('#rows').addEventListener('click', async (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>('button[data-do]'); if (!b) return;
  const id = b.closest('tr')!.dataset.id; const l = shown.find((x) => x.id === id)!; const act = b.dataset.do;
  if (act === 'copy') { try { await navigator.clipboard.writeText(l.key); return say('Key copied for ' + l.email); } catch { return say('Copy blocked: select the key in the table instead.', true); } }
  if (act === 'revoke' && !confirm('Withdraw the whole ' + (products[l.product] || l.product) + ' license of ' + l.licensee + ' (every key of it, ' + l.email + ')? Its app will say withdrawn.')) return;
  b.disabled = true;
  try { await api('licenses/' + id + '/' + act, { method: 'POST', body: '{}' }); say(act === 'resend' ? 'Emailed ' + l.email : id + ' ' + act + 'd'); await load(); }
  catch (err) { say(act + ' failed: ' + (err as Error).message, true); b.disabled = false; }
});
$('#issue').addEventListener('submit', async (e) => {
  e.preventDefault(); const form = e.target as HTMLFormElement; const f = new FormData(form);
  try {
    const data = await api('licenses', { method: 'POST', body: JSON.stringify({ product: f.get('product'), email: f.get('email'), licensee: f.get('licensee'), seats: Number(f.get('seats')), note: f.get('note'), send: f.get('send') === 'on' }) });
    form.reset(); say('Issued ' + (products[data.license.product] || '') + ' ' + data.license.id + (data.emailed === false ? ', but the email failed' : data.emailed ? ' and emailed it' : '')); await load();
  } catch (err) { say('Issue failed: ' + (err as Error).message, true); }
});
$('#go').addEventListener('click', load);
$('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') load(); });
load();

// A module of its own, not a script sharing the global scope with the other admin page.
export {};
