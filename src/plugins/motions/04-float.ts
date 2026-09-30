// Motion 「ふわふわ」 (keys in registration order: Z row for characters, A row for lyrics / telops): moves the element around its pivot. offsets() is a pure function of time (dx / dy / rot / sx / sy / alpha).
import type { PluginApi } from '../../plugin-loader';
import type { MotionCtx } from '../../engine/api';

export default (api: PluginApi) => {
  /** Slight breathing (vertical scale). */
  const breath = (c: MotionCtx) => 1 + 0.004 * Math.sin(c.t * 2.1 + c.seed);

  api.registerMotion({
    id: 'float',
    name: 'ふわふわ',
    offsets: (c) => ({ dy: Math.sin(c.t * 1.7 + c.seed) * 16 * c.u, rot: Math.sin(c.t * 0.9 + c.seed) * 0.02, sy: breath(c) }),
  });
};
