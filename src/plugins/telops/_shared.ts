// Fonts and helpers shared by the built-in telop templates. A runtime plugin cannot import this file: copy what it needs.

import type { TelopCtx } from '../../engine/api';
import { clamp } from '../../engine/lib';

export const F_TITLE = '"Dela Gothic One", "Anton", "Noto Sans JP", sans-serif';
export const F_SANS = '"Montserrat", "Noto Sans JP", sans-serif';
export const F_JP = '"Noto Sans JP", "Montserrat", sans-serif';
export const F_MONO = '"Share Tech Mono", "DotGothic16", monospace';
export const F_DISPLAY = '"Anton", "Dela Gothic One", "Noto Sans JP", sans-serif';

/** Entrance progress for a delay/duration (seconds since appear). */
export const inK = (tl: TelopCtx, delay: number, dur: number) => clamp((tl.age - delay) / dur);
