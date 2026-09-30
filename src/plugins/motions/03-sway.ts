// Motion 「ゆらゆら」 (keys in registration order: Z row for characters, A row for lyrics / telops): moves the element around its pivot. offsets() is a pure function of time (dx / dy / rot / sx / sy / alpha).
import type { PluginApi } from '../../plugin-loader';
import type { MotionCtx } from '../../engine/api';

export default (api: PluginApi) => {
  /** Slight breathing (vertical scale). */
  const breath = (c: MotionCtx) => 1 + 0.004 * Math.sin(c.t * 2.1 + c.seed);

  api.registerMotion({
    id: 'sway',
    name: 'ゆらゆら',
    offsets(c) {
      const s = Math.sin((c.beat.beat * Math.PI) / 2);
      return { rot: s * 0.045, dx: s * 14 * c.u, sy: breath(c) };
    },
  });
};
