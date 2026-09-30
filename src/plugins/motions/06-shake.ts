// Motion 「ブルブル」 (keys in registration order: Z row for characters, A row for lyrics / telops): moves the element around its pivot. offsets() is a pure function of time (dx / dy / rot / sx / sy / alpha).
import type { PluginApi } from '../../plugin-loader';
import type { MotionCtx } from '../../engine/api';

export default (api: PluginApi) => {
  const { hash } = api.lib;
  /** Slight breathing (vertical scale). */
  const breath = (c: MotionCtx) => 1 + 0.004 * Math.sin(c.t * 2.1 + c.seed);

  api.registerMotion({
    id: 'shake',
    name: 'ブルブル',
    offsets(c) {
      const f = Math.floor(c.t * 30);
      const k = (0.35 + c.beat.pulse) * c.u;
      return { dx: (hash(f, c.seed, 1) - 0.5) * 18 * k, dy: (hash(f, c.seed, 2) - 0.5) * 18 * k, rot: (hash(f, c.seed, 3) - 0.5) * 0.02, sy: breath(c) };
    },
  });
};
