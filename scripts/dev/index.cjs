#!/usr/bin/env node

const { getStatus, resolveConfig, startServices, stopServices } = require('./serviceManager.cjs');

function printStatus(status) {
  for (const [name, service] of Object.entries(status.services)) {
    const ownership = service.owned ? 'managed' : 'external';
    console.log(`${name.padEnd(6)} ${service.healthy ? 'ready' : 'stopped'} (${ownership}) ${service.healthUrl}`);
  }
  console.log(`WebUI   ${status.webuiUrl}`);
  console.log(`HMR UI  ${status.rendererUrl}`);
}

async function main() {
  const mode = process.argv[2] || 'start';
  const targets = process.argv.slice(3);
  const config = resolveConfig();
  if (mode === 'start') {
    await startServices(config, targets);
    printStatus(await getStatus(config));
    console.log('Services stay alive after this command exits. Run `bun run dev:browser` for the HMR surface.');
    return;
  }
  if (mode === 'status') {
    printStatus(await getStatus(config));
    return;
  }
  if (mode === 'stop') {
    const stopped = await stopServices(config, targets);
    console.log(stopped.length > 0 ? `Stopped: ${stopped.join(', ')}` : 'No managed dev services were running.');
    return;
  }
  if (mode === 'restart') {
    await stopServices(config, targets);
    await startServices(config, targets);
    printStatus(await getStatus(config));
    return;
  }
  throw new Error(`Unknown mode: ${mode}. Use start, status, stop, or restart.`);
}

main().catch((error) => {
  console.error(`[dev-services] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
