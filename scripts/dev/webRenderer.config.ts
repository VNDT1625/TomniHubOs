import electronConfig from '../../packages/desktop/electron.vite.config';
import { defineConfig, type ConfigEnv, type UserConfig } from 'vite';

type ElectronConfig = { renderer?: UserConfig };
type ElectronConfigFactory = (env: ConfigEnv) => ElectronConfig | Promise<ElectronConfig>;

/** Reuse the renderer half of electron-vite config without launching Electron. */
export default defineConfig(async (env) => {
  const source = electronConfig as unknown as ElectronConfig | ElectronConfigFactory;
  const resolved = typeof source === 'function' ? await source(env) : source;
  if (!resolved.renderer) {
    throw new Error('Electron Vite config did not expose a renderer configuration.');
  }
  return resolved.renderer;
});
