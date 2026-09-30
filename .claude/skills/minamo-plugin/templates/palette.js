// Palette template (runtime plugin). Copy to plugins/<name>.js, change the ids / names / colors.
// Colors are #rrggbb. bg = background base, text = lyric color, accent / accent2 = highlights and decorations.
// Keep text readable on bg (light on dark or dark on light). Styles read them as g.pal.
// Plugin palettes appear in the left panel (ルック → パレット), the LOOK track (keys n m) and the inspector.

export default function (api) {
  api.registerPalette({ id: 'my-matcha', name: 'Matcha', bg: '#0f1a12', text: '#f4fff2', accent: '#9be15d', accent2: '#ffd166' });
  api.registerPalette({ id: 'my-pool', name: 'Night Pool', bg: '#061621', text: '#eafcff', accent: '#00e0c6', accent2: '#ff5fa2' });
}
