// hls.js's light build ships no types of its own: it is the full build's API, less the
// features it leaves out.
declare module 'hls.js/light' {
  export { default } from 'hls.js';
}
