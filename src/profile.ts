// Profile photo (index.org's Contact section, the sidebar): grows out of the avatar into a
// large view (zoom.ts). The avatar is a small picture; the large one (me.jpeg, lazy in
// index.org, so a closed dialog doesn't fetch it) loads once the avatar is pointed at or
// focused, ahead of the click.

import { mountZoom } from './zoom.ts';

export function mountProfileZoom() {
    const thumb = document.querySelector<HTMLButtonElement>('.profile-zoom')!;
    const dialog = document.querySelector<HTMLDialogElement>('.photo-dialog')!;
    const big = dialog.querySelector('img')!;
    const fetchBig = () => { big.loading = 'eager'; };
    thumb.addEventListener('pointerenter', fetchBig, { once: true });
    thumb.addEventListener('focus', fetchBig, { once: true });
    mountZoom(thumb, thumb.querySelector('img')!, dialog, big);
}
