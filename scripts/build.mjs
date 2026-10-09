// Production bundle, committed as dist/cli/main.js. Proton's SDK and crypto packages are
// shipped bundler-style (raw TypeScript, extensionless ESM imports), so the app must be
// bundled; `omarchy plugin add` then runs the checked-in file without npm or a build step.
// The output is deterministic for a given lockfile: `scripts/ci.sh` rebuilds and fails on
// any diff, so the committed bundle always matches the committed sources.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/cli/main.ts'],
  outfile: 'dist/cli/main.js',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: false,
  charset: 'utf8',
  legalComments: 'eof',
  banner: { js: '#!/usr/bin/env node\nimport { createRequire as __pdsCreateRequire } from "node:module"; const require = __pdsCreateRequire(import.meta.url);' },
  // dbus-next optionally requires 'x11' for X11-property bus discovery; it is not installed and not needed.
  external: ['x11'],
  // openpgp/lightweight has no Node entry; Proton's own CLI patches it to the main build.
  alias: { 'openpgp/lightweight': 'openpgp' },
  logLevel: 'info',
});
