// Motion template (runtime plugin): motions for the lyrics, the telops and the characters (the motion keys of the
// 歌詞 / テロップ / 立ち絵 tracks: A row for lyrics / telops, Z row for characters). Copy to plugins/<name>.js.
//
// offsets(c) returns how the element is moved at this moment, around its pivot (lyrics: the text area center,
// telop: its template's pivot, character: its framing anchor). All fields optional:
//   { dx, dy }  px (multiply by c.u)   rot  radians   { sx, sy }  scale   alpha  opacity 0..1
// c = { target: 'lyrics' | 'telop' | 'chara', t, age (seconds since the motion started), beat, audio, u,
//       amount (1.5 when recorded; the look's bounce for characters on オート), seed }
// One motion at a time per element. Pure function of c: no Math.random(), no state kept between calls.

export default function (api) {
  const { lib } = api;

  // grows on every beat, a bigger kick on the downbeat
  api.registerMotion({
    id: 'my-pulse',
    name: 'パルス',
    key: 'j', // preferred key in the element tracks (free: j k l); a free one is used if taken
    offsets(c) {
      const k = 1 + 0.05 * c.beat.pulse + 0.05 * c.beat.downPulse;
      return { sx: k, sy: k };
    },
  });

  // opacity follows the beat
  api.registerMotion({
    id: 'my-blink',
    name: '点滅',
    key: 'k',
    offsets: (c) => ({ alpha: 0.35 + 0.65 * c.beat.pulse }),
  });

  // text only (targets): slides in from the left when the motion starts, then drifts slowly
  api.registerMotion({
    id: 'my-slide',
    name: 'スライドイン',
    key: 'l',
    targets: ['lyrics', 'telop'],
    offsets(c) {
      const k = lib.ease.outCubic(lib.clamp(c.age / 0.5));
      return { dx: -(1 - k) * 260 * c.u + Math.sin(c.t * 0.6 + c.seed) * 6 * c.u, alpha: k };
    },
  });
}
