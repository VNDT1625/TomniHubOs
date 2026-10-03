import path from 'node:path';
import type { ModelPackBaseBinding } from '../../catalog/modelPackTypes';
import type { LocalInferenceProvider } from './localInferenceBroker';
import { QwenInferenceDaemonProvider } from './qwenInferenceDaemonProvider';
import type { QwenInferenceDaemonConfig } from './qwenInferenceDaemonProvider';

export type LocalInferenceRuntimeConfig = Readonly<{
  command: string;
  args?: readonly string[];
  cwd: string;
  baseRoot: string;
  adapterRoot: string;
  baseBinding: ModelPackBaseBinding;
}>;

export const readLocalInferenceRuntimeConfig = (
  env: NodeJS.ProcessEnv = process.env
): LocalInferenceRuntimeConfig | undefined => {
  const command = env.TOMNY_QWEN_DAEMON_COMMAND;
  const cwd = env.TOMNY_QWEN_DAEMON_CWD;
  const baseRoot = env.TOMNY_QWEN_BASE_ROOT;
  const adapterRoot = env.TOMNY_QWEN_ADAPTER_ROOT;
  const sha256 = env.TOMNY_QWEN_BASE_SHA256;
  if (!command || !cwd || !baseRoot || !adapterRoot || !sha256 || !/^[a-f0-9]{64}$/i.test(sha256)) return undefined;
  return {
    command,
    cwd,
    baseRoot,
    adapterRoot,
    baseBinding: { id: 'Qwen/Qwen3.5-0.8B', revision: env.TOMNY_QWEN_BASE_REVISION ?? 'immutable', sha256 },
  };
};

/** Resolves explicit runtime configuration; incomplete values remain fail-closed. */
export const resolveLocalInferenceProvider = (
  config: LocalInferenceRuntimeConfig | undefined
): LocalInferenceProvider | undefined => {
  if (
    !config ||
    !config.command.trim() ||
    !path.isAbsolute(config.cwd) ||
    !path.isAbsolute(config.baseRoot) ||
    !path.isAbsolute(config.adapterRoot)
  )
    return undefined;
  const daemon: QwenInferenceDaemonConfig = {
    command: config.command,
    args: config.args ?? [],
    cwd: config.cwd,
    baseRoot: config.baseRoot,
    adapterRoot: config.adapterRoot,
    baseBinding: config.baseBinding,
  };
  return new QwenInferenceDaemonProvider(daemon);
};
