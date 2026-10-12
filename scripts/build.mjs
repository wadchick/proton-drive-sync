// Production bundle, committed under dist/cli/. Proton's SDK and crypto packages are shipped
// bundler-style (raw TypeScript, extensionless ESM imports), so the app must be bundled;
// `omarchy plugin add` then runs the checked-in entry point without npm or a build step.
// The output is deterministic for a given lockfile: `scripts/ci.sh` rebuilds and fails on
// any diff, so the committed bundle always matches the committed sources.
import { mkdirSync, rmSync } from 'node:fs';
import { build } from 'esbuild';

const outputDir = 'dist/cli';
rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

const result = await build({
  // The OpenPGP SDK entry forces esbuild to extract its large shared implementation
  // into scan-friendly chunks. It is part of the committed runtime, not a runtime dependency.
  entryPoints: {
    main: 'src/cli/main.ts',
    'vendor/openpgp': 'node_modules/openpgp/dist/node/openpgp.mjs',
  },
  outdir: 'dist/cli',
  entryNames: '[name]',
  chunkNames: 'chunk-[hash]',
  bundle: true,
  splitting: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  minify: true,
  sourcemap: false,
  charset: 'utf8',
  legalComments: 'eof',
  banner: { js: '#!/usr/bin/env node\nimport { createRequire as __pdsCreateRequire } from "node:module"; const require = __pdsCreateRequire(import.meta.url);' },
  // dbus-next optionally requires 'x11' for X11-property bus discovery; it is not installed and not needed.
  external: ['x11'],
  // openpgp/lightweight has no Node entry; Proton's own CLI patches it to the main build.
  alias: { 'openpgp/lightweight': 'openpgp' },
  metafile: true,
  logLevel: 'info',
});

// Keep every checked-in JavaScript file below the marketplace scanner's 512 KiB file cap.
const maxFileBytes = 512 * 1024;
const oversized = Object.entries(result.metafile.outputs)
  .map(([file, output]) => ({ file, bytes: output.bytes }))
  .filter(({ bytes }) => bytes > maxFileBytes);
if (oversized.length > 0) {
  throw new Error(`Generated runtime files exceed ${maxFileBytes} bytes: ${oversized.map(({ file, bytes }) => `${file} (${bytes})`).join(', ')}`);
}
