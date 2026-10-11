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

import { loadTurnstile, SENT_CARD, SENT_CHECK, SENT_NOTE, SENT_TITLE } from './contact.ts';

const API = 'https://licenses.adamschaefers.com';
// Buying, adding seats and recovery each pass a Turnstile check: the "adamschaefers store" widget.
const SITEKEY = '0x4AAAAAAFTf5pqbx6A0pJGb';
const MAX_SEATS = 1000;

// The store's styles are Tailwind's utilities (site.css). These repeat: a card (the buy box,
// the add-seats box, the key's), a row of a field and its button, the field, the button
// (Buy, Add seats, Email my keys, Copy key) and what disables it, the lines under them (the
// total, a note, the status after a try, hidden while empty), a line of the add-seats box's
// answer, the 25% off badge and the hint at the volume price, and the links that unfold a box.
const CARD = 'rounded-2xl bg-mesa px-7 py-6 inset-ring inset-ring-ridge';
const ROW = 'flex flex-wrap gap-3';
const FIELD = 'box-border rounded-[10px] border border-ridge bg-sky px-[.85rem] py-[.6rem] text-sand '
    + 'focus-visible:border-transparent focus-visible:outline-[2px] focus-visible:outline-offset-1 focus-visible:outline-turq';
const BUTTON = 'cursor-pointer rounded-full border-0 bg-turq px-[1.6rem] py-[.7rem] font-bold text-sky hover:bg-surf';
const DISABLED = 'disabled:cursor-not-allowed disabled:opacity-50';
const TOTAL = 'text-[1.1rem]';
const NOTE = 'text-[.9rem] text-dust';
const STATUS = 'text-sand empty:hidden';
const ANSWER = 'm-0 mb-[.6rem]';
const SAVE = 'ml-[.4rem] whitespace-nowrap rounded-full bg-turq px-[.55rem] py-[.1rem] text-[.8rem] font-bold text-sky';
const HINT = 'mt-1 block text-[.9rem] text-dust';
const OPENER = 'cursor-pointer border-0 bg-transparent p-0 text-[.95rem] text-dust underline decoration-dust/40 decoration-1 underline-offset-3 '
    + 'hover:text-turq focus-visible:text-turq';

// A product's prices, from its mount's data-* attributes.
interface Pricing { product: string; price: number; volumePrice: number; volumeSeats: number }
// The license server's answers: a key looked up (POST /v1/lookup), a purchase's key
// (GET /v1/checkout/<session>).
interface KeyInfo {
    product: string; productName: string; licensee: string; status: 'active' | 'revoked';
    seats: number; installs: number; isNewest: boolean;
}
interface License {
    status: 'active' | 'revoked'; key: string; licensee: string; seats: number; email: string;
    added: boolean; product: string; productName: string; howToUse: string;
}

const money = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
const esc = (s: unknown) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]);
const plural = (n: number) => `${n} seat${n === 1 ? '' : 's'}`;

function pricing(mount: HTMLElement): Pricing {
    const { product, price, volumePrice, volumeSeats } = mount.dataset as Record<string, string>;
    return { product, price: Number(price), volumePrice: Number(volumePrice), volumeSeats: Number(volumeSeats) };
}

// A product's prices from its mount anywhere on the page, or null.
function pricingOf(product: string) {
    const mount = [...document.querySelectorAll<HTMLElement>('.key-mount, .buy-mount')].find(m => m.dataset.product === product);
    return mount ? pricing(mount) : null;
}

// What `seats` cost, priced by the license's total (`total`): the volume price applies to
// every seat once a license reaches volumeSeats.
function cost(p: Pricing, seats: number, total = seats) {
    const each = total >= p.volumeSeats ? p.volumePrice : p.price;
    return { each, sum: Math.round(seats * each * 100) / 100, volume: total >= p.volumeSeats };
}

async function post(path: string, body: unknown) {
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
const widgets = new Map<string | null | undefined, HTMLElement>();  // widget id -> its box

function pruneWidgets() {
    for (const [id, box] of widgets) {
        if (box.isConnected) continue;
        widgets.delete(id);
        window.turnstile?.remove(id!);
    }
}

addEventListener('pageshow', e => {
    if (!e.persisted || !window.turnstile) return;
    pruneWidgets();
    for (const id of widgets.keys()) window.turnstile.reset(id!);
});

function botCheck(box: HTMLElement) {
    let widget: string | null | undefined = null;
    loadTurnstile()
        .then(turnstile => {
            pruneWidgets();
            if (!box.isConnected) return;
            widget = turnstile.render(box, { sitekey: SITEKEY, theme: 'dark', size: 'flexible' });
            widgets.set(widget, box);
        })
        .catch(() => { box.innerHTML = 'Couldn\'t load the check that you\'re not a bot (an ad blocker?). Reload the page, or <a href="/inquiries/">use the contact form</a>.'; });
    return {
        token: () => box.querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]')?.value || '',
        reset: () => { if (window.turnstile && widget !== null) window.turnstile.reset(widget); },
    };
}

const WAIT = 'One moment: the check above that you are not a bot is still running.';

async function checkout(body: { product?: string; seats: number; key?: string }, status: HTMLElement, button: HTMLButtonElement) {
    button.disabled = true;
    status.textContent = 'Opening Stripe checkout…';
    try {
        location.href = (await post('/v1/checkout', body)).url;
    } catch (err) {
        status.innerHTML = `${esc((err as Error).message)} Please try again, or <a href="/inquiries/">get in touch</a>.`;
        button.disabled = false;
    }
}

function mountBuy(mount: HTMLElement) {
    const p = pricing(mount);
    mount.innerHTML = `
<form class="buy-card mt-7 ${CARD}" novalidate>
  <label class="mb-[.35rem] block text-[.9rem] text-dust" for="buy-seats-${p.product}">Seats</label>
  <div class="buy-row ${ROW}">
    <input class="${FIELD} w-28 text-[1.1rem]" id="buy-seats-${p.product}" type="number" inputmode="numeric" min="1" max="${MAX_SEATS}" step="1" value="1" required>
    <button class="${BUTTON} ${DISABLED}" type="submit">Buy with Stripe</button>
  </div>
  <p class="buy-total m-0 mt-4 ${TOTAL}" aria-live="polite"></p>
  <p class="buy-note m-0 mt-3 ${NOTE}">You'll give the licensee (your company, or you) and your email on Stripe's secure checkout. Your key appears on the next page and is emailed to you.</p>
  <p class="buy-status m-0 mt-2 ${STATUS}" role="status"></p>
</form>`;
    const form = mount.querySelector('form')!;
    const input = form.querySelector('input')!;
    const button = form.querySelector('button')!;
    const seats = () => Number(input.value);
    const valid = () => Number.isInteger(seats()) && seats() >= 1 && seats() <= MAX_SEATS;
    const update = () => {
        const n = seats();
        let line = `Choose between 1 and ${MAX_SEATS} seats.`;
        if (valid()) {
            const c = cost(p, n);
            line = `${plural(n)} × ${money(c.each)} = <b>${money(c.sum)}</b>`;
            if (c.volume) line += ` <span class="buy-save ${SAVE}">25% off</span>`;
            else if (n >= p.volumeSeats - 3) line += `<span class="buy-hint ${HINT}">${p.volumeSeats} seats would be ${money(cost(p, p.volumeSeats).sum)}, 25% off every seat.</span>`;
        }
        form.querySelector('.buy-total')!.innerHTML = line;
        button.disabled = !valid();
    };
    input.addEventListener('input', update);
    update();
    form.addEventListener('submit', e => {
        e.preventDefault();
        if (valid()) checkout({ product: p.product, seats: seats() }, form.querySelector<HTMLElement>('.buy-status')!, button);
    });
}

// Paste a key: its licensee, seats and the installs using it, and a way to add seats.
// It starts folded away behind an "Add seats to your license" link, like "Lost your license
// key?": with several products, a box under each would repeat all down the page. A click
// opens it, its card popping in.
function mountKey(mount: HTMLElement) {
    const p = pricing(mount);
    mount.innerHTML = `
<button type="button" class="key-open mt-[1.1rem] ${OPENER}" aria-expanded="false" aria-controls="key-card-${p.product}">Add seats to your license</button>
<form class="key-card mt-4 ${CARD} motion-safe:[&.is-opening]:origin-top-left motion-safe:[&.is-opening]:animate-card-pop" id="key-card-${p.product}" novalidate hidden>
  <h4 class="key-title m-0 mb-[.4rem] text-[1.15rem] font-[750] font-stretch-85% text-sand">Add seats to your license</h4>
  <label class="mb-3 block text-[.9rem] text-dust" for="key-${p.product}">Growing team? Paste your license key, pick how many more seats, and pay for just those. ${money(p.price)} a seat, 25% off every seat once your license has ${p.volumeSeats} or more. You get one new key covering them all.</label>
  <textarea class="${FIELD} w-full resize-y break-all font-mono text-[.85rem] leading-[1.5]" id="key-${p.product}" rows="3" spellcheck="false" autocomplete="off" placeholder="Paste your license key"></textarea>
  <div class="key-result mt-4 empty:hidden" aria-live="polite"></div>
</form>`;
    const form = mount.querySelector('form')!;
    const area = form.querySelector('textarea')!;
    const result = form.querySelector<HTMLElement>('.key-result')!;
    const opener = mount.querySelector<HTMLButtonElement>('.key-open')!;
    let timer: number | null = null, asked = '';
    opener.addEventListener('click', () => {
        opener.hidden = true;
        opener.setAttribute('aria-expanded', 'true');
        form.hidden = false;
        form.classList.add('is-opening');
        area.focus();
    });

    // The seats are the license's. Installs can't tell people from machines, so they're said
    // plainly, and more seats are suggested only when installs are clearly over: more than
    // twice the seats and at least 5 over, the license server's own rule. A key is priced as
    // its own product, whichever product's box it was pasted into, as the server charges.
    const show = (info: KeyInfo, key: string) => {
        const clearlyOver = info.installs > 2 * info.seats && info.installs - info.seats >= 5;
        const own = info.product === p.product ? p : pricingOf(info.product);
        let html = `<p class="key-facts ${ANSWER}"><b>${esc(info.licensee)}</b>: ${esc(info.productName)}, ${plural(info.seats)}, for life.</p>`;
        if (info.status === 'revoked') {
            result.innerHTML = html + `<p class="key-warn ${ANSWER} text-chile">This license was withdrawn, for example after a refund. If that's a mistake, <a href="/inquiries/">get in touch</a>.</p>`;
            return;
        }
        if (info.installs > 0) {
            html += `<p class="key-note ${ANSWER} ${NOTE}">About ${info.installs} install${info.installs === 1 ? '' : 's'} checked in over the last two weeks. One person on several machines counts more than once.`
                + (clearlyOver ? ' That\'s well over your seats, so if more people use it now, you can add seats below.' : '') + '</p>';
        }
        if (!info.isNewest) html += `<p class="key-note ${ANSWER} ${NOTE}">This is an older key. Your newest key covers ${plural(info.seats)}; both keep working.</p>`;
        html += `
<div class="buy-row mt-3 ${ROW}">
  <input class="${FIELD} w-28 text-[1.1rem]" type="number" inputmode="numeric" min="1" max="${MAX_SEATS - info.seats}" step="1" value="1" aria-label="Seats to add">
  <button class="${BUTTON} ${DISABLED}" type="button">Add seats with Stripe</button>
</div>
<p class="buy-total ${ANSWER} ${TOTAL}"></p>
<p class="buy-note ${ANSWER} ${NOTE}">You'll get one new key covering all your seats, shown right away and emailed. Your old key keeps working.</p>
<p class="buy-status ${ANSWER} ${STATUS}" role="status"></p>`;
        result.innerHTML = html;
        const input = result.querySelector('input')!;
        const button = result.querySelector('button')!;
        const update = () => {
            const n = Number(input.value);
            const ok = Number.isInteger(n) && n >= 1 && info.seats + n <= MAX_SEATS;
            button.disabled = !ok;
            if (!ok) return void (result.querySelector('.buy-total')!.textContent = `Add between 1 and ${MAX_SEATS - info.seats} seats.`);
            if (!own) return void (result.querySelector('.buy-total')!.textContent = `${n} more, ${plural(info.seats + n)} in all. Stripe shows the price.`);
            const c = cost(own, n, info.seats + n);
            result.querySelector('.buy-total')!.innerHTML = `${n} more × ${money(c.each)} = <b>${money(c.sum)}</b>, ${plural(info.seats + n)} in all`
                + (c.volume ? ` <span class="buy-save ${SAVE}">25% off</span>` : '');
        };
        input.addEventListener('input', update);
        update();
        button.addEventListener('click', () => checkout({ seats: Number(input.value), key }, result.querySelector<HTMLElement>('.buy-status')!, button));
    };

    const look = async () => {
        const key = area.value.replace(/\s+/g, '');
        if (key === asked) return;
        asked = key;
        if (key.length < 20) return void (result.innerHTML = '');
        result.innerHTML = `<p class="key-note ${ANSWER} ${NOTE}">Looking it up…</p>`;
        try {
            const info: KeyInfo = await post('/v1/lookup', { key });
            if (asked === key) show(info, key);
        } catch (err) {
            if (asked === key) result.innerHTML = `<p class="key-warn ${ANSWER} text-chile">${esc((err as Error).message)}</p>`;
        }
    };
    area.addEventListener('input', () => { clearTimeout(timer!); timer = setTimeout(look, 350); });
}

// Lost keys: every key on file for an address is emailed to it. The answer never says
// whether there were any, so the box can't tell anyone who bought. It starts folded away
// behind a "Lost your license key?" link: the form, and its Turnstile check, appear only
// when that's clicked. A send turns it into the contact form's "sent" card, with a Send
// again that waits out the server's 30 seconds between emails to one address.
const RESEND_AFTER = 30;

function mountRecover(mount: HTMLElement) {
    mount.innerHTML = `
<div class="recover-card mt-10 border-t border-t-ridge pt-7">
  <button type="button" class="recover-open ${OPENER}" aria-expanded="false">Lost your license key?</button>
  <div class="recover-body" hidden>
  <h3 class="m-0 mb-[.4rem] text-[1.15rem] font-[750] font-stretch-85%">Lost your key?</h3>
  <form novalidate>
    <p class="m-0 mb-3 text-dust">Enter the email you bought with, and we'll email it every license key on file for it.</p>
    <div class="buy-row ${ROW}">
      <input class="${FIELD} w-72 max-w-full text-[1.1rem]" type="email" autocomplete="email" placeholder="you@company.com" aria-label="Email" required>
      <button class="${BUTTON} ${DISABLED}" type="submit">Email my keys</button>
    </div>
    <div class="cf-turnstile mt-[.9rem]"></div>
    <p class="buy-status m-0 mb-3 ${STATUS}" role="status"></p>
  </form>
  <div class="${SENT_CARD} mt-2" tabindex="-1" hidden>
    ${SENT_CHECK}
    <div>
      <p class="${SENT_TITLE}">Sent. Check your inbox.</p>
      <p class="${SENT_NOTE}"></p>
      <p class="recover-again m-0 mt-3 flex items-center gap-4 text-[.9rem] text-dust"><button class="cursor-pointer rounded-full border-0 bg-transparent px-4 py-[.45rem] font-semibold text-sand inset-ring inset-ring-ridge enabled:hover:text-turq enabled:hover:inset-ring-turq disabled:cursor-default disabled:text-dust disabled:tabular-nums" type="button" disabled></button> <a href="/inquiries/">Contact form</a></p>
    </div>
  </div>
  </div>
  <p class="store-help m-0 mt-[.9rem] text-[.95rem] text-dust [.recover-body:not([hidden])+&]:mt-6">Questions, or trouble with a purchase or a key? <a href="/inquiries/">Get in touch</a>. I read every message myself.</p>
</div>`;
    const form = mount.querySelector('form')!;
    const input = form.querySelector('input')!;
    const button = form.querySelector('button')!;
    const status = form.querySelector<HTMLElement>('.buy-status')!;
    const sent = mount.querySelector<HTMLElement>('.inquiry-sent')!;
    const again = sent.querySelector<HTMLButtonElement>('.recover-again button')!;
    const opener = mount.querySelector<HTMLButtonElement>('.recover-open')!;
    const body = mount.querySelector<HTMLElement>('.recover-body')!;
    // The Turnstile check renders only once the box is opened.
    let human: ReturnType<typeof botCheck> | null = null;
    let countdown: number | null = null;
    opener.addEventListener('click', () => {
        opener.hidden = true;
        opener.setAttribute('aria-expanded', 'true');
        body.hidden = false;
        human ??= botCheck(form.querySelector<HTMLElement>('.cf-turnstile')!);
        input.focus();
    });

    const showSent = (email: string) => {
        sent.querySelector('.sent-note')!.innerHTML = `If <b class="text-sand">${esc(email)}</b> has license keys on file, they're on their way from licenses@adamschaefers.com. Give it a minute, and check your spam folder.`;
        form.hidden = true;
        sent.hidden = false;
        sent.classList.remove('is-arriving');
        void sent.offsetWidth;  // restart the arrival animation on a second send
        sent.classList.add('is-arriving');
        sent.focus();
        let left = RESEND_AFTER;
        again.disabled = true;
        again.textContent = `Send again in ${left}s`;
        clearInterval(countdown!);
        countdown = setInterval(() => {
            if (!mount.isConnected) return clearInterval(countdown!);
            left -= 1;
            if (left > 0) return void (again.textContent = `Send again in ${left}s`);
            clearInterval(countdown!);
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
            status.innerHTML = `${esc((err as Error).message)} You can also <a href="/inquiries/">use the contact form</a>.`;
        }
        button.disabled = false;
        human?.reset();
    });
}

// A product's title gets a link icon that copies its address (/store/<id>/, which opens the store
// at that product, and whose page carries the product's link preview), always the live one
// so a shared link works anywhere.
const LINK_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.1 1.1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.1-1.1"/></svg>';

function mountShare(product: HTMLElement) {
    const title = product.querySelector('.product-body > h3');
    const id = product.id.replace(/^product-/, '');
    if (!title || !id) return;
    const url = `https://adamschaefers.com/store/${id}/`;
    // timer: the note's, which clears it.
    const button = document.createElement('button') as HTMLButtonElement & { timer?: number };
    button.type = 'button';
    button.className = 'product-link relative inline-flex cursor-pointer items-center gap-[.4rem] rounded-md border-0 bg-transparent p-[.2rem] align-middle text-dust '
        + 'hover:text-turq focus-visible:text-turq focus-visible:outline-[2px] focus-visible:outline-offset-1 focus-visible:outline-turq';
    button.title = `Copy link: ${url}`;
    button.setAttribute('aria-label', `Copy a link to ${title.textContent!.trim()}`);
    button.innerHTML = `${LINK_ICON}<span class="product-link-note absolute top-1/2 left-full ml-[.3rem] -translate-y-1/2 whitespace-nowrap rounded-md bg-mesa px-2 py-[.15rem] `
        + 'text-[.8rem] font-medium font-stretch-100% tracking-[0] text-turq inset-ring inset-ring-ridge empty:hidden" aria-live="polite"></span>';
    title.append(' ', button);
    const note = button.querySelector('.product-link-note')!;
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
function mountZoom(product: HTMLElement) {
    const img = product.querySelector<HTMLImageElement>('.product-image');
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
    const big = img.cloneNode() as HTMLImageElement;
    big.className = '';
    dialog.append(big);
    product.append(dialog);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    const morph = (reverse: boolean) => {
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

export function mountStore(root: ParentNode) {
    for (const product of root.querySelectorAll<HTMLElement>('.product:not([data-mounted])')) {
        product.dataset.mounted = '1';
        mountShare(product);
        mountZoom(product);
    }
    for (const mount of root.querySelectorAll<HTMLElement>('.buy-mount:not([data-mounted])')) {
        mount.dataset.mounted = '1';
        mountBuy(mount);
    }
    for (const mount of root.querySelectorAll<HTMLElement>('.key-mount:not([data-mounted])')) {
        mount.dataset.mounted = '1';
        mountKey(mount);
    }
    for (const mount of root.querySelectorAll<HTMLElement>('.recover-mount:not([data-mounted])')) {
        mount.dataset.mounted = '1';
        mountRecover(mount);
    }
    // The license server's admin page (Cloudflare Access asks who you are).
    for (const a of root.querySelectorAll<HTMLAnchorElement>('.store-admin a')) a.href = `${API}/admin`;
}

// The key page's lines: the lead, and the card's facts (each a term over its value).
const LEAD = 'license-lead text-[1.1rem]';
const TERM = 'text-[.85rem] text-dust';
const VALUE = 'm-0 font-semibold wrap-anywhere';

function keyCard(l: License) {
    const seats = plural(l.seats);
    const lead = l.added
        ? `Your license now covers <b>${seats}</b>, and here's its new key. Your old key keeps working, but use this one from now on. <b>Screenshot or print this page</b> to keep it.`
        : `Here's your ${esc(l.productName || 'license')}${l.productName ? ' license' : ''} key. <b>Screenshot or print this page</b> to keep it.`;
    return `
<p class="${LEAD}">${lead}</p>
<div class="license-card mt-5 mb-6 ${CARD}">
  <dl class="m-0 mb-5 flex flex-wrap gap-x-10 gap-y-3">
    ${l.productName ? `<div><dt class="${TERM}">Product</dt><dd class="${VALUE}">${esc(l.productName)}</dd></div>` : ''}
    <div><dt class="${TERM}">Licensee</dt><dd class="${VALUE}">${esc(l.licensee)}</dd></div>
    <div><dt class="${TERM}">Seats</dt><dd class="${VALUE}">${seats}, for life</dd></div>
    <div><dt class="${TERM}">Email</dt><dd class="${VALUE}">${esc(l.email)}</dd></div>
  </dl>
  <pre class="license-key m-0 whitespace-pre-wrap break-all rounded-[10px] bg-sky px-[1.1rem] py-4 font-mono text-[.85rem] leading-[1.5] select-all inset-ring inset-ring-ridge">${esc(l.key)}</pre>
  <div class="license-actions mt-4 flex gap-3">
    <button class="${BUTTON}" type="button" data-do="copy">Copy key</button>
    <button class="cursor-pointer rounded-full border-0 bg-transparent px-[1.6rem] py-[.7rem] font-bold text-sand inset-ring inset-ring-ridge hover:text-turq hover:inset-ring-turq" type="button" data-do="print">Print</button>
  </div>
</div>
<p>We've also emailed it to <b>${esc(l.email)}</b> from licenses@adamschaefers.com. Please don't reply to that email: nobody reads that address. If anything's wrong or you have a question, <a href="/inquiries/">use the contact form</a>.</p>
<h3>Using it</h3>
<p>${esc(l.howToUse)}</p>
<p>Need more seats later? Paste this key in the <a href="${l.product ? `/store/${encodeURIComponent(l.product)}/` : '/store/'}">store</a>.</p>
${l.status === 'revoked' ? '<p class="license-revoked text-chile">This license has been withdrawn, for example after a refund. If that\'s a mistake, <a href="/inquiries/">get in touch</a>.</p>' : ''}`;
}

export function mountLicense(root: ParentNode) {
    const mount = root.querySelector<HTMLElement>('#license-mount');
    // Keyed by checkout, so a reused element shows the right purchase.
    const session = mount?.dataset.session;
    if (!mount || mount.dataset.mounted === session) return;
    mount.dataset.mounted = session;
    const say = (html: string) => { if (mount.isConnected) mount.innerHTML = html; };
    say(`<p class="${LEAD}">Getting your key…</p>`);

    let tries = 0;
    const load = async () => {
        if (!mount.isConnected) return;
        try {
            const r = await fetch(`${API}/v1/checkout/${encodeURIComponent(session!)}`);
            if (r.status === 202 && tries++ < 30) {
                say(`<p class="${LEAD}">Your payment is still being confirmed. Your key will appear here in a moment…</p>`);
                return setTimeout(load, 2000);
            }
            // Asked too often: wait a little longer, then ask again.
            if (r.status === 429 && tries++ < 30) return setTimeout(load, 6000);
            // The page shows a key for a week after the purchase (the license server's KEY_SHOWN_FOR).
            if (r.status === 410) return say(`<p class="${LEAD}">This page showed your key for a week after your purchase.</p>
<p>It's in the email we sent you from licenses@adamschaefers.com. Can't find it? Have every key on file emailed to you from the <a href="/store/">store</a> ("Lost your key?"), or <a href="/inquiries/">use the contact form</a>.</p>`);
            const data = await r.json().catch(() => ({}));
            if (!r.ok || !data.key) throw new Error(data.error || 'not found');
            say(keyCard(data));
            mount.addEventListener('click', async e => {
                const target = e.target as HTMLElement;
                const act = target.closest<HTMLElement>('button[data-do]')?.dataset.do;
                if (act === 'print') window.print();
                if (act === 'copy') {
                    try {
                        await navigator.clipboard.writeText(data.key);
                        target.textContent = 'Copied';
                    } catch {
                        // No clipboard access: select the key, ready to copy by hand.
                        const range = document.createRange();
                        range.selectNodeContents(mount.querySelector('.license-key')!);
                        getSelection()!.removeAllRanges();
                        getSelection()!.addRange(range);
                        target.textContent = 'Selected: press Ctrl+C';
                    }
                    setTimeout(() => { target.textContent = 'Copy key'; }, 2500);
                }
            });
        } catch {
            say(`<p class="${LEAD}">We couldn't find this purchase.</p>
<p>If you've paid, your key is on its way to your email from licenses@adamschaefers.com. If it doesn't arrive within a few minutes, check your spam folder. You can also have every key on file emailed to you from the <a href="/store/">store</a> ("Lost your key?"), or <a href="/inquiries/">use the contact form</a> and we'll sort it out.</p>`);
        }
    };
    load();
}
