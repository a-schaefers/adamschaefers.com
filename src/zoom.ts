// A picture that grows out of its small copy (SMALL, in the button THUMB) into a large view
// (BIG, alone in DIALOG), and shrinks back on a click anywhere, Esc or a swipe: the profile
// photo (profile.ts) and the products' images (store.ts).

export function mountZoom(thumb: HTMLButtonElement, small: HTMLImageElement, dialog: HTMLDialogElement, big: HTMLImageElement) {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    // The grow (or, reversed, the shrink), from FROM when the picture is mid-swipe. It starts
    // clipped to the part the small copy shows (object-fit: cover, at its object-position)
    // with the small copy's corners (the avatar's circle), then opens out to the whole
    // picture, its corners straightening.
    function morph(reverse: boolean, from = 'none') {
        big.style.transform = '';
        const a = small.getBoundingClientRect(), b = big.getBoundingClientRect();
        const style = getComputedStyle(small);
        const [px, py] = style.objectPosition.split(' ').map(v => parseFloat(v) / 100);
        const wide = b.width / b.height > a.width / a.height;
        const w = wide ? b.height * a.width / a.height : b.width, h = wide ? b.height : b.width * a.height / a.width;
        const left = (b.width - w) * px, top = (b.height - h) * py;
        const right = b.width - w - left, bottom = b.height - h - top;
        const s = a.width / w;
        const radius = style.borderTopLeftRadius.endsWith('%') ? parseFloat(style.borderTopLeftRadius) / 100 * w : parseFloat(style.borderTopLeftRadius) / s;
        // Scaled about the picture's middle, the shown part's middle lands on the small copy's.
        const dx = a.left + a.width / 2 - (b.left + b.width / 2) - s * (left + w / 2 - b.width / 2);
        const dy = a.top + a.height / 2 - (b.top + b.height / 2) - s * (top + h / 2 - b.height / 2);
        // Opened, the clip reaches past the picture, so its shadow shows.
        const frames = [
            { transform: `translate(${dx}px, ${dy}px) scale(${s})`, clipPath: `inset(${top}px ${right}px ${bottom}px ${left}px round ${radius}px)` },
            { transform: from, clipPath: 'inset(-120px -120px -120px -120px round 0px)' },
        ];
        if (reverse) frames.reverse();
        return big.animate(frames, { duration: reduce.matches ? 0 : 450, easing: 'cubic-bezier(.2, .9, .25, 1)' });
    }
    thumb.addEventListener('click', () => {
        dialog.classList.remove('is-closing');
        dialog.showModal();
        thumb.classList.add('is-open');
        morph(false);
    });
    function close(from?: string) {
        if (dialog.classList.contains('is-closing')) return;
        dialog.classList.add('is-closing');
        morph(true, from).onfinish = () => {
            dialog.style.removeProperty('--drag');
            dialog.close();
            dialog.classList.remove('is-closing');
            thumb.classList.remove('is-open');
            thumb.focus({ preventScroll: true });
        };
    }
    // A swipe: the picture follows the finger, shrinking and letting the page show through
    // as it goes (--drag, site.css); let go far enough (or flicked) and it shrinks back into
    // the small copy, short of that it settles back. A drag isn't also a click.
    let start: { id: number; x: number; y: number; t: number } | null = null;
    let dragged = false;
    dialog.addEventListener('pointerdown', e => {
        if (!e.isPrimary || dialog.classList.contains('is-closing')) return;
        start = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp };
        dragged = false;
    });
    dialog.addEventListener('pointermove', e => {
        if (!start || e.pointerId !== start.id) return;
        const dx = e.clientX - start.x, dy = e.clientY - start.y;
        if (!dragged && Math.hypot(dx, dy) < 10) return;
        if (!dragged) { dragged = true; dialog.setPointerCapture(e.pointerId); }
        const far = Math.min(Math.hypot(dx, dy) / 300, 1);
        big.style.transform = `translate(${dx}px, ${dy}px) scale(${1 - far * .25})`;
        dialog.style.setProperty('--drag', String(far));
    });
    function release(e: PointerEvent) {
        if (!start || e.pointerId !== start.id) return;
        const { x, y, t } = start;
        start = null;
        if (!dragged) return;
        const far = Math.hypot(e.clientX - x, e.clientY - y);
        const from = big.style.transform;
        if (e.type === 'pointerup' && (far > 90 || far / (e.timeStamp - t) > .5)) close(from);
        else {
            big.style.transform = '';
            dialog.style.removeProperty('--drag');
            big.animate([{ transform: from }, { transform: 'none' }], { duration: reduce.matches ? 0 : 250, easing: 'cubic-bezier(.2, .9, .25, 1)' });
        }
    }
    dialog.addEventListener('pointerup', release);
    dialog.addEventListener('pointercancel', release);
    dialog.addEventListener('click', () => {
        if (dragged) dragged = false;
        else close();
    });
    dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
}
