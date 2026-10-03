import type {
  PackageProcessRuntimeBinding,
  PackageProcessRuntimeEndpoint,
  PackageProcessRuntimeInvocation,
} from './packageProcessRuntimeSupervisor';

export const PACKAGE_PROCESS_RUNTIME_DRIVER_PROTOCOL = 'package-process-runtime-driver.v1' as const;

export type PackageProcessRuntimeDriverRequest = Readonly<{
  protocolVersion: typeof PACKAGE_PROCESS_RUNTIME_DRIVER_PROTOCOL;
  binding: PackageProcessRuntimeBinding;
  invocation: PackageProcessRuntimeInvocation;
}>;

/**
 * Package-owned adapters implement this narrow Main-only contract. There is intentionally no
 * executable path, argv, environment, or generic IPC payload in the ABI: host wiring selects
 * a verified/contained driver before the supervisor can create an endpoint.
 */
export type PackageProcessRuntimeDriver = Readonly<{
  protocolVersion: typeof PACKAGE_PROCESS_RUNTIME_DRIVER_PROTOCOL;
  open: (
    binding: PackageProcessRuntimeBinding,
    signal: AbortSignal
  ) => Promise<PackageProcessRuntimeDriverSession | undefined>;
}>;

export type PackageProcessRuntimeDriverSession = Readonly<{
  execute: (request: PackageProcessRuntimeDriverRequest) => Promise<unknown>;
  close: () => Promise<void>;
}>;

/**
 * Converts a version-pinned package driver into the supervisor endpoint shape. This is the only
 * intended hand-off from a package-specific native adapter to neutral Core runtime policy.
 */
export const createPackageProcessRuntimeDriverEndpoint = async (
  input: Readonly<{
    driver: PackageProcessRuntimeDriver;
    binding: PackageProcessRuntimeBinding;
    signal: AbortSignal;
  }>
): Promise<PackageProcessRuntimeEndpoint | undefined> => {
  if (input.driver.protocolVersion !== PACKAGE_PROCESS_RUNTIME_DRIVER_PROTOCOL) {
    throw new Error('PACKAGE_PROCESS_RUNTIME_DRIVER_PROTOCOL_UNSUPPORTED');
  }
  const session = await input.driver.open(input.binding, input.signal);
  if (session === undefined || input.signal.aborted) {
    if (session !== undefined) {
      await session.close().catch((): undefined => undefined);
    }
    return undefined;
  }
  return {
    invoke: async (invocation) =>
      session.execute({
        protocolVersion: PACKAGE_PROCESS_RUNTIME_DRIVER_PROTOCOL,
        binding: input.binding,
        invocation,
      }),
    terminate: async () => session.close(),
  };
};
