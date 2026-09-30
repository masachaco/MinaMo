// Project data model. Everything here is plain JSON (media blobs live in IndexedDB).

export interface Palette {
  id: string;
  name: string;
  bg: string;
  text: string;
  accent: string;
  accent2: string;
}

export interface ProjectSettings {
  title: string;
  artist: string;
  bpm: number;
  beatsPerBar: number;
  /** Time (sec) of the first downbeat. */
  offset: number;
  width: number;
  height: number;
  fps: number;
  /** Preview render scale relative to output resolution. */
  previewScale: number;
  /** 0 = off, otherwise snap grid divisions per beat. */
  quantize: number;
  /** Snap grid (divisions per beat) for style / FX / camera events. 0 = off. */
  eventSnap: number;
  /** Tap latency compensation in ms (subtracted from tap time). */
  latencyMs: number;
  /** Auto-clear a line after this many bars when no next line comes. */
  lineCapBars: number;
  /** Multiplier on each style's camera shot length. */
  shotScale: number;
  paletteId: string;
  customPalette: Palette;
  bgDim: number;
  /** Readability correction: text pixels too close to the background luminance are pushed away from it. */
  textAdapt: 'off' | 'low' | 'mid' | 'high';
  hud: boolean;
  metronome: boolean;
  /** On stop: 'return' to where playback started (default) or 'stay' where it stopped. */
  stopMode: 'return' | 'stay';
  fxIntensity: number;
  seed: number;
  /** Lyric style before the first lyric style event. */
  lyricStyle: string;
  /** Look style before the first look style event. */
  lookStyle: string;
}

export interface LyricLine {
  id: string;
  /** Raw source line (used to reconcile timings when lyrics are edited). */
  raw: string;
  text: string;
  sub: string;
  chunks: string[];
  /** Appear time per character (grapheme, across all chunks); null = auto. times[0] is the line start. */
  times: (number | null)[];
  /** Explicit clear time (Enter key), or null. */
  end: number | null;
}

/**
 * Telop (caption / title / credit block). Parsed from Project.telopText, one per line:
 *   [template] main text | sub text
 */
export interface Telop {
  id: string;
  /** Source line (used to keep timings when the list is edited). */
  raw: string;
  /** Template id (title / lower / corner / caption / chapter / credit ...). */
  template: string;
  text: string;
  sub: string;
  start: number | null;
  /** Explicit length in seconds, or null = the template's default length. */
  dur: number | null;
}

export interface TimedEvent {
  id: string;
  time: number;
}

/** Recording tracks (MTR style: each is recorded separately and layered). */
export type TrackId = 'lyrics' | 'telop' | 'chara' | 'camera' | 'fx' | 'viz' | 'look';

/** Lyric motion style change (lyrics track). */
export interface StyleEvent extends TimedEvent {
  style: string;
}

export interface FxEvent extends TimedEvent {
  fx: string;
  /** Held duration in seconds (0 = one-shot). */
  hold: number;
}

/**
 * Character (立ち絵) state change.
 *  char:   character id | 'none' (hidden) | 'auto'
 *  pos:    'left' | 'center' | 'right' | 'duo' | 'auto'
 *  effect: comma-separated effect ids in the order they were turned on ('' = none) | 'auto'
 *  motion: motion id | 'auto'
 * Effect / motion ids are the registered ones (built-in or plugin); unknown ids are kept and ignored when drawing.
 */
export interface CharaEvent extends TimedEvent {
  kind: 'char' | 'pos' | 'effect' | 'motion';
  value: string;
}

/**
 * Effect / motion change of the lyrics or the telops (same values as a character's):
 *  effect: comma-separated effect ids ('' = none)
 *  motion: motion id ('idle' = none)
 */
export interface ElemEvent extends TimedEvent {
  kind: 'effect' | 'motion';
  value: string;
}

/**
 * Camera state change.
 *  frame: framing id | 'auto'  (smooth = move instead of cut)
 *  move:  camera movement id | 'auto'
 */
export interface CamEvent extends TimedEvent {
  kind: 'frame' | 'move';
  value: string;
  smooth?: boolean;
}

/**
 * Audio visualizer state change.
 *  type:  visualizer id | 'none'
 *  pos:   'bottom' | 'center' | 'top' | 'around' (around the character) | 'full'
 *  color: 'accent' | 'accent2' | 'text' | 'grad' | 'rainbow'
 *  size:  's' | 'm' | 'l'
 *  layer: 'back' (behind the character) | 'front'
 */
export interface VizEvent extends TimedEvent {
  kind: 'type' | 'pos' | 'color' | 'size' | 'layer';
  value: string;
}

/**
 * Look (scene) state change.
 *  style:   look style id (background decor, post effects, camera policy, transition)
 *  bg:      background index ('0'..) | 'none' | 'auto'
 *  palette: palette id | 'auto'
 *  dim:     background darkness '0'..'1' | 'auto'
 */
export interface LookEvent extends TimedEvent {
  kind: 'style' | 'bg' | 'palette' | 'dim';
  value: string;
  /** Style changes only: transition FX id, 'none', or undefined = the style's own transition. */
  transition?: string;
}

/** MMD model folder (files live in IndexedDB as `${id}/${path}`). */
export interface MmdModelRef {
  id: string;
  name: string;
  /** Model file path inside `files`. */
  model: string;
  /** Normalized relative paths of the kept folder files. */
  files: string[];
  /** Hair / skirt physics (spring bones). Default on. */
  physics?: boolean;
}

/** VPD pose / VMD motion of an MMD character entry (the file lives in IndexedDB under `id`). */
export interface MmdPoseRef {
  id: string;
  name: string;
  kind: 'vpd' | 'vmd';
}

export interface MediaRef {
  id: string;
  name: string;
  mime: string;
}

export interface BackgroundRef extends MediaRef {
  kind: 'image' | 'video';
}

export interface CharacterRef extends MediaRef {
  /**
   * Image entries: IndexedDB key of the image (default: id). Replacing the image stores it under a new key, so
   * undo / redo go back and forth between images while the id (and every recorded switch) stays.
   */
  media?: string;
  /** Face position as a fraction of image height (0 = top). */
  faceY: number;
  scale: number;
  /** Screen offset, fraction of the output width (+ = right). */
  offsetX: number;
  /** Screen offset, fraction of the output height (+ = down). */
  offsetY: number;
  flip: boolean;
  enabled: boolean;
  /** 'mmd' = 3D model rendered each frame (default: a still image). */
  kind?: 'image' | 'mmd';
  /** MMD only: the model (Project.mmdModels id). Several entries can share a model with different poses. */
  mmdModel?: string;
  /** MMD only: pose / motion shown by this entry (none = the model's rest pose). A motion plays from when the entry is switched in. */
  mmdPose?: MmdPoseRef;
  /** MMD motion tempo: 'beat' (default) stretches one loop to a whole number of beats, 'orig' keeps the file's speed. */
  mmdSync?: 'beat' | 'orig';
  /** MMD motion speed multiplier (default 1). */
  mmdSpeed?: number;
  /** MMD: open the mouth (morph 「あ」) with the song's vocal-range loudness. */
  mmdLip?: boolean;
  /** MMD: model rotation in degrees around its centre (x = lean forward/back, y = turn, z = tilt). */
  mmdRot?: { x: number; y: number; z: number };
  /**
   * MMD: camera motion (camera VMD, file in IndexedDB under `id`). While this entry is shown the model is rendered
   * full-screen through the VMD camera (same timing as the motion) and the camera track's framing is not applied.
   */
  mmdCamera?: { id: string; name: string };
}

export interface Project {
  version: 1;
  settings: ProjectSettings;
  lyricsText: string;
  lines: LyricLine[];
  /** Telop list source (one telop per line). */
  telopText: string;
  telops: Telop[];
  /** Lyric style changes (lyrics track). */
  lyricStyleEvents: StyleEvent[];
  /** Effects / motions of the lyrics (lyrics track). */
  lyricEvents: ElemEvent[];
  /** Effects / motions of the telops (telop track; the telops' own timings live on `telops`). */
  telopEvents: ElemEvent[];
  charaEvents: CharaEvent[];
  camEvents: CamEvent[];
  fxEvents: FxEvent[];
  vizEvents: VizEvent[];
  lookEvents: LookEvent[];
  audio: MediaRef | null;
  backgrounds: BackgroundRef[];
  characters: CharacterRef[];
  /** MMD model folders used by 'mmd' character entries. */
  mmdModels: MmdModelRef[];
}
