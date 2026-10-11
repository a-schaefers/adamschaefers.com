// The Store: buying licenses through the license Worker (license-worker/ in this repo),
// which makes the Stripe Checkout and, once paid, hands back the key it signed.
//   mountStore:   on #store, each product's buy form (.buy-mount), its "already have a key"
//                 box (.key-mount: the seats and installs on a key, and adding seats), the
//                 "lost your key" box (.recover-mount: every key for an email, sent to it)
//                 and the admin link
//   mountLicense: the key, at #license/<checkout id>, where Stripe sends the buyer back
// A mount's data-* attributes carry its product and prices; they must match the Worker's.
// Real Stripe, real money, everywhere: locally (make run) the store shows but can't buy,
// since the Turnstile widget and the license server accept only adamschaefers.com.

import { loadTurnstile } from './contact.js';

const API = 'https://licenses.adamschaefers.com';
// Buying, adding seats and recovery each pass a Turnstile check: the "adamschaefers store" widget.
const SITEKEY = '0x4AAAAAAFTf5pqbx6A0pJGb';
const MAX_SEATS = 1000;

const money = n => '$' + n.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const plural = n => `${n} seat${n === 1 ? '' : 's'}`;

function pricing(mount) {
    const { product, price, volumePrice, volumeSeats } = mount.dataset;
    return { product, price: Number(price), volumePrice: Number(volumePrice), volumeSeats: Number(volumeSeats) };
}

// What `seats` cost, priced by the license's total (`total`): the volume price applies to
// every seat once a license reaches volumeSeats.
function cost(p, seats, total = seats) {
    const each = total >= p.volumeSeats ? p.volumePrice : p.price;
    return { each, sum: Math.round(seats * each * 100) / 100, volume: total >= p.volumeSeats };
}

async function post(path, body) {
    const r = await fetch(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
}

// A Turnstile check rendered into `box` (a .cf-turnstile in the form): its token, and a reset
// for after a try, since each token works once. Only "Lost your key?" has one: it sends email.
// Buying and adding seats go straight to Stripe Checkout, which has its own CAPTCHA and
// card-testing defenses. Widgets whose form is gone (the store view left) are removed; coming
// back with the Back button (from Stripe, say) resets the rest, since the page returns as it
// was, spent tokens and all.
const widgets = new Map();  // widget id -> its box

function pruneWidgets() {
    for (const [id, box] of widgets) {
        if (box.isConnected) continue;
        widgets.delete(id);
        window.turnstile?.remove(id);
    }
}

addEventListener('pageshow', e => {
    if (!e.persisted || !window.turnstile) return;
    pruneWidgets();
    for (const id of widgets.keys()) window.turnstile.reset(id);
});

function botCheck(box) {
    let widget = null;
    loadTurnstile()
        .then(turnstile => {
            pruneWidgets();
            if (!box.isConnected) return;
            widget = turnstile.render(box, { sitekey: SITEKEY, theme: 'dark', size: 'flexible' });
            widgets.set(widget, box);
        })
        .catch(() => { box.innerHTML = 'Couldn\'t load the check that you\'re not a bot (an ad blocker?). Reload the page, or <a href="/inquiries/">use the contact form</a>.'; });
    return {
        token: () => box.querySelector('input[name="cf-turnstile-response"]')?.value || '',
        reset: () => { if (window.turnstile && widget !== null) window.turnstile.reset(widget); },
    };
}

const WAIT = 'One moment: the check above that you are not a bot is still running.';

async function checkout(body, status, button) {
    button.disabled = true;
    status.textContent = 'Opening Stripe checkout…';
    try {
        location.href = (await post('/v1/checkout', body)).url;
    } catch (err) {
        status.innerHTML = `${esc(err.message)} Please try again, or <a href="/inquiries/">get in touch</a>.`;
        button.disabled = false;
    }
}

function mountBuy(mount) {
    const p = pricing(mount);
    mount.innerHTML = `
<form class="buy-card" novalidate>
  <label for="buy-seats-${p.product}">Seats</label>
  <div class="buy-row">
    <input id="buy-seats-${p.product}" type="number" inputmode="numeric" min="1" max="${MAX_SEATS}" step="1" value="1" required>
    <button type="submit">Buy with Stripe</button>
  </div>
  <p class="buy-total" aria-live="polite"></p>
  <p class="buy-note">You'll give the licensee (your company, or you) and your email on Stripe's secure checkout. Your key appears on the next page and is emailed to you.</p>
  <p class="buy-status" role="status"></p>
</form>`;
    const form = mount.querySelector('form');
    const input = form.querySelector('input');
    const button = form.querySelector('button');
    const seats = () => Number(input.value);
    const valid = () => Number.isInteger(seats()) && seats() >= 1 && seats() <= MAX_SEATS;
    const update = () => {
        const n = seats();
        let line = `Choose between 1 and ${MAX_SEATS} seats.`;
        if (valid()) {
            const c = cost(p, n);
            line = `${plural(n)} × ${money(c.each)} = <b>${money(c.sum)}</b>`;
            if (c.volume) line += ' <span class="buy-save">25% off</span>';
            else if (n >= p.volumeSeats - 3) line += `<span class="buy-hint">${p.volumeSeats} seats would be ${money(cost(p, p.volumeSeats).sum)}, 25% off every seat.</span>`;
        }
        form.querySelector('.buy-total').innerHTML = line;
        button.disabled = !valid();
    };
    input.addEventListener('input', update);
    update();
    form.addEventListener('submit', e => {
        e.preventDefault();
        if (valid()) checkout({ product: p.product, seats: seats() }, form.querySelector('.buy-status'), button);
    });
}

// Paste a key: its licensee, seats and the installs using it, and a way to add seats.
function mountKey(mount) {
    const p = pricing(mount);
    mount.innerHTML = `
<form class="key-card" novalidate>
  <h4 class="key-title">Add seats to your license</h4>
  <label for="key-${p.product}">Growing team? Paste your license key, pick how many more seats, and pay for just those. ${money(p.price)} a seat, 25% off every seat once your license has ${p.volumeSeats} or more. You get one new key covering them all.</label>
  <textarea id="key-${p.product}" rows="3" spellcheck="false" autocomplete="off" placeholder="Paste your license key"></textarea>
  <div class="key-result" aria-live="polite"></div>
</form>`;
    const form = mount.querySelector('form');
    const area = form.querySelector('textarea');
    const result = form.querySelector('.key-result');
    let timer = null, asked = '';

    // The seats are the license's. Installs can't tell people from machines, so they're said
    // plainly, and more seats are suggested only when installs are clearly over: more than
    // twice the seats and at least 5 over, the license server's own rule.
    const show = (info, key) => {
        const clearlyOver = info.installs > 2 * info.seats && info.installs - info.seats >= 5;
        let html = `<p class="key-facts"><b>${esc(info.licensee)}</b>: ${plural(info.seats)}, for life.</p>`;
        if (info.status === 'revoked') {
            result.innerHTML = html + '<p class="key-warn">This license was withdrawn, for example after a refund. If that\'s a mistake, <a href="/inquiries/">get in touch</a>.</p>';
            return;
        }
        if (info.installs > 0) {
            html += `<p class="key-note">About ${info.installs} install${info.installs === 1 ? '' : 's'} checked in over the last two weeks. One person on several machines counts more than once.`
                + (clearlyOver ? ' That\'s well over your seats, so if more people use it now, you can add seats below.' : '') + '</p>';
        }
        if (!info.isNewest) html += `<p class="key-note">This is an older key. Your newest key covers ${plural(info.seats)}; both keep working.</p>`;
        html += `
<div class="buy-row">
  <input type="number" inputmode="numeric" min="1" max="${MAX_SEATS - info.seats}" step="1" value="1" aria-label="Seats to add">
  <button type="button">Add seats with Stripe</button>
</div>
<p class="buy-total"></p>
<p class="buy-note">You'll get one new key covering all your seats, shown right away and emailed. Your old key keeps working.</p>
<p class="buy-status" role="status"></p>`;
        result.innerHTML = html;
        const input = result.querySelector('input');
        const button = result.querySelector('button');
        const update = () => {
            const n = Number(input.value);
            const ok = Number.isInteger(n) && n >= 1 && info.seats + n <= MAX_SEATS;
            button.disabled = !ok;
            if (!ok) return void (result.querySelector('.buy-total').textContent = `Add between 1 and ${MAX_SEATS - info.seats} seats.`);
            const c = cost(p, n, info.seats + n);
            result.querySelector('.buy-total').innerHTML = `${n} more × ${money(c.each)} = <b>${money(c.sum)}</b>, ${plural(info.seats + n)} in all`
                + (c.volume ? ' <span class="buy-save">25% off</span>' : '');
        };
        input.addEventListener('input', update);
        update();
        button.addEventListener('click', () => checkout({ seats: Number(input.value), key }, result.querySelector('.buy-status'), button));
    };

    const look = async () => {
        const key = area.value.replace(/\s+/g, '');
        if (key === asked) return;
        asked = key;
        if (key.length < 20) return void (result.innerHTML = '');
        result.innerHTML = '<p class="key-note">Looking it up…</p>';
        try {
            const info = await post('/v1/lookup', { key });
            if (asked === key) show(info, key);
        } catch (err) {
            if (asked === key) result.innerHTML = `<p class="key-warn">${esc(err.message)}</p>`;
        }
    };
    area.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(look, 350); });
}

// Lost keys: every key on file for an address is emailed to it. The answer never says
// whether there were any, so the box can't tell anyone who bought. It starts folded away
// behind a "Lost your license key?" link: the form, and its Turnstile check, appear only
// when that's clicked. A send turns it into the contact form's "sent" card, with a Send
// again that waits out the server's 30 seconds between emails to one address.
const RESEND_AFTER = 30;

function mountRecover(mount) {
    mount.innerHTML = `
<div class="recover-card">
  <button type="button" class="recover-open" aria-expanded="false">Lost your license key?</button>
  <div class="recover-body" hidden>
  <h3>Lost your key?</h3>
  <form novalidate>
    <p>Enter the email you bought with, and we'll email it every license key on file for it.</p>
    <div class="buy-row">
      <input type="email" autocomplete="email" placeholder="you@company.com" aria-label="Email" required>
      <button type="submit">Email my keys</button>
    </div>
    <div class="cf-turnstile"></div>
    <p class="buy-status" role="status"></p>
  </form>
  <div class="inquiry-sent" tabindex="-1" hidden>
    <svg class="sent-check" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="23"/><path d="M15.5 27.5l7 7 14-15"/></svg>
    <div>
      <p class="sent-title">Sent. Check your inbox.</p>
      <p class="sent-note"></p>
      <p class="recover-again"><button type="button" disabled></button> <a href="/inquiries/">Contact form</a></p>
    </div>
  </div>
  </div>
  <p class="store-help">Questions, or trouble with a purchase or a key? <a href="/inquiries/">Get in touch</a>. I read every message myself.</p>
</div>`;
    const form = mount.querySelector('form');
    const input = form.querySelector('input');
    const button = form.querySelector('button');
    const status = form.querySelector('.buy-status');
    const sent = mount.querySelector('.inquiry-sent');
    const again = sent.querySelector('.recover-again button');
    const opener = mount.querySelector('.recover-open');
    const body = mount.querySelector('.recover-body');
    // The Turnstile check renders only once the box is opened.
    let human = null;
    let countdown = null;
    opener.addEventListener('click', () => {
        opener.hidden = true;
        opener.setAttribute('aria-expanded', 'true');
        body.hidden = false;
        human ??= botCheck(form.querySelector('.cf-turnstile'));
        input.focus();
    });

    const showSent = email => {
        sent.querySelector('.sent-note').innerHTML = `If <b>${esc(email)}</b> has license keys on file, they're on their way from licenses@adamschaefers.com. Give it a minute, and check your spam folder.`;
        form.hidden = true;
        sent.hidden = false;
        sent.classList.remove('is-arriving');
        void sent.offsetWidth;  // restart the arrival animation on a second send
        sent.classList.add('is-arriving');
        sent.focus();
        let left = RESEND_AFTER;
        again.disabled = true;
        again.textContent = `Send again in ${left}s`;
        clearInterval(countdown);
        countdown = setInterval(() => {
            if (!mount.isConnected) return clearInterval(countdown);
            left -= 1;
            if (left > 0) return void (again.textContent = `Send again in ${left}s`);
            clearInterval(countdown);
            again.disabled = false;
            again.textContent = 'Send again';
        }, 1000);
    };
    again.addEventListener('click', () => {
        sent.hidden = true;
        form.hidden = false;
        status.textContent = '';
        human?.reset();
        input.focus();
    });

    form.addEventListener('submit', async e => {
        e.preventDefault();
        const email = input.value.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return void (status.textContent = 'Please enter a valid email address.');
        const turnstile = human?.token();
        if (!turnstile) return void (status.textContent = WAIT);
        button.disabled = true;
        status.textContent = 'Sending…';
        try {
            await post('/v1/recover', { email, turnstile });
            status.textContent = '';
            showSent(email);
        } catch (err) {
            status.innerHTML = `${esc(err.message)} You can also <a href="/inquiries/">use the contact form</a>.`;
        }
        button.disabled = false;
        human?.reset();
    });
}

// A product's title gets a link icon that copies its address (/<id>/, which opens the store
// at that product, and whose page carries the product's link preview), always the live one
// so a shared link works anywhere.
const LINK_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.1 1.1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.1-1.1"/></svg>';

function mountShare(product) {
    const title = product.querySelector('.product-body > h3');
    const id = product.id.replace(/^product-/, '');
    if (!title || !id) return;
    const url = `https://adamschaefers.com/${id}/`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'product-link';
    button.title = `Copy link: ${url}`;
    button.setAttribute('aria-label', `Copy a link to ${title.textContent.trim()}`);
    button.innerHTML = `${LINK_ICON}<span class="product-link-note" aria-live="polite"></span>`;
    title.append(' ', button);
    const note = button.querySelector('.product-link-note');
    button.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(url);
            note.textContent = 'Link copied';
        } catch {
            note.textContent = url;
        }
        clearTimeout(button.timer);
        button.timer = setTimeout(() => { note.textContent = ''; }, 2500);
    });
}

// A product's image grows into a large view on a click, the way the profile photo does;
// a click anywhere or Esc shrinks it back.
function mountZoom(product) {
    const img = product.querySelector('.product-image');
    if (!img || img.src.endsWith('.svg')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'product-zoom';
    button.setAttribute('aria-label', `Enlarge: ${img.alt}`);
    img.replaceWith(button);
    button.append(img);
    const dialog = document.createElement('dialog');
    dialog.className = 'zoom-dialog';
    dialog.setAttribute('aria-label', img.alt);
    const big = img.cloneNode();
    big.className = '';
    dialog.append(big);
    product.append(dialog);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    const morph = reverse => {
        const a = img.getBoundingClientRect(), b = big.getBoundingClientRect();
        const dx = a.left + a.width / 2 - (b.left + b.width / 2);
        const dy = a.top + a.height / 2 - (b.top + b.height / 2);
        const frames = [
            { transform: `translate(${dx}px, ${dy}px) scale(${a.width / b.width})`, borderRadius: '12px' },
            { transform: 'none', borderRadius: '16px' },
        ];
        if (reverse) frames.reverse();
        return big.animate(frames, { duration: reduce.matches ? 0 : 450, easing: 'cubic-bezier(.2, .9, .25, 1)' });
    };
    button.addEventListener('click', () => {
        dialog.classList.remove('is-closing');
        dialog.showModal();
        button.classList.add('is-open');
        morph(false);
    });
    const close = () => {
        if (dialog.classList.contains('is-closing')) return;
        dialog.classList.add('is-closing');
        morph(true).onfinish = () => {
            dialog.close();
            dialog.classList.remove('is-closing');
            button.classList.remove('is-open');
            button.focus({ preventScroll: true });
        };
    };
    dialog.addEventListener('click', close);
    dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
}

export function mountStore(root) {
    for (const product of root.querySelectorAll('.product:not([data-mounted])')) {
        product.dataset.mounted = '1';
        mountShare(product);
        mountZoom(product);
    }
    for (const mount of root.querySelectorAll('.buy-mount:not([data-mounted])')) {
        mount.dataset.mounted = '1';
        mountBuy(mount);
    }
    for (const mount of root.querySelectorAll('.key-mount:not([data-mounted])')) {
        mount.dataset.mounted = '1';
        mountKey(mount);
    }
    for (const mount of root.querySelectorAll('.recover-mount:not([data-mounted])')) {
        mount.dataset.mounted = '1';
        mountRecover(mount);
    }
    // The license server's admin page (Cloudflare Access asks who you are).
    for (const a of root.querySelectorAll('.store-admin a')) a.href = `${API}/admin`;
}

function keyCard(l) {
    const seats = plural(l.seats);
    const lead = l.added
        ? `Your license now covers <b>${seats}</b>, and here's its new key. Your old key keeps working, but use this one from now on. <b>Screenshot or print this page</b> to keep it.`
        : `Here's your license key. <b>Screenshot or print this page</b> to keep it.`;
    return `
<p class="license-lead">${lead}</p>
<div class="license-card">
  <dl>
    <div><dt>Licensee</dt><dd>${esc(l.licensee)}</dd></div>
    <div><dt>Seats</dt><dd>${seats}, for life</dd></div>
    <div><dt>Email</dt><dd>${esc(l.email)}</dd></div>
  </dl>
  <pre class="license-key">${esc(l.key)}</pre>
  <div class="license-actions">
    <button type="button" data-do="copy">Copy key</button>
    <button type="button" data-do="print">Print</button>
  </div>
</div>
<p>We've also emailed it to <b>${esc(l.email)}</b> from licenses@adamschaefers.com. Please don't reply to that email: nobody reads that address. If anything's wrong or you have a question, <a href="/inquiries/">use the contact form</a>.</p>
<h3>Using it</h3>
<p>${esc(l.howToUse)}</p>
<p>Need more seats later? Paste this key in the <a href="/store/">store</a>.</p>
${l.status === 'revoked' ? '<p class="license-revoked">This license has been withdrawn, for example after a refund. If that\'s a mistake, <a href="/inquiries/">get in touch</a>.</p>' : ''}`;
}

export function mountLicense(root) {
    const mount = root.querySelector('#license-mount');
    // Keyed by checkout, so a reused element shows the right purchase.
    const session = mount?.dataset.session;
    if (!mount || mount.dataset.mounted === session) return;
    mount.dataset.mounted = session;
    const say = html => { if (mount.isConnected) mount.innerHTML = html; };
    say('<p class="license-lead">Getting your key…</p>');

    let tries = 0;
    const load = async () => {
        if (!mount.isConnected) return;
        try {
            const r = await fetch(`${API}/v1/checkout/${encodeURIComponent(session)}`);
            if (r.status === 202 && tries++ < 30) {
                say('<p class="license-lead">Your payment is still being confirmed. Your key will appear here in a moment…</p>');
                return setTimeout(load, 2000);
            }
            // Asked too often: wait a little longer, then ask again.
            if (r.status === 429 && tries++ < 30) return setTimeout(load, 6000);
            const data = await r.json().catch(() => ({}));
            if (!r.ok || !data.key) throw new Error(data.error || 'not found');
            say(keyCard(data));
            mount.addEventListener('click', async e => {
                const act = e.target.closest('button[data-do]')?.dataset.do;
                if (act === 'print') window.print();
                if (act === 'copy') {
                    try {
                        await navigator.clipboard.writeText(data.key);
                        e.target.textContent = 'Copied';
                    } catch {
                        // No clipboard access: select the key, ready to copy by hand.
                        const range = document.createRange();
                        range.selectNodeContents(mount.querySelector('.license-key'));
                        getSelection().removeAllRanges();
                        getSelection().addRange(range);
                        e.target.textContent = 'Selected: press Ctrl+C';
                    }
                    setTimeout(() => { e.target.textContent = 'Copy key'; }, 2500);
                }
            });
        } catch {
            say(`<p class="license-lead">We couldn't find this purchase.</p>
<p>If you've paid, your key is on its way to your email from licenses@adamschaefers.com. If it doesn't arrive within a few minutes, check your spam folder. You can also have every key on file emailed to you from the <a href="/store/">store</a> ("Lost your key?"), or <a href="/inquiries/">use the contact form</a> and we'll sort it out.</p>`);
        }
    };
    load();
}
