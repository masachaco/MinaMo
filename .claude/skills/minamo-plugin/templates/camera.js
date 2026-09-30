// Camera template (runtime plugin): framings and camera moves for the CAMERA track.
// Copy to plugins/<name>.js, change the ids / names, then edit.
//
// A camera "pose" places the character image on screen:
//   { x, sy, fy, zoom, rot } = the image point at height fy (0 = top of the image, 1 = bottom, the face is c.faceY)
//   goes to screen height sy (fraction of H) at horizontal position x (fraction of W); zoom 1 ≈ full body fits the
//   screen height, 2.7 ≈ face close-up; rot in radians.
// Built-in framings for reference: 全身 { sy: 1.02, fy: 1, zoom: 1 }, バスト { sy: 0.3, fy: faceY, zoom: 1.75 },
// アップ { sy: 0.4, fy: faceY, zoom: 2.7 }, ワイド { sy: 0.97, fy: 1, zoom: 0.78 }.
// Framing = where the shot is (x comes from the character position). Move = what the camera does on top of it.
// Pure functions of their arguments: no Math.random(), no state kept between calls.

export default function (api) {
  const { lib } = api;

  // a still framing: face a bit higher than a bust shot, slightly tilted (direction from the seed)
  api.registerFraming({
    id: 'my-high',
    name: 'ハイアングル',
    key: 'z', // preferred key in the CAMERA track (free: z x c v b); a free one is used if taken
    lookTilt: false, // it tilts by itself: the look's random tilt is not added
    pose(c) {
      return { sy: 0.36, fy: c.faceY, zoom: 1.5, rot: (c.seed % 2 ? 1 : -1) * 0.035 };
    },
  });

  // a framing that moves: c.p goes 0 → 1 from its event to the next framing event (at most 8 bars)
  api.registerFraming({
    id: 'my-reveal',
    name: 'リビール',
    key: 'x',
    pose(c) {
      const k = lib.ease.inOutCubic(c.p);
      return { sy: lib.lerp(0.4, 1.02, k), fy: lib.lerp(c.faceY, 1, k), zoom: lib.lerp(2.6, 1, k), rot: 0 };
    },
  });

  // a move that mutates the pose: slow sway (scaled by the look's drift, 1 = normal)
  api.registerCameraMove({
    id: 'my-sway',
    name: 'ゆらぎ',
    key: 'p', // free: p [ ] n m l
    apply(pose, c) {
      pose.x += Math.sin(c.t * 0.8 + c.seed) * 0.015 * c.drift;
      pose.rot += Math.sin(c.t * 0.5 + c.seed * 0.1) * 0.02 * c.drift;
    },
  });

  // a move that returns a new pose: zoom kick on every beat, a small lift on each bar
  api.registerCameraMove({
    id: 'my-kick',
    name: 'キック',
    key: '[',
    apply(pose, c) {
      return { ...pose, zoom: pose.zoom * (1 + 0.05 * c.beat.pulse), sy: pose.sy - 0.01 * c.beat.downPulse };
    },
  });
}
