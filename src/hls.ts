// hls.js, its light build (HLS in fragmented MP4 or MPEG-TS; no subtitles, alternate audio or
// DRM, none of which the site's videos have), as a module of its own: scripts/build.ts bundles
// it into js/hls.<hash>.js, which src/video.ts imports when a video is first played in a
// browser without HLS of its own.
export { default } from 'hls.js/light';
