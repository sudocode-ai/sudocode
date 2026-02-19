#!/usr/bin/env node

/**
 * esbuild config for sudocode-server
 * Bundles into a single CJS file for Node.js SEA packaging.
 *
 * Frontend assets are copied separately into dist/sea/public/.
 */

import * as esbuild from 'esbuild';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { cpSync, existsSync, mkdirSync } from 'fs';
import { builtinModules } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

const nodeBuiltins = [
  ...builtinModules,
  ...builtinModules.map(m => `node:${m}`),
];

// Shim import.meta.url for CJS output (SEA in Node 22 only supports CJS)
// Also suppress the SEA require() warning (cosmetic — our bindings shim uses createRequire correctly)
const importMetaShim = [
  'var __import_meta_url = require("url").pathToFileURL(__filename).href;',
  'var __origEmit = process.emit;',
  'process.emit = function(e, w) {',
  '  if (e === "warning" && w && w.message && w.message.includes("require() provided to the main script")) return false;',
  '  return __origEmit.apply(this, arguments);',
  '};',
].join('\n');

/**
 * Plugin that replaces `require('bindings')` with a SEA-compatible loader.
 * In SEA, the built-in require() only loads builtins. We use createRequire()
 * to load native .node files from disk relative to the binary.
 */
const seaNativePlugin = {
  name: 'sea-native-bindings',
  setup(build) {
    build.onResolve({ filter: /^bindings$/ }, () => ({
      path: 'bindings',
      namespace: 'sea-bindings',
    }));

    build.onLoad({ filter: /.*/, namespace: 'sea-bindings' }, () => ({
      contents: `
        const path = require("path");
        const fs = require("fs");
        const { createRequire } = require("module");
        module.exports = function(opts) {
          const name = typeof opts === "string" ? opts : opts.bindings || opts;
          const binDir = path.dirname(process.execPath);
          const diskRequire = createRequire(path.join(binDir, "__sea__.js"));
          const candidates = [
            path.join(binDir, "node_modules", "better-sqlite3", "build", "Release", name),
            path.join(binDir, "..", "node_modules", "better-sqlite3", "build", "Release", name),
          ];
          for (const p of candidates) {
            if (fs.existsSync(p)) return diskRequire(p);
          }
          throw new Error("Cannot find " + name + ". Searched: " + candidates.join(", "));
        };
      `,
      loader: 'js',
    }));
  },
};

function copyFrontendAssets() {
  const src = path.join(rootDir, 'frontend/dist');
  const dest = path.join(rootDir, 'dist/sea/public');

  if (!existsSync(src)) {
    console.warn('Frontend dist not found — build frontend first.');
    return;
  }

  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
  console.log('Frontend assets copied to dist/sea/public/');
}

async function build() {
  console.log('Building sudocode-server bundle...');

  copyFrontendAssets();

  await esbuild.build({
    entryPoints: [path.join(rootDir, 'server/src/cli.ts')],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    outfile: path.join(rootDir, 'dist/sea/server-bundle.js'),
    external: [...nodeBuiltins],
    packages: 'bundle',
    treeShaking: true,
    sourcemap: false,
    mainFields: ['module', 'main'],
    logLevel: 'info',
    banner: { js: importMetaShim },
    plugins: [seaNativePlugin],
    define: {
      'process.env.NODE_ENV': '"production"',
      'import.meta.url': '__import_meta_url',
    },
  });

  console.log('Server bundle built: dist/sea/server-bundle.js');
}

build().catch(err => {
  console.error('Server bundle failed:', err);
  process.exit(1);
});
