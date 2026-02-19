#!/usr/bin/env node

/**
 * esbuild config for sudocode CLI
 * Bundles into a single CJS file for Node.js SEA packaging.
 */

import * as esbuild from 'esbuild';
import * as path from 'path';
import { fileURLToPath } from 'url';
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
          // Search: same dir as binary (installed), then parent dir (extracted tarball)
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

async function build() {
  console.log('Building sudocode CLI bundle...');

  await esbuild.build({
    entryPoints: [path.join(rootDir, 'cli/src/cli.ts')],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    outfile: path.join(rootDir, 'dist/sea/cli-bundle.js'),
    external: [...nodeBuiltins],
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

  console.log('CLI bundle built: dist/sea/cli-bundle.js');
}

build().catch(err => {
  console.error('CLI bundle failed:', err);
  process.exit(1);
});
