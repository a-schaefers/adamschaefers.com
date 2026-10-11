// Profile photo (index.org's Contact section, the sidebar): grows out of the avatar into a
// large view; click anywhere or Esc shrinks it back.

export function mountProfileZoom() {
    const thumb = document.querySelector<HTMLButtonElement>('.profile-zoom')!;
    const dialog = document.querySelector<HTMLDialogElement>('.photo-dialog')!;
    const big = dialog.querySelector('img')!;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    function morph(reverse: boolean) {
        const a = thumb.getBoundingClientRect(), b = big.getBoundingClientRect();
        const dx = a.left + a.width / 2 - (b.left + b.width / 2);
        const dy = a.top + a.height / 2 - (b.top + b.height / 2);
        const frames = [
            { transform: 'translate(' + dx + 'px, ' + dy + 'px) scale(' + a.width / b.width + ')', borderRadius: '50%' },
            { transform: 'none', borderRadius: '24px' },
        ];
        if (reverse) frames.reverse();
        return big.animate(frames, { duration: reduce.matches ? 0 : 450, easing: 'cubic-bezier(.2, .9, .25, 1)' });
    }
    thumb.addEventListener('click', function () {
        dialog.classList.remove('is-closing');
        dialog.showModal();
        thumb.classList.add('is-open');
        morph(false);
    });
    function close() {
        if (dialog.classList.contains('is-closing')) return;
        dialog.classList.add('is-closing');
        morph(true).onfinish = function () {
            dialog.close();
            dialog.classList.remove('is-closing');
            thumb.classList.remove('is-open');
            thumb.focus({ preventScroll: true });
        };
    }
    dialog.addEventListener('click', close);
    dialog.addEventListener('cancel', function (e) { e.preventDefault(); close(); });
}
