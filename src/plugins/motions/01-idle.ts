// Motion 「静止」 (keys in registration order: Z row for characters, A row for lyrics / telops): moves the element around its pivot. offsets() is a pure function of time (dx / dy / rot / sx / sy / alpha).
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  api.registerMotion({ id: 'idle', name: '静止', offsets: () => undefined });
};
