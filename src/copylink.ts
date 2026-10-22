// A link icon after a title that copies an address to what it titles, always the live
// site's, so a shared link works anywhere: a product's (store.ts) and a post's headings
// (app.ts).

const LINK_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.1 1.1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.1-1.1"/></svg>';

export function copyLink(title: Element, url: string) {
    // timer: the note's, which clears it.
    const button = document.createElement('button') as HTMLButtonElement & { timer?: number };
    button.type = 'button';
    button.className = 'copy-link relative inline-flex cursor-pointer items-center gap-[.4rem] rounded-md border-0 bg-transparent p-[.2rem] align-middle text-dust '
        + 'hover:text-turq focus-visible:text-turq focus-visible:outline-[2px] focus-visible:outline-offset-1 focus-visible:outline-turq';
    button.title = `Copy link: ${url}`;
    button.setAttribute('aria-label', `Copy a link to ${title.textContent!.trim()}`);
    button.innerHTML = `${LINK_ICON}<span class="copy-link-note absolute top-1/2 left-full ml-[.3rem] -translate-y-1/2 whitespace-nowrap rounded-md bg-mesa px-2 py-[.15rem] `
        + 'text-[.8rem] font-medium font-stretch-100% tracking-[0] text-turq inset-ring inset-ring-ridge empty:hidden" aria-live="polite"></span>';
    title.append(' ', button);
    const note = button.querySelector('.copy-link-note')!;
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
