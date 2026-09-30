// MMD file helpers without three.js (the renderer in ./mmd is loaded on demand).

export const MODEL_EXT = /\.(pmx|pmd)$/i;
/** Files kept from a model folder (the model itself + anything a material can reference). */
export const MODEL_FILE_EXT = /\.(pmx|pmd|bmp|png|jpe?g|tga|dds|sph|spa|gif|webp)$/i;
export const CLIP_EXT = /\.(vpd|vmd)$/i;

/** Normalized relative path used as the lookup key for model folder files. */
export function normPath(p: string): string {
  const out: string[] = [];
  for (const part of p.replace(/\\/g, '/').normalize('NFC').toLowerCase().split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}
