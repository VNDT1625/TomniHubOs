const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PROTOCOL_VERSION = 'tomny.runtime.v1';

const targetTriple = (platform, arch) => {
  const targets = {
    'darwin-x64': 'x86_64-apple-darwin',
    'darwin-arm64': 'aarch64-apple-darwin',
    'linux-x64': 'x86_64-unknown-linux-gnu',
    'linux-arm64': 'aarch64-unknown-linux-gnu',
    'win32-x64': 'x86_64-pc-windows-msvc',
    'win32-arm64': 'aarch64-pc-windows-msvc',
  };
  return targets[`${platform}-${arch}`] || null;
};

const binaryName = (platform) => (platform === 'win32' ? 'tomny-runtime.exe' : 'tomny-runtime');

const hashRuntimeSources = (runtimeDir) => {
  const hash = createHash('sha256');
  const visit = (directory) => {
    for (const entry of fs
      .readdirSync(directory, { withFileTypes: true })
      .toSorted((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name === 'target') continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.name.endsWith('.rs') || entry.name === 'Cargo.toml' || entry.name === 'Cargo.lock') {
        hash.update(path.relative(runtimeDir, absolute).replaceAll('\\', '/'));
        hash.update('\0');
        hash.update(fs.readFileSync(absolute));
        hash.update('\0');
      }
    }
  };
  visit(runtimeDir);
  return hash.digest('hex');
};

const sha256File = (filePath) => createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

const readManifest = (manifestPath) => {
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    return null;
  }
};

const isReusableArtifact = ({ manifestPath, binaryPath, sourceHash, triple }) => {
  if (!fs.existsSync(binaryPath)) return false;
  const manifest = readManifest(manifestPath);
  return Boolean(
    manifest &&
    manifest.name === 'Tomny Runtime' &&
    manifest.protocol === PROTOCOL_VERSION &&
    manifest.sourceType === 'workspace-rust-build' &&
    manifest.sourceHash === sourceHash &&
    manifest.targetTriple === triple &&
    manifest.binarySha256 === sha256File(binaryPath)
  );
};

function prepareTomnyRuntime({ projectRoot, platform, arch }) {
  const triple = targetTriple(platform, arch);
  if (!triple) throw new Error(`Unsupported Tomny Runtime target: ${platform}-${arch}`);

  const runtimeDir = path.join(projectRoot, 'packages', 'tomny-runtime');
  const cargoManifest = path.join(runtimeDir, 'Cargo.toml');
  if (!fs.existsSync(cargoManifest)) {
    throw new Error(`Tomny Runtime Cargo manifest was not found: ${cargoManifest}`);
  }

  const sourceHash = hashRuntimeSources(runtimeDir);
  const runtimeKey = `${platform}-${arch}`;
  const targetDir = path.join(projectRoot, 'resources', 'bundled-tomny-runtime', runtimeKey);
  const targetBinary = path.join(targetDir, binaryName(platform));
  const artifactManifest = path.join(targetDir, 'manifest.json');
  if (isReusableArtifact({ manifestPath: artifactManifest, binaryPath: targetBinary, sourceHash, triple })) {
    return { prepared: true, cached: true, dir: targetDir, protocol: PROTOCOL_VERSION };
  }

  execFileSync('rustup', ['target', 'add', '--toolchain', 'stable', triple], { cwd: runtimeDir, stdio: 'inherit' });
  const cargoArgs = [
    'run',
    'stable',
    'cargo',
    'build',
    '--release',
    '--target',
    triple,
    '--manifest-path',
    cargoManifest,
  ];
  if (fs.existsSync(path.join(runtimeDir, 'Cargo.lock'))) cargoArgs.push('--locked');
  execFileSync('rustup', cargoArgs, { cwd: runtimeDir, stdio: 'inherit', env: process.env });

  const sourceBinary = path.join(runtimeDir, 'target', triple, 'release', binaryName(platform));
  if (!fs.existsSync(sourceBinary)) {
    throw new Error(`Tomny Runtime build output was not found: ${sourceBinary}`);
  }

  fs.mkdirSync(targetDir, { recursive: true });
  fs.copyFileSync(sourceBinary, targetBinary);
  if (platform !== 'win32') fs.chmodSync(targetBinary, 0o755);
  fs.writeFileSync(
    artifactManifest,
    `${JSON.stringify(
      {
        name: 'Tomny Runtime',
        protocol: PROTOCOL_VERSION,
        sourceType: 'workspace-rust-build',
        sourceHash,
        binarySha256: sha256File(targetBinary),
        targetTriple: triple,
        builtAt: new Date().toISOString(),
      },
      null,
      2
    )}\n`
  );

  return { prepared: true, cached: false, dir: targetDir, protocol: PROTOCOL_VERSION };
}

module.exports = {
  PROTOCOL_VERSION,
  binaryName,
  hashRuntimeSources,
  isReusableArtifact,
  prepareTomnyRuntime,
  targetTriple,
};
