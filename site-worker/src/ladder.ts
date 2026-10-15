/* How a video streams: the sizes it is made in, and its HLS files (adaptive streaming), made
   from those sizes' MP4s. Shared by the assets page (admin-page.ts, in the browser, which
   encodes each size with WebCodecs) and scripts/video.ts (on a computer, with ffmpeg), so
   either way a video NAME.mp4 on the media domain is the same set of files:

     NAME.mp4             the largest size, a plain MP4 (its index first): what pages name, the
                          feed's enclosure, and what plays where HLS can't
     NAME.jpg             its poster (the admin's frame picker; not made here)
     NAME.m3u8            the HLS master playlist: every size, for the player to pick from as the
                          connection allows (src/video.ts), stepping down rather than stalling
     NAME.hls/<h>.m3u8    each size's playlist: 2-second segments, by byte range into
     NAME.hls/<h>.mp4     that size as one fragmented MP4 (CMAF), its video and sound together

   (<h>: the size's shorter side, 720, 480 or 360.) One file per size rather than one per
   segment: a handful of files to upload, and .mp4, which Cloudflare's edge caches (it caches
   neither .m3u8 nor .m4s by default; the playlists are small and come from R2 each time).
   Every size has a key frame every 2 seconds (WebCodecs' default in Mediabunny, ffmpeg's
   -force_key_frames in video.ts), so the sizes' segments line up and the player can change
   size at any segment. */

import {
  ALL_FORMATS, BufferTarget, CmafOutputFormat, EncodedAudioPacketSource, EncodedPacketSink, EncodedVideoPacketSource,
  HlsOutputFormat, Input, Output, OutputTrackGroup, PathedTarget, type Source,
} from 'mediabunny';

/** One size of a video: its frame, and the bitrate its video is encoded at. */
export interface Rung { short: number; width: number; height: number; bitrate: number }

/** The shorter sides of the sizes made, largest first: no video goes up larger than 720p. */
const SHORT_SIDES = [720, 480, 360];
/** The video bitrate of a 1280x720 frame at up to 30 fps, which smaller frames scale from. */
const BITRATE_720P = 1_250_000;
/** The sound, in every size: AAC at this bitrate, or copied as it is when it already is AAC
    at no more than AUDIO_COPY_MAX (a phone's is 128 kbps or so). */
export const AUDIO_BITRATE = 96_000;
export const AUDIO_COPY_MAX = 160_000;
/** The highest frame rate made: more is twice the bits for little a page shows. */
export const MAX_FPS = 30;
/** Seconds between key frames, in every size: the segments' length. */
export const KEY_FRAME_INTERVAL = 2;

const even = (n: number) => Math.max(2, 2 * Math.round(n / 2));

/** The sizes a WIDTH x HEIGHT video (as displayed) is made in, largest first: its own size or
    720p, whichever is smaller, then each smaller one at least 1.3 times smaller than the one
    before. Bitrates scale a little less than the pixel count does: a small frame needs more
    bits per pixel to look as good. */
export function ladder(width: number, height: number): Rung[] {
  const short = Math.min(width, height);
  const top = Math.min(short, SHORT_SIDES[0]);
  const sides = [top];
  for (const side of SHORT_SIDES.slice(1)) if (sides[sides.length - 1] / side >= 1.3) sides.push(side);
  return sides.map((side) => {
    const scale = side / short;
    const w = even(width * scale), h = even(height * scale);
    const bitrate = Math.round(BITRATE_720P * Math.pow((w * h) / (1280 * 720), 0.85) / 1000) * 1000;
    return { short: Math.min(w, h), width: w, height: h, bitrate };
  });
}

/** NAME's base (NAME.mp4 without .mp4) and its streaming files' addresses, relative to the
    media domain's root. */
export function streamNames(name: string) {
  const base = name.replace(/\.mp4$/, '');
  return { mp4: `${base}.mp4`, master: `${base}.m3u8`, folder: `${base}.hls/` };
}

/** The HLS files of the video NAME.mp4 (NAME.m3u8 and NAME.hls/...), from its sizes' MP4s,
    largest first (each as ladder() and the encoder made it: H.264, AAC, key frames every
    KEY_FRAME_INTERVAL seconds): each file's path (from the media domain's root) and bytes. */
export async function hlsFiles(name: string, sizes: { rung: Rung; source: Source }[]) {
  const { master, folder } = streamNames(name);
  // The playlists and segments, relative to the master playlist's folder.
  const dir = folder.slice(folder.lastIndexOf('/', folder.length - 2) + 1);
  const targets = new Map<string, BufferTarget>();
  const inputs = sizes.map(({ source }) => new Input({ source, formats: ALL_FORMATS }));
  const rungOf = new Map<unknown, Rung>();
  try {
    const output = new Output({
      format: new HlsOutputFormat({
        segmentFormat: new CmafOutputFormat(),
        // Each segment ends at the last key frame before this: the 2-second one, with half a
        // second to spare, as the sound starts a little before the picture (AAC's priming)
        // and an encoder may add key frames of its own at scene changes (a browser's does).
        targetDuration: KEY_FRAME_INTERVAL + 0.5,
        singleFilePerPlaylist: true,
        getPlaylistPath: ({ tracks }) => `${dir}${rungOf.get(tracks.find((t) => t.type === 'video'))!.short}.m3u8`,
        getSegmentPath: ({ playlist }) => `${rungOf.get(playlist.tracks.find((t) => t.type === 'video'))!.short}.mp4`,
      }),
      target: new PathedTarget(master, ({ path }) => {
        const target = new BufferTarget();
        targets.set(path, target);
        return target;
      }),
    });
    // Each size is a group of its own: its video and its sound, played together, and no other
    // size's. So each size's playlist carries both (muxed), which every HLS player plays.
    const copies: (() => Promise<void>)[] = [];
    for (const [i, { rung }] of sizes.entries()) {
      const group = new OutputTrackGroup();
      const video = await inputs[i].getPrimaryVideoTrack();
      if (!video) throw new Error(`the ${rung.short}p MP4 has no video`);
      const videoSource = new EncodedVideoPacketSource('avc');
      rungOf.set(output.addVideoTrack(videoSource, { group, bitrate: rung.bitrate }), rung);
      const videoConfig = await video.getDecoderConfig();
      copies.push(async () => {
        let first = true;
        for await (const packet of new EncodedPacketSink(video).packets()) {
          await videoSource.add(packet, first ? { decoderConfig: videoConfig! } : undefined);
          first = false;
        }
        videoSource.close();
      });
      const audio = await inputs[i].getPrimaryAudioTrack();
      if (audio) {
        const audioSource = new EncodedAudioPacketSource('aac');
        output.addAudioTrack(audioSource, { group });
        const audioConfig = await audio.getDecoderConfig();
        copies.push(async () => {
          let first = true;
          for await (const packet of new EncodedPacketSink(audio).packets()) {
            await audioSource.add(packet, first ? { decoderConfig: audioConfig! } : undefined);
            first = false;
          }
          audioSource.close();
        });
      }
    }
    await output.start();
    // All at once, so the tracks advance together and each segment closes as soon as it can.
    await Promise.all(copies.map((copy) => copy()));
    await output.finalize();
  } finally {
    for (const input of inputs) input.dispose();
  }
  const base = master.slice(0, master.lastIndexOf('/') + 1);
  return new Map([...targets].map(([path, target]) => [
    path.startsWith(base) || path === master ? path : base + path,
    new Uint8Array(target.buffer!),
  ]));
}
