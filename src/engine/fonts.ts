// Web font preloading for canvas text (canvas does not trigger font loads by itself).

import { listStyles } from './api';
import { clearMeasureCache } from './lib';

const BASE_SPECS = ['400 "Dela Gothic One"', '500 "Montserrat"', '600 "Montserrat"', '800 "Montserrat"', '400 "Share Tech Mono"', '400 "Anton"', '700 "Noto Sans JP"'];
const SAMPLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,!?/-_:;()#%&*+=<>[]|' +
  'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモラリルレロワンｱｲｳｴｵ';

let lastKey = '';

/** Load all style fonts for the given text. Resolves when loaded or after timeout. */
export async function ensureFonts(text: string, timeoutMs = 6000): Promise<boolean> {
  if (typeof document === 'undefined' || !document.fonts) return false;
  const specs = new Set(BASE_SPECS);
  for (const s of listStyles()) s.fonts?.forEach((f) => specs.add(f));
  const chars = [...new Set(Array.from(text + SAMPLE))].join('');
  const key = [...specs].join('|') + '::' + chars;
  if (key === lastKey) return false;
  lastKey = key;
  const loads = [...specs].map((spec) => {
    const i = spec.indexOf('"');
    const css = i >= 0 ? `${spec.slice(0, i)}48px ${spec.slice(i)}` : `48px ${spec}`;
    return document.fonts.load(css, chars).catch(() => []);
  });
  await Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, timeoutMs))]);
  clearMeasureCache();
  return true;
}
