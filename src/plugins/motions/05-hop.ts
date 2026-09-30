// Motion 「ジャンプ」 (keys in registration order: Z row for characters, A row for lyrics / telops): moves the element around its pivot. offsets() is a pure function of time (dx / dy / rot / sx / sy / alpha).
import type { PluginApi } from '../../plugin-loader';
import type { MotionCtx } from '../../engine/api';

export default (api: PluginApi) => {
  /** Slight breathing (vertical scale). */
  const breath = (c: MotionCtx) => 1 + 0.004 * Math.sin(c.t * 2.1 + c.seed);

  api.registerMotion({
    id: 'hop',
    name: 'ジャンプ',
    offsets(c) {
      const land = c.beat.pulse;
      return { dy: -Math.sin(Math.PI * Math.min(1, c.beat.phase * 1.4)) * 42 * c.u, sx: 1 + 0.06 * land, sy: breath(c) * (1 - 0.06 * land) };
    },
  });
};
