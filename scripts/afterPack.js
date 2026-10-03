const { Arch } = require('builder-util');

const { createHash } = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  normalizeArch,
  rebuildSingleModule,
  verifyModuleBinary,
  getModulesToRebuild,
} = require('./rebuildNativeModules');

/**
 * afterPack hook for electron-builder
 * Rebuilds native modules for cross-architecture builds
 */

function resolveResourcesDir(electronPlatformName, appOutDir, packager) {
  if (electronPlatformName !== 'darwin') return path.join(appOutDir, 'resources');

  const appName = packager?.appInfo?.productFilename || 'Tomny';
  return path.join(appOutDir, `${appName}.app`, 'Contents', 'Resources');
}

function getBackendBinaryName(electronPlatformName) {
  return electronPlatformName === 'win32' ? 'tomny-core.exe' : 'tomny-core';
}

function getCliBinaryName(electronPlatformName) {
  return electronPlatformName === 'win32' ? 'tomny.exe' : 'tomny';
}

function getRuntimeBinaryName(electronPlatformName) {
  return electronPlatformName === 'win32' ? 'tomny-runtime.exe' : 'tomny-runtime';
}

function requirePackagedResource(resourcesDir, relativePath, missing) {
  const absolutePath = path.join(resourcesDir, relativePath);
  if (!fs.existsSync(absolutePath)) {
    missing.push(relativePath);
  }
}

function verifySharpRuntime(resourcesDir, electronPlatformName, targetArch) {
  if (electronPlatformName !== 'win32' || targetArch !== 'x64') return;

  const sharpRoot = path.join(resourcesDir, 'app.asar.unpacked', 'node_modules', '@img', 'sharp-win32-x64', 'lib');

  const colourManifest = path.join(resourcesDir, 'app.asar.unpacked', 'node_modules', '@img', 'colour', 'package.json');
  const required = ['sharp-win32-x64.node', 'libvips-42.dll', 'libvips-cpp-8.17.3.dll'];
  const missing = required.filter((file) => !fs.existsSync(path.join(sharpRoot, file)));

  if (!fs.existsSync(colourManifest)) missing.push('@img/colour/package.json');
  if (missing.length > 0) {
    throw new Error(`Packaged sharp runtime is missing: ${missing.join(', ')}`);
  }
}

function verifyBundledResources(resourcesDir, electronPlatformName, targetArch) {
  const runtimeKey = `${electronPlatformName}-${targetArch}`;
  const missing = [];

  requirePackagedResource(
    resourcesDir,
    path.join('bundled-tomny-core', runtimeKey, getBackendBinaryName(electronPlatformName)),
    missing
  );
  requirePackagedResource(resourcesDir, path.join('bundled-tomny-core', runtimeKey, 'manifest.json'), missing);

  requirePackagedResource(
    resourcesDir,
    path.join('bundled-tomny-cli', runtimeKey, getCliBinaryName(electronPlatformName)),
    missing
  );
  requirePackagedResource(resourcesDir, path.join('bundled-tomny-cli', runtimeKey, 'manifest.json'), missing);

  requirePackagedResource(
    resourcesDir,
    path.join('bundled-tomny-runtime', runtimeKey, getRuntimeBinaryName(electronPlatformName)),
    missing
  );
  requirePackagedResource(resourcesDir, path.join('bundled-tomny-runtime', runtimeKey, 'manifest.json'), missing);

  if (missing.length > 0) {
    throw new Error(`Packaged app is missing required resource(s): ${missing.join(', ')}`);
  }

  const cliManifestPath = path.join(resourcesDir, 'bundled-tomny-cli', runtimeKey, 'manifest.json');
  const cliBinaryPath = path.join(
    resourcesDir,
    'bundled-tomny-cli',
    runtimeKey,
    getCliBinaryName(electronPlatformName)
  );
  const cliManifest = JSON.parse(fs.readFileSync(cliManifestPath, 'utf8'));
  const cliHash = createHash('sha256').update(fs.readFileSync(cliBinaryPath)).digest('hex');
  if (cliManifest.binarySha256 !== cliHash) {
    throw new Error(`Packaged Tomny CLI integrity check failed for ${runtimeKey}`);
  }

  const runtimeManifestPath = path.join(resourcesDir, 'bundled-tomny-runtime', runtimeKey, 'manifest.json');
  const runtimeBinaryPath = path.join(
    resourcesDir,
    'bundled-tomny-runtime',
    runtimeKey,
    getRuntimeBinaryName(electronPlatformName)
  );
  const runtimeManifest = JSON.parse(fs.readFileSync(runtimeManifestPath, 'utf8'));
  const runtimeHash = createHash('sha256').update(fs.readFileSync(runtimeBinaryPath)).digest('hex');
  if (
    runtimeManifest.protocol !== 'tomny.runtime.v1' ||
    runtimeManifest.sourceType !== 'workspace-rust-build' ||
    runtimeManifest.binarySha256 !== runtimeHash
  ) {
    throw new Error(`Packaged Tomny Runtime integrity check failed for ${runtimeKey}`);
  }

  console.log(`   ✓ Bundled resources verified for ${runtimeKey}`);
}

module.exports = async function afterPack(context) {
  const { arch, electronPlatformName, appOutDir, packager } = context;
  const targetArch = normalizeArch(typeof arch === 'string' ? arch : Arch[arch] || process.arch);
  const buildArch = normalizeArch(os.arch());

  console.log(`\n🔧 afterPack hook started`);
  console.log(`   Platform: ${electronPlatformName}, Build arch: ${buildArch}, Target arch: ${targetArch}`);

  const isCrossCompile = buildArch !== targetArch;
  const forceRebuild = process.env.FORCE_NATIVE_REBUILD === 'true';
  const needsSameArchRebuild = electronPlatformName === 'win32'; // 只有 Windows 需要同架构重建以匹配 Electron ABI | Only Windows needs same-arch rebuild to match Electron ABI
  // Linux 使用预编译二进制，避免 GLIBC 版本依赖 | Linux uses prebuilt binaries which are GLIBC-independent

  const resourcesDir = resolveResourcesDir(electronPlatformName, appOutDir, packager);
  console.log(`   Checking resources directory: ${resourcesDir}`);
  if (fs.existsSync(resourcesDir)) {
    const resourcesContents = fs.readdirSync(resourcesDir);
    console.log(`   Contents: ${resourcesContents.join(', ')}`);

    const unpackedDir = path.join(resourcesDir, 'app.asar.unpacked');
    if (fs.existsSync(unpackedDir)) {
      const unpackedContents = fs.readdirSync(unpackedDir);
      console.log(`   app.asar.unpacked contents: ${unpackedContents.join(', ')}`);

      const nodeModulesDir = path.join(unpackedDir, 'node_modules');
      if (fs.existsSync(nodeModulesDir)) {
        const modulesContents = fs.readdirSync(nodeModulesDir);
        console.log(`   node_modules contents: ${modulesContents.slice(0, 10).join(', ')}...`);
      } else {
        console.warn(`   ⚠️  node_modules not found in app.asar.unpacked`);
      }
    } else {
      console.warn(`   ⚠️  app.asar.unpacked not found`);
    }

    verifyBundledResources(resourcesDir, electronPlatformName, targetArch);
    verifySharpRuntime(resourcesDir, electronPlatformName, targetArch);
  } else {
    throw new Error(`resources directory not found: ${resourcesDir}`);
  }

  if (!isCrossCompile && !needsSameArchRebuild && !forceRebuild) {
    console.log(`   ✓ Same architecture, rebuild skipped (set FORCE_NATIVE_REBUILD=true to override)\n`);
    return;
  }

  // Note: Previously there was an optimization to skip macOS cross-compilation,
  // but this caused incorrect architecture binaries (arm64) to be included in x64 builds.
  // Now we always rebuild native modules for cross-compilation to ensure correctness.
  // The rebuild process uses prebuild-install first (fast), falling back to source compilation only when needed.

  if (isCrossCompile) {
    console.log(`   ⚠️  Cross-compilation detected (${buildArch} → ${targetArch}), will rebuild native modules`);
    if (electronPlatformName === 'darwin') {
      console.log(`   💡 Using prebuild-install for faster cross-architecture build`);
    }
  } else if (needsSameArchRebuild || forceRebuild) {
    console.log(`   ℹ️  Rebuilding native modules for platform requirements (force=${forceRebuild})`);
  }

  console.log(`\n🔧 Checking native modules (${electronPlatformName}-${targetArch})...`);
  console.log(`   appOutDir: ${appOutDir}`);

  const electronVersion =
    packager?.info?.electronVersion ??
    packager?.config?.electronVersion ??
    require('../package.json').devDependencies?.electron?.replace(/^\D*/, '');

  const nodeModulesDir = path.join(resourcesDir, 'app.asar.unpacked', 'node_modules');

  // Modules that need to be rebuilt for cross-compilation
  // Use platform-specific module list (Windows skips node-pty due to cross-compilation issues)
  const modulesToRebuild = getModulesToRebuild(electronPlatformName);
  console.log(`   Modules to rebuild: ${modulesToRebuild.join(', ')}`);

  // For cross-compilation, clean up build artifacts from the wrong architecture
  // This prevents node-gyp-build from loading incorrect binaries
  if (isCrossCompile) {
    console.log(`\n🧹 Cleaning up wrong-architecture build artifacts...`);
    for (const moduleName of modulesToRebuild) {
      const moduleRoot = path.join(nodeModulesDir, moduleName);
      if (!fs.existsSync(moduleRoot)) continue;

      // Remove build/ directory (contains wrong-arch compiled binaries)
      const buildDir = path.join(moduleRoot, 'build');
      if (fs.existsSync(buildDir)) {
        fs.rmSync(buildDir, { recursive: true, force: true });
        console.log(`   ✓ Removed ${moduleName}/build/`);
      }

      // Remove bin/ directory (might contain wrong-arch binaries)
      const binDir = path.join(moduleRoot, 'bin');
      if (fs.existsSync(binDir)) {
        fs.rmSync(binDir, { recursive: true, force: true });
        console.log(`   ✓ Removed ${moduleName}/bin/`);
      }
    }

    // Also clean up architecture-specific packages that shouldn't be included
    // Remove packages for the opposite architecture of the target
    const wrongArchSuffix = targetArch === 'arm64' ? 'x64' : 'arm64';
    console.log(`\n🧹 Removing ${wrongArchSuffix}-specific optional dependencies (target: ${targetArch})...`);

    if (fs.existsSync(nodeModulesDir)) {
      const allModules = fs.readdirSync(nodeModulesDir);
      for (const module of allModules) {
        const modulePath = path.join(nodeModulesDir, module);

        // Handle scoped packages (e.g., @lydell, @napi-rs)
        if (module.startsWith('@') && fs.existsSync(modulePath) && fs.statSync(modulePath).isDirectory()) {
          const scopedPackages = fs.readdirSync(modulePath);
          for (const pkg of scopedPackages) {
            if (pkg.includes(`-${wrongArchSuffix}`) || pkg.includes(`-${electronPlatformName}-${wrongArchSuffix}`)) {
              const pkgPath = path.join(modulePath, pkg);
              if (fs.existsSync(pkgPath) && fs.statSync(pkgPath).isDirectory()) {
                fs.rmSync(pkgPath, { recursive: true, force: true });
                console.log(`   ✓ Removed ${module}/${pkg}`);
              }
            }
          }
        }
        // Handle regular packages
        else if (
          module.includes(`-${wrongArchSuffix}`) ||
          module.includes(`-${electronPlatformName}-${wrongArchSuffix}`)
        ) {
          if (fs.existsSync(modulePath) && fs.statSync(modulePath).isDirectory()) {
            fs.rmSync(modulePath, { recursive: true, force: true });
            console.log(`   ✓ Removed ${module}`);
          }
        }
      }
    }
  }

  const failedModules = [];

  for (const moduleName of modulesToRebuild) {
    const moduleRoot = path.join(nodeModulesDir, moduleName);

    if (!fs.existsSync(moduleRoot)) {
      console.warn(`   ⚠️  ${moduleName} not found, skipping`);
      continue;
    }

    console.log(`   ✓ Found ${moduleName}, rebuilding for ${targetArch}...`);

    // For Windows, prefer prebuild-install first (faster and more reliable in CI)
    // electron-rebuild can hang on "Searching dependency tree" in some CI environments
    // prebuild-install will fall back to electron-rebuild internally if no prebuilt binary exists
    const forceRebuildFromSource = false; // Always try prebuild-install first

    const success = rebuildSingleModule({
      moduleName,
      moduleRoot,
      platform: electronPlatformName,
      arch: targetArch,
      electronVersion,
      projectRoot: path.resolve(__dirname, '..'),
      buildArch: buildArch, // Pass build architecture for cross-compile detection
      forceRebuild: forceRebuildFromSource, // Always try prebuild-install first, fallback to rebuild
    });

    if (success) {
      console.log(`     ✓ Rebuild completed`);
    } else {
      console.error(`     ✗ Rebuild failed`);
      failedModules.push(moduleName);
      continue;
    }

    const verified = verifyModuleBinary(moduleRoot, moduleName);
    if (verified) {
      console.log(`     ✓ Binary verification passed`);
    } else {
      console.error(`     ✗ Binary verification failed`);
      failedModules.push(moduleName);
    }

    console.log(''); // Empty line between modules
  }

  if (failedModules.length > 0) {
    throw new Error(`Failed to rebuild modules for ${electronPlatformName}-${targetArch}: ${failedModules.join(', ')}`);
  }

  console.log(`✅ All native modules rebuilt successfully for ${targetArch}\n`);
};
