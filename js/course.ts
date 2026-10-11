// The Emacs course (index.org's Contact section, the sidebar): a thumbnail until played, then
// a YouTube embed. Episode buttons swap the video.

export function mountCourse() {
    const course = document.querySelector<HTMLElement>('.course')!;
    const player = course.querySelector<HTMLElement>('.course-player')!;
    const now = course.querySelector<HTMLElement>('.course-now')!;
    let current = course.querySelector<HTMLButtonElement>('.course-episodes [aria-current]')!;
    function embed(btn: HTMLButtonElement) {
        const f = document.createElement('iframe');
        f.src = 'https://www.youtube-nocookie.com/embed/' + btn.dataset.id + '?autoplay=1&rel=0';
        f.title = 'Episode ' + btn.textContent + ': ' + btn.dataset.title;
        f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
        f.allowFullscreen = true;
        player.replaceChildren(f);
    }
    function select(btn: HTMLButtonElement) {
        current.removeAttribute('aria-current');
        btn.setAttribute('aria-current', 'true');
        current = btn;
        now.children[0].textContent = btn.textContent;
        now.childNodes[1].textContent = ' ' + btn.dataset.title + ' ';
        now.children[1].textContent = btn.dataset.len!;
        const play = player.querySelector('.course-play');
        if (play) {
            play.querySelector('img')!.src = 'https://i.ytimg.com/vi/' + btn.dataset.id + '/hqdefault.jpg';
            play.setAttribute('aria-label', 'Play episode ' + btn.textContent);
        } else {
            embed(btn);
        }
    }
    player.addEventListener('click', function (e) { if ((e.target as Element).closest('.course-play')) embed(current); });
    course.querySelector('.course-episodes')!.addEventListener('click', function (e) {
        const btn = (e.target as Element).closest('button');
        if (btn && btn !== current) select(btn);
    });
}
