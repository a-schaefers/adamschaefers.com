// Videos stream adaptively where they can. Each video on the media domain has, beside
// NAME.mp4, NAME.m3u8: the same video in up to three sizes, 720p down to 360p, cut into
// 2-second segments (HLS; site-worker/src/ladder.ts makes them). site.el names it on the
// <video> as data-hls, when it answers. The <video> keeps the MP4 as its src, which is what
// plays without JavaScript, before this runs, and wherever HLS can't. Here, each such video
// gets its HLS instead:
//
// - Safari, and every browser on an iPhone or iPad, plays HLS itself: the playlist becomes
//   the <video>'s src.
// - Elsewhere, hls.js plays it, through Media Source Extensions, once the video is played
//   (until then the MP4 gives its length and first frame): at the play, the video pauses,
//   hls.js (js/hls.<hash>.js, fetched then, or earlier when a pointer or finger reaches the
//   video) takes it up where it was, and it plays on. It chooses each next segment's size
//   from the bandwidth it measures, no larger than the player is on screen, and steps down
//   rather than stalling.
// - Anything going wrong (hls.js failing to load or to play, a playlist missing) puts the MP4
//   back, where the video was.

import type Hls from 'hls.js';

type HlsClass = typeof Hls;
// A video's HLS: its playlist, the MP4 to fall back on, hls.js once it plays it, where the play
// began (at), and whether HLS has failed it (then the MP4 it has is what it plays).
interface Stream { url: string; mp4: string; hls?: Hls; at?: number; failed?: boolean }

// Each video given its HLS, and how; lit reuses a <video> for another entry's video, so a
// video's stream is redone when its data-hls changes.
const streams = new Map<HTMLVideoElement, Stream>();
let hlsjs: Promise<HlsClass | null> | undefined;

/** hls.js, from SCRIPT (once), or null when it can't load or can't play here. */
function load(script: string) {
    return hlsjs ??= import(script).then(
        (module: { default: HlsClass }) => module.default.isSupported() ? module.default : null,
        () => null);
}

// Apple's browsers play HLS themselves, better than any script (Safari reports its vendor as
// Apple's, and so does every browser on iOS, all being Safari's engine).
const apple = /Apple/.test(navigator.vendor);
const mediaSource = 'MediaSource' in window || 'ManagedMediaSource' in window;

/** Give each <video data-hls> in ROOT its HLS (hls.js from SCRIPT where it's needed), and let
    the videos no longer on the page go. Run after each render. */
export function streamVideos(root: ParentNode, script: string) {
    for (const [video, stream] of streams) {
        if (!video.isConnected) {
            stream.hls?.destroy();
            streams.delete(video);
        }
    }
    for (const video of root.querySelectorAll<HTMLVideoElement>('video[data-hls]')) {
        const url = video.dataset.hls!;
        const stream = streams.get(video);
        if (stream?.url === url) continue;
        if (stream) {
            // lit has given this <video> another video: the old stream goes, and lit's new src stays.
            const src = video.getAttribute('src');
            stream.hls?.destroy();
            if (src && video.getAttribute('src') !== src) video.setAttribute('src', src);
        }
        start(video, url, script);
    }
}

function start(video: HTMLVideoElement, url: string, script: string) {
    const stream: Stream = { url, mp4: video.getAttribute('src') ?? '' };
    streams.set(video, stream);
    if (apple && video.canPlayType('application/vnd.apple.mpegurl')) {
        video.addEventListener('error', () => fallBack(video, stream), { once: true });
        video.src = url;
        return;
    }
    if (!mediaSource) return;
    // hls.js on its way before the play, when one may be coming.
    const soon = () => void load(script);
    for (const type of ['pointerenter', 'focus', 'touchstart']) video.addEventListener(type, soon, { once: true, passive: true });
    video.addEventListener('play', async () => {
        if (streams.get(video) !== stream || stream.failed) return;
        stream.at = video.currentTime;
        // The MP4 stops downloading: the connection is hls.js's from here.
        video.pause();
        video.removeAttribute('src');
        video.load();
        const HlsJs = await load(script);
        if (streams.get(video) !== stream) return;
        if (!HlsJs) return fallBack(video, stream);
        const hls = new HlsJs({
            autoStartLoad: false,
            // A first guess of 1 Mbps (hls.js's is 500 kbps): 480p to begin with, then each
            // segment's size from what the last ones took to arrive.
            startLevel: -1,
            abrEwmaDefaultEstimate: 1_000_000,
            // No larger than the player is on screen (taller in full screen).
            capLevelToPlayerSize: true,
        });
        stream.hls = hls;
        hls.on(HlsJs.Events.ERROR, (_, error) => { if (error.fatal) fallBack(video, stream); });
        // Attached first, then the playlist: a play before the attachment has finished loading
        // would be cut short by it.
        hls.once(HlsJs.Events.MEDIA_ATTACHED, () => hls.loadSource(url));
        hls.once(HlsJs.Events.MANIFEST_PARSED, () => {
            hls.startLoad(stream.at! > 0 ? stream.at : -1);
            play(video);
        });
        hls.attachMedia(video);
    }, { once: true });
}

/** Play VIDEO; if a load cuts the play short, play once it can. */
function play(video: HTMLVideoElement) {
    video.play().catch((error: DOMException) => {
        if (error.name === 'AbortError') video.addEventListener('canplay', () => void video.play().catch(() => {}), { once: true });
    });
}

/** STREAM's MP4 back in VIDEO, at the moment it was at, playing if it was (or was about to). */
function fallBack(video: HTMLVideoElement, stream: Stream) {
    if (streams.get(video) !== stream || stream.failed) return;
    stream.failed = true;
    const at = video.currentTime || stream.at || 0, playing = !video.paused || stream.at !== undefined;
    stream.hls?.destroy();
    stream.hls = undefined;
    video.src = stream.mp4;
    if (at > 0) video.currentTime = at;
    if (playing) play(video);
}
