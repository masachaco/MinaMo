// Offline, frame-exact video export with WebCodecs (via mediabunny).
// Every frame is rendered deterministically at time t, so the result never drops frames.

import {
  AudioBufferSource, BufferTarget, CanvasSource, getFirstEncodableAudioCodec, getFirstEncodableVideoCodec,
  Mp4OutputFormat, Output, QUALITY_HIGH, QUALITY_MEDIUM, QUALITY_VERY_HIGH, WebMOutputFormat,
  type AudioCodec, type VideoCodec,
} from 'mediabunny';
import type { App } from '../app';
import { bgIndexAt, compileProject } from '../engine/compile';
import { ensureFonts } from '../engine/fonts';
import { Renderer } from '../engine/renderer';

export interface ExportOptions {
  width: number;
  height: number;
  fps: number;
  start: number;
  end: number;
  container: 'mp4' | 'webm';
  quality: 'medium' | 'high' | 'veryhigh';
}

export interface ExportJob {
  cancelled: boolean;
}

export const canExport = () => typeof window !== 'undefined' && 'VideoEncoder' in window;

function sliceBuffer(buf: AudioBuffer, start: number, end: number): AudioBuffer {
  const sr = buf.sampleRate;
  const a = Math.max(0, Math.floor(start * sr));
  const b = Math.min(buf.length, Math.ceil(end * sr));
  const out = new AudioBuffer({ length: Math.max(1, b - a), numberOfChannels: buf.numberOfChannels, sampleRate: sr });
  for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(a, b), c);
  return out;
}

function seekVideo(v: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((res) => {
    if (Math.abs(v.currentTime - t) < 1e-3) return res();
    const done = () => {
      v.removeEventListener('seeked', done);
      clearTimeout(timer);
      res();
    };
    const timer = setTimeout(done, 1500);
    v.addEventListener('seeked', done);
    v.currentTime = t;
  });
}

export async function exportVideo(
  app: App, o: ExportOptions, job: ExportJob, onProgress: (p: number, msg: string) => void,
): Promise<Blob> {
  if (!canExport()) throw new Error('このブラウザは WebCodecs に対応していません（Chrome / Edge を推奨）');
  const W = Math.round(o.width / 2) * 2;
  const H = Math.round(o.height / 2) * 2;
  const quality = o.quality === 'veryhigh' ? QUALITY_VERY_HIGH : o.quality === 'medium' ? QUALITY_MEDIUM : QUALITY_HIGH;

  onProgress(0, 'フォントを準備中…');
  const p = app.project;
  await ensureFonts(app.fontText(), 8000);

  const renderer = new Renderer(W, H);
  const compiled = compileProject(p, app.duration, W, H, app.enabledChars().map((a) => a.ref.id));
  const input = { ...app.frameInput(true), compiled };

  const format = o.container === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat();
  const prefer: VideoCodec[] = o.container === 'mp4' ? ['avc', 'hevc', 'av1', 'vp9'] : ['vp9', 'av1', 'vp8'];
  const supported = format.getSupportedVideoCodecs();
  const vcodec = await getFirstEncodableVideoCodec(prefer.filter((c) => supported.includes(c)), { width: W, height: H, frameRate: o.fps });
  if (!vcodec) throw new Error(`${W}x${H} をエンコードできる映像コーデックがありません`);

  const target = new BufferTarget();
  const output = new Output({ format, target });
  const video = new CanvasSource(renderer.output, { codec: vcodec, quality, keyFrameInterval: 2 });
  output.addVideoTrack(video, { frameRate: o.fps });

  let audio: AudioBufferSource | null = null;
  const buf = app.engine.buffer;
  if (buf) {
    const aprefer: AudioCodec[] = o.container === 'mp4' ? ['aac', 'opus'] : ['opus', 'vorbis'];
    const asup = format.getSupportedAudioCodecs();
    const acodec = await getFirstEncodableAudioCodec(aprefer.filter((c) => asup.includes(c)), {
      numberOfChannels: buf.numberOfChannels,
      sampleRate: buf.sampleRate,
    });
    if (acodec) {
      audio = new AudioBufferSource({ codec: acodec, quality: QUALITY_HIGH });
      output.addAudioTrack(audio);
    }
  }
  output.setMetadataTags({ title: p.settings.title, artist: p.settings.artist });
  await output.start();

  if (audio && buf) {
    onProgress(0, '音声をエンコード中…');
    await audio.add(sliceBuffer(buf, o.start, o.end));
    audio.close();
  }

  const frames = Math.max(1, Math.ceil((o.end - o.start) * o.fps));
  const bgs = input.bgs;
  const t0 = performance.now();
  for (let i = 0; i < frames; i++) {
    if (job.cancelled) {
      await output.cancel();
      throw new Error('キャンセルしました');
    }
    const t = o.start + i / o.fps;
    // sync video backgrounds exactly to this frame
    if (bgs.some((b) => b.video)) {
      const active = bgs[bgIndexAt(compiled, t, bgs.length)];
      if (active?.video && active.video.duration) await seekVideo(active.video, t % active.video.duration);
    }
    renderer.render(t, input);
    await video.add(i / o.fps, 1 / o.fps);
    if (i % 6 === 0 || i === frames - 1) {
      const el = (performance.now() - t0) / 1000;
      const eta = (el / (i + 1)) * (frames - i - 1);
      onProgress((i + 1) / frames, `フレーム ${i + 1} / ${frames}  (${vcodec.toUpperCase()})  残り約 ${Math.ceil(eta)} 秒`);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  video.close();
  onProgress(1, 'ファイルを書き出し中…');
  await output.finalize();
  if (!target.buffer) throw new Error('出力が空です');
  return new Blob([target.buffer], { type: format.mimeType });
}
