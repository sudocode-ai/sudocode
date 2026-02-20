#!/usr/bin/env node

/**
 * Node.js SEA Packaging Script for sudocode
 *
 * Packages CLI, server, and MCP binaries for target platforms using Node.js SEA.
 *
 * Usage:
 *   node build-scripts/package-sea.js                          # All platforms
 *   node build-scripts/package-sea.js --platform=linux-x64     # Single platform
 *   node build-scripts/package-sea.js --channel=dev            # Dev channel
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';
import https from 'https';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import crypto from 'crypto';

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

const NODE_VERSION = 'v22.12.0';

const PLATFORMS = {
  'linux-x64': {
    nodeUrl: `https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.gz`,
    nodeBinaryPath: `node-${NODE_VERSION}-linux-x64/bin/node`,
    postjectFlags: [],
  },
  'linux-x64-musl': {
    nodeUrl: `https://unofficial-builds.nodejs.org/download/release/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64-musl.tar.gz`,
    nodeBinaryPath: `node-${NODE_VERSION}-linux-x64-musl/bin/node`,
    postjectFlags: [],
  },
  'linux-arm64': {
    nodeUrl: `https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-arm64.tar.gz`,
    nodeBinaryPath: `node-${NODE_VERSION}-linux-arm64/bin/node`,
    postjectFlags: [],
  },
  // NOTE: linux-arm64-musl is not available from unofficial-builds.nodejs.org
  'darwin-x64': {
    nodeUrl: `https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-darwin-x64.tar.gz`,
    nodeBinaryPath: `node-${NODE_VERSION}-darwin-x64/bin/node`,
    postjectFlags: ['--macho-segment-name', 'NODE_SEA'],
  },
  'darwin-arm64': {
    nodeUrl: `https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-darwin-arm64.tar.gz`,
    nodeBinaryPath: `node-${NODE_VERSION}-darwin-arm64/bin/node`,
    postjectFlags: ['--macho-segment-name', 'NODE_SEA'],
  },
};

const BINARIES = [
  { name: 'sudocode', bundle: 'cli-bundle.js', seaConfig: 'sea-config-cli.json', blob: 'sea-cli.blob' },
  { name: 'sudocode-server', bundle: 'server-bundle.js', seaConfig: 'sea-config-server.json', blob: 'sea-server.blob' },
  { name: 'sudocode-mcp', bundle: 'mcp-bundle.js', seaConfig: 'sea-config-mcp.json', blob: 'sea-mcp.blob' },
];

const distDir = path.join(rootDir, 'dist');
const seaDir = path.join(distDir, 'sea');
const buildDir = path.join(distDir, 'build');
const packagesDir = path.join(distDir, 'packages');

function ensureDirs() {
  for (const dir of [distDir, seaDir, buildDir, packagesDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function downloadFile(url, destPath) {
  console.log(`  Downloading: ${url}`);
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const ws = createWriteStream(destPath);
      pipeline(res, ws).then(resolve).catch(reject);
    }).on('error', reject);
  });
}

async function downloadNodeBinary(platform, config) {
  const platformBuildDir = path.join(buildDir, platform);
  fs.mkdirSync(platformBuildDir, { recursive: true });

  const extractedPath = path.join(platformBuildDir, config.nodeBinaryPath);
  if (fs.existsSync(extractedPath)) {
    console.log(`  Node.js binary cached: ${platform}`);
    return extractedPath;
  }

  const tarPath = path.join(platformBuildDir, 'node.tar.gz');
  await downloadFile(config.nodeUrl, tarPath);

  await execFileAsync('tar', ['-xzf', tarPath, '-C', platformBuildDir]);

  if (!fs.existsSync(extractedPath)) {
    throw new Error(`Failed to extract Node.js binary for ${platform}`);
  }

  fs.unlinkSync(tarPath);
  return extractedPath;
}

function generateSEAConfigs() {
  console.log('Generating SEA config files...');
  for (const binary of BINARIES) {
    const config = {
      main: binary.bundle,
      output: binary.blob,
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false,
    };
    fs.writeFileSync(path.join(seaDir, binary.seaConfig), JSON.stringify(config, null, 2));
  }
}

// Get the native platform key for this machine
function getNativePlatform() {
  const os = process.platform === 'darwin' ? 'darwin' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  return `${os}-${arch}`;
}

async function generateSEABlobs(nodeBinaryPath) {
  console.log('Generating SEA blobs...');
  console.log(`  Using Node: ${nodeBinaryPath}`);
  for (const binary of BINARIES) {
    const bundlePath = path.join(seaDir, binary.bundle);
    if (!fs.existsSync(bundlePath)) {
      throw new Error(`Bundle not found: ${bundlePath}. Run 'npm run build:sea' first.`);
    }

    console.log(`  ${binary.name}...`);
    await execFileAsync(nodeBinaryPath, ['--experimental-sea-config', binary.seaConfig], { cwd: seaDir });

    const blobPath = path.join(seaDir, binary.blob);
    if (!fs.existsSync(blobPath)) {
      throw new Error(`Blob generation failed for ${binary.name}`);
    }
  }
}

async function injectBlob(nodeBinaryPath, blobPath, outputPath, postjectFlags) {
  fs.copyFileSync(nodeBinaryPath, outputPath);
  fs.chmodSync(outputPath, 0o755);

  // On macOS, remove existing code signature before injection
  if (process.platform === 'darwin' || outputPath.includes('darwin')) {
    try {
      await execFileAsync('codesign', ['--remove-signature', outputPath]);
    } catch {
      // Not on macOS or codesign not available — skip
    }
  }

  await execFileAsync('npx', [
    'postject',
    outputPath,
    'NODE_SEA_BLOB',
    blobPath,
    '--sentinel-fuse',
    'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    ...postjectFlags,
  ]);

  // Re-sign on macOS (ad-hoc signature)
  if (process.platform === 'darwin' || outputPath.includes('darwin')) {
    try {
      await execFileAsync('codesign', ['--sign', '-', outputPath]);
    } catch {
      // Not on macOS or codesign not available — CI builds on Linux won't have this
    }
  }
}

function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

async function downloadSqlitePrebuilt(platform, targetDir) {
  // Determine the prebuild filename based on platform
  // better-sqlite3 prebuilds are published to GitHub releases
  // Format: better-sqlite3-v{version}-node-v{abi}-{os}-{arch}.tar.gz
  // Node 22 ABI = 127

  const betterSqliteVersion = JSON.parse(
    fs.readFileSync(path.join(rootDir, 'node_modules/better-sqlite3/package.json'), 'utf8')
  ).version;

  const abi = '127'; // Node 22 ABI

  // Map our platform names to prebuild names
  const platformMap = {
    'linux-x64': { os: 'linux', arch: 'x64' },
    'linux-x64-musl': { os: 'linuxmusl', arch: 'x64' },
    'linux-arm64': { os: 'linux', arch: 'arm64' },
    'darwin-x64': { os: 'darwin', arch: 'x64' },
    'darwin-arm64': { os: 'darwin', arch: 'arm64' },
  };

  const p = platformMap[platform];
  if (!p) throw new Error(`Unknown platform: ${platform}`);

  const prebuiltName = `better-sqlite3-v${betterSqliteVersion}-node-v${abi}-${p.os}-${p.arch}.tar.gz`;
  const prebuiltUrl = `https://github.com/WiseLibs/better-sqlite3/releases/download/v${betterSqliteVersion}/${prebuiltName}`;

  const tmpTar = path.join(targetDir, 'sqlite-prebuild.tar.gz');
  const extractDir = path.join(targetDir, 'sqlite-extract');
  fs.mkdirSync(extractDir, { recursive: true });

  try {
    await downloadFile(prebuiltUrl, tmpTar);
    await execFileAsync('tar', ['-xzf', tmpTar, '-C', extractDir]);

    // Prebuilds extract to build/Release/better_sqlite3.node
    const srcNode = path.join(extractDir, 'build', 'Release', 'better_sqlite3.node');
    if (!fs.existsSync(srcNode)) {
      throw new Error(`Prebuild extraction didn't produce expected file`);
    }

    const destDir = path.join(targetDir, 'node_modules', 'better-sqlite3', 'build', 'Release');
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(srcNode, path.join(destDir, 'better_sqlite3.node'));

    console.log(`  better-sqlite3 prebuild installed for ${platform}`);
  } finally {
    // Cleanup
    if (fs.existsSync(tmpTar)) fs.unlinkSync(tmpTar);
    if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true });
  }
}

function copyFrontendAssets(targetDir) {
  const src = path.join(seaDir, 'public');
  if (!fs.existsSync(src)) {
    console.warn('  No frontend assets in dist/sea/public/');
    return;
  }
  const dest = path.join(targetDir, 'public');
  fs.cpSync(src, dest, { recursive: true });
  console.log('  Frontend assets copied');
}

async function packagePlatform(platform, config) {
  console.log(`\nPackaging ${platform}...`);

  const version = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')).version;
  const packageName = `sudocode-${version}-${platform}`;
  const packageDir = path.join(buildDir, packageName);
  const binDir = path.join(packageDir, 'bin');

  if (fs.existsSync(packageDir)) fs.rmSync(packageDir, { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });

  // Download Node.js binary for this platform
  const nodeBinaryPath = await downloadNodeBinary(platform, config);

  // Inject SEA blobs
  for (const binary of BINARIES) {
    const blobPath = path.join(seaDir, binary.blob);
    const outputPath = path.join(binDir, binary.name);
    console.log(`  Injecting ${binary.name}...`);
    await injectBlob(nodeBinaryPath, blobPath, outputPath, config.postjectFlags);
  }

  // Create sdc symlink
  fs.symlinkSync('sudocode', path.join(binDir, 'sdc'));

  // Download platform-specific better-sqlite3 prebuild
  await downloadSqlitePrebuilt(platform, packageDir);

  // Copy frontend assets for server
  copyFrontendAssets(packageDir);

  // Create package.json at package root (version.ts reads from ../package.json relative to bin/)
  fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ version }, null, 2));

  // Create tarball using system tar
  const tarballName = `${packageName}.tar.gz`;
  const tarballPath = path.join(packagesDir, tarballName);
  await execFileAsync('tar', ['-czf', tarballPath, '-C', buildDir, packageName]);

  const stats = fs.statSync(tarballPath);
  const checksum = sha256(tarballPath);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
  console.log(`  ${tarballName} (${sizeMB} MB) sha256:${checksum.slice(0, 12)}...`);

  // Write per-platform checksum file
  fs.writeFileSync(
    tarballPath.replace('.tar.gz', '.checksums.txt'),
    `${checksum}  ${tarballName}\n`
  );

  return { path: tarballPath, name: tarballName, platform, checksum, size: stats.size };
}

function generateManifest(packages, version, channel) {
  const baseUrl = process.env.GITHUB_REPOSITORY
    ? `https://github.com/${process.env.GITHUB_REPOSITORY}/releases/download`
    : 'https://github.com/sudocode-ai/sudocode/releases/download';

  const tag = channel === 'dev'
    ? `dev-${(process.env.GITHUB_SHA || 'local').slice(0, 7)}`
    : `v${version}`;

  const manifest = {
    version,
    channel,
    released_at: new Date().toISOString(),
    platforms: {},
  };

  for (const pkg of packages) {
    manifest.platforms[pkg.platform] = {
      url: `${baseUrl}/${tag}/${pkg.name}`,
      sha256: pkg.checksum,
      size: pkg.size,
    };
  }

  const manifestPath = path.join(packagesDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\nManifest: ${manifestPath}`);
  return manifestPath;
}

async function main() {
  console.log('sudocode SEA Packaging\n');

  const args = process.argv.slice(2);
  const platformArg = args.find(a => a.startsWith('--platform='));
  const singlePlatform = platformArg?.split('=')[1];
  const channelArg = args.find(a => a.startsWith('--channel='));
  const channel = channelArg?.split('=')[1] || 'stable';

  if (singlePlatform && !PLATFORMS[singlePlatform]) {
    console.error(`Invalid platform: ${singlePlatform}`);
    console.error(`Available: ${Object.keys(PLATFORMS).join(', ')}`);
    process.exit(1);
  }

  ensureDirs();

  // Download Node 22.12.0 for the native platform to generate blobs
  // (blobs must be generated with the same Node version as the target binary)
  const nativePlatform = getNativePlatform();
  console.log(`Native platform: ${nativePlatform}`);
  const nativeNodePath = await downloadNodeBinary(nativePlatform, PLATFORMS[nativePlatform]);

  generateSEAConfigs();
  await generateSEABlobs(nativeNodePath);

  const platformsToBuild = singlePlatform ? [singlePlatform] : Object.keys(PLATFORMS);
  console.log(`Building ${platformsToBuild.length} platform(s): ${platformsToBuild.join(', ')}`);

  const results = [];
  for (const platform of platformsToBuild) {
    results.push(await packagePlatform(platform, PLATFORMS[platform]));
  }

  const version = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')).version;
  generateManifest(results, version, channel);

  console.log('\nDone!');
  for (const pkg of results) {
    console.log(`  ${pkg.name} (${(pkg.size / 1024 / 1024).toFixed(1)} MB)`);
  }
}

main().catch(err => {
  console.error('Packaging failed:', err);
  process.exit(1);
});
