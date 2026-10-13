// Contact form, in the same dress as enchant.games'. It posts to this site's own Worker at
// contact-api.adamschaefers.com (contact-worker/), which checks Turnstile and emails the message.
// A view opts in with an empty <div id="contact-mount"></div> in its index.org section.

declare global {
    interface Window {
        turnstile?: Turnstile.Turnstile;
        onTurnstileLoad?: () => void;
    }
}

const ACTION = 'https://contact-api.adamschaefers.com/';
const SITEKEY = '0x4AAAAAAFSCqQ6GlpqWfqoi';
const DRAFT_KEY = 'contact-draft';
const FIELDS = ['name', 'email', 'message'] as const;
const DRAFT_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

type Field = (typeof FIELDS)[number];
// The unsent message kept in localStorage.
type Draft = { savedAt: number } & Partial<Record<Field, string>>;
interface ContactForm extends HTMLFormElement {
    readonly elements: HTMLFormControlsCollection & Record<Field, HTMLInputElement | HTMLTextAreaElement>;
}

// Its styles are Tailwind's utilities (site.css). The card that takes a form's place once it's
// sent, its check drawing itself, is the store's too (src/store.ts, "Lost your key?").
export const SENT_CARD = 'inquiry-sent flex origin-[50%_0] items-center gap-5 rounded-2xl bg-mesa px-7 py-6 inset-ring inset-ring-ridge '
    + 'focus:outline-none [&.is-arriving]:animate-sent-arrive';
export const SENT_CHECK = '<svg class="sent-check size-13 flex-none fill-none stroke-turq [stroke-linecap:round] [stroke-linejoin:round]" viewBox="0 0 52 52" aria-hidden="true">'
    + '<circle class="stroke-[2.5] [stroke-dasharray:145] in-[.is-arriving]:animate-draw-circle in-[.is-arriving]:[--len:145]" cx="26" cy="26" r="23"/>'
    + '<path class="stroke-4 [stroke-dasharray:34] in-[.is-arriving]:animate-draw-tick in-[.is-arriving]:[--len:34]" d="M15.5 27.5l7 7 14-15"/></svg>';
export const SENT_TITLE = 'sent-title m-0 text-[1.35rem] leading-[1.2] font-[750] font-stretch-85% text-sand';
export const SENT_NOTE = 'sent-note m-0 mt-[.2rem] text-dust';
const LABEL = 'mb-[.35rem] block text-[.9rem] text-dust';
const FIELD = 'box-border w-full rounded-[10px] border border-ridge bg-mesa px-[.85rem] py-[.7rem] text-sand '
    + 'focus-visible:border-transparent focus-visible:outline-[2px] focus-visible:outline-offset-1 focus-visible:outline-turq';
const FORM_HTML = `
<div class="inquiry-card perspective-[1100px] perspective-origin-top [transition:height_.45s_cubic-bezier(.3,.7,.2,1)]">
<form id="contact-form" class="grid grid-cols-[1fr_1fr] gap-x-5 gap-y-[1.1rem] phone:grid-cols-[1fr] [&.is-leaving]:pointer-events-none [&.is-leaving]:origin-bottom [&.is-leaving]:animate-form-leave" action="${ACTION}" method="POST">
  <div><label class="${LABEL}" for="cf-name">Name</label>
    <input class="${FIELD}" id="cf-name" type="text" name="name" maxlength="200" autocomplete="name"></div>
  <div><label class="${LABEL}" for="cf-email">Email</label>
    <input class="${FIELD}" id="cf-email" type="email" name="email" maxlength="200" autocomplete="email" required></div>
  <div class="col-span-full"><label class="${LABEL}" for="cf-message">Message</label>
    <textarea class="${FIELD} min-h-36 resize-y" id="cf-message" name="message" maxlength="5000" rows="6" required></textarea></div>
  <input class="${FIELD} absolute -left-[9999px]" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
  <div class="cf-turnstile col-span-full"></div>
  <button class="cursor-pointer [justify-self:start] rounded-full border-0 bg-turq px-8 py-3 font-bold text-sky hover:bg-surf disabled:cursor-progress disabled:opacity-60" type="submit">Send</button>
  <p id="contact-status" class="col-span-full m-0 text-dust empty:hidden" role="status"></p>
</form>
<div class="${SENT_CARD}" tabindex="-1" hidden>
  ${SENT_CHECK}
  <div><p class="${SENT_TITLE}">Sent. Thank you!</p><p class="${SENT_NOTE}">I'll get back to you by email.</p></div>
</div>
</div>`;

// The page is rendered client-side, so Turnstile is loaded once and rendered explicitly
// into each freshly mounted form rather than scanning the page on load. src/store.ts
// shares this loader: Turnstile's script must be on the page only once.
let turnstileReady: Promise<Turnstile.Turnstile> | null = null;
export function loadTurnstile(): Promise<Turnstile.Turnstile> {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (!turnstileReady) {
        turnstileReady = new Promise((resolve, reject) => {
            window.onTurnstileLoad = () => resolve(window.turnstile!);
            const s = document.createElement('script');
            s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTurnstileLoad';
            s.async = true;
            s.onerror = () => { turnstileReady = null; reject(new Error('Turnstile failed to load')); };
            document.head.appendChild(s);
        });
    }
    return turnstileReady;
}

export function mountContactForms(root: ParentNode) {
    const mount = root.querySelector<HTMLElement>('#contact-mount');
    if (!mount || mount.dataset.mounted) return;
    mount.dataset.mounted = '1';
    mount.innerHTML = FORM_HTML;

    const card = mount.querySelector<HTMLElement>('.inquiry-card')!;
    const form = mount.querySelector<ContactForm>('#contact-form')!;
    const status = form.querySelector<HTMLElement>('#contact-status')!;
    const button = form.querySelector('button')!;
    const sent = card.querySelector<HTMLElement>('.inquiry-sent')!;
    let widget: string | null | undefined = null;

    loadTurnstile()
        .then(turnstile => {
            if (!mount.isConnected) return;
            widget = turnstile.render(form.querySelector<HTMLElement>('.cf-turnstile')!, { sitekey: SITEKEY, theme: 'dark' });
        })
        .catch(() => { status.textContent = 'Could not load the verification check. Reload the page and try again.'; });

    // Keep an unsent draft in this browser so a failed check, refresh or closed tab doesn't lose it.
    // A successful send resets the form, which clears the draft.
    try {
        const draft: Draft | null = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
        if (draft && Date.now() - draft.savedAt < DRAFT_MAX_AGE) {
            FIELDS.forEach(f => { if (draft[f] && !form.elements[f].value) form.elements[f].value = draft[f]; });
        } else if (draft) {
            localStorage.removeItem(DRAFT_KEY);
        }
    } catch (e) {}
    form.addEventListener('input', () => {
        const draft: Draft = { savedAt: Date.now() };
        FIELDS.forEach(f => { draft[f] = form.elements[f].value; });
        try {
            if (draft.name || draft.email || draft.message!.trim()) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
            else localStorage.removeItem(DRAFT_KEY);
        } catch (e) {}
    });

    // Post to the worker and show the result inline.
    form.addEventListener('submit', e => {
        e.preventDefault();
        const token = form.querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]');
        if (!token || !token.value) {
            status.textContent = 'Please complete the verification check first.';
            return;
        }
        button.disabled = true;
        status.textContent = 'Sending...';
        fetch(form.action, { method: 'POST', body: new FormData(form) })
            .then(r => r.json())
            .then(r => {
                if (r.ok) { form.reset(); status.textContent = 'Sent. Thank you!'; }
                else { status.textContent = r.error || 'Something went wrong. Please try again.'; }
            })
            .catch(() => { status.textContent = 'Could not reach the server. Please try again.'; })
            .finally(() => {
                button.disabled = false;
                if (window.turnstile && widget !== null) window.turnstile.reset(widget);
            });
    });

    // After a successful send, flip the form away and show the sent card in its place.
    function clear() {
        FIELDS.forEach(f => { form.elements[f].value = ''; });
    }
    form.addEventListener('reset', e => {
        try { localStorage.removeItem(DRAFT_KEY); } catch (err) {}
        // Keep the typed text on the card while it flips away; clear it once hidden.
        e.preventDefault();
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
            clear();
            form.hidden = true;
            sent.hidden = false;
            sent.focus({ preventScroll: true });
            return;
        }
        card.style.height = card.offsetHeight + 'px';
        form.classList.add('is-leaving');
        form.addEventListener('animationend', () => {
            clear();
            form.hidden = true;
            sent.hidden = false;
            sent.classList.add('is-arriving');
            card.style.height = sent.offsetHeight + 'px';
            card.addEventListener('transitionend', () => { card.style.height = ''; }, { once: true });
            sent.focus({ preventScroll: true });
        }, { once: true });
    });
}
