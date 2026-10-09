import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const repo = path.resolve(import.meta.dirname, '../..');
const launcher = path.join(repo, 'bin/proton-drive-sync');
const remove = path.join(repo, 'scripts/remove-engine');
const bundle = path.join(repo, 'dist/cli/main.js');

let home: string;

function nodeStub(file: string, major: number): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    `#!/bin/bash
if [[ "$1" == "-e" ]]; then exit $(( ${major} >= 24 ? 0 : 1 )); fi
printf '%s\\n' "$0 $*" >> "$HOME/node-runs.log"
printf '%s\\n' "\${NODE_OPTIONS-unset}" >> "$HOME/node-env.log"
exit 0
`,
    { mode: 0o755 },
  );
}

function run(script: string, args: string[] = [], extra: NodeJS.ProcessEnv = {}): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(script, args, {
    env: {
      HOME: home,
      PATH: `${path.join(home, 'bin')}:/usr/bin:/bin`,
      XDG_DATA_HOME: path.join(home, 'data'),
      XDG_CONFIG_HOME: path.join(home, 'config'),
      ...extra,
    },
    encoding: 'utf8',
  });
  return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
}

beforeEach(() => {
  home = mkdtempSync(path.join(os.tmpdir(), 'pds-launcher-'));
  mkdirSync(path.join(home, 'bin'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('engine launcher', () => {
  it('runs the committed bundle with the newest mise Node and never a Node from PATH', () => {
    nodeStub(path.join(home, 'bin/node'), 30); // on PATH, must be ignored
    nodeStub(path.join(home, '.local/share/mise/installs/node/22.1.0/bin/node'), 22);
    nodeStub(path.join(home, '.local/share/mise/installs/node/24.3.0/bin/node'), 24);
    nodeStub(path.join(home, '.local/share/mise/installs/node/26.7.0/bin/node'), 26);
    const result = run(launcher, ['doctor', '--json'], { NODE_OPTIONS: '--require /tmp/evil.js', PROTON_DRIVE_SYNC_NODE: '' });
    expect(result.status).toBe(0);
    const ran = readFileSync(path.join(home, 'node-runs.log'), 'utf8').trim();
    expect(ran).toBe(`${path.join(home, '.local/share/mise/installs/node/26.7.0/bin/node')} ${bundle} doctor --json`);
    expect(readFileSync(path.join(home, 'node-env.log'), 'utf8').trim()).toBe('unset');
  });

  it('prefers an explicit PROTON_DRIVE_SYNC_NODE and skips one that is too old', () => {
    const chosen = path.join(home, 'opt/node');
    nodeStub(chosen, 24);
    expect(run(launcher, ['--version'], { PROTON_DRIVE_SYNC_NODE: chosen }).status).toBe(0);
    expect(readFileSync(path.join(home, 'node-runs.log'), 'utf8')).toContain(`${chosen} ${bundle} --version`);

    const old = path.join(home, 'opt/old-node');
    nodeStub(old, 20);
    run(launcher, ['--version'], { PROTON_DRIVE_SYNC_NODE: old });
    expect(readFileSync(path.join(home, 'node-runs.log'), 'utf8')).not.toContain(old);
  });

  it('is plain bash with no sudo, no npm, and no PATH lookup of node', () => {
    const text = readFileSync(launcher, 'utf8');
    expect(text).not.toContain('sudo');
    expect(text).not.toMatch(/\bnpm\b/);
    expect(text).not.toMatch(/command -v node|which node/);
    expect(execFileSync('bash', ['-n', launcher], { encoding: 'utf8' })).toBe('');
  });
});

describe('legacy engine removal (installs before 0.3.0)', () => {
  function legacyInstall(): { unit: string; link: string; runtime: string } {
    const runtime = path.join(home, 'data/proton-drive-sync/runtime');
    const link = path.join(home, '.local/bin/proton-drive-sync');
    const unit = path.join(home, 'config/systemd/user/proton-drive-sync.service');
    mkdirSync(runtime, { recursive: true });
    writeFileSync(path.join(runtime, '.installed-by'), 'io.github.zakkoo.proton-drive\n');
    mkdirSync(path.dirname(link), { recursive: true });
    writeFileSync(link, `#!/usr/bin/env bash\n# installed-by=io.github.zakkoo.proton-drive\n# runtime=${runtime}\nexec node "${runtime}/dist/cli/main.js" "$@"\n`, { mode: 0o755 });
    mkdirSync(path.dirname(unit), { recursive: true });
    writeFileSync(unit, '[Service]\n# installed-by=io.github.zakkoo.proton-drive\nExecStart=/x run --no-tray\n');
    writeFileSync(path.join(home, 'bin/systemctl'), '#!/bin/bash\nprintf \'%s\\n\' "$*" >> "$HOME/systemctl.log"\nexit 0\n', { mode: 0o755 });
    return { unit, link, runtime };
  }

  it('deletes only the marked runtime, launcher, and unit, and keeps user data', () => {
    const { unit, link, runtime } = legacyInstall();
    const config = path.join(home, 'config/proton-drive-sync/config.json');
    const state = path.join(home, 'data/proton-drive-sync/state.db');
    mkdirSync(path.dirname(config), { recursive: true });
    writeFileSync(config, '{"keep":true}\n');
    writeFileSync(state, 'state\n');

    expect(run(remove).status).toBe(0);
    expect(() => readFileSync(unit)).toThrow();
    expect(() => readFileSync(link)).toThrow();
    expect(() => readFileSync(path.join(runtime, '.installed-by'))).toThrow();
    expect(readFileSync(config, 'utf8')).toBe('{"keep":true}\n');
    expect(readFileSync(state, 'utf8')).toBe('state\n');
    expect(readFileSync(path.join(home, 'systemctl.log'), 'utf8')).toContain('disable --now proton-drive-sync.service');
    // Idempotent: the service runs it on every load.
    expect(run(remove).status).toBe(0);
  });

  it('leaves a unit and a launcher that this plugin did not write', () => {
    const unit = path.join(home, 'config/systemd/user/proton-drive-sync.service');
    const link = path.join(home, '.local/bin/proton-drive-sync');
    mkdirSync(path.dirname(unit), { recursive: true });
    mkdirSync(path.dirname(link), { recursive: true });
    writeFileSync(unit, '[Service]\nExecStart=/elsewhere/proton-drive-sync run\n');
    writeFileSync(link, '#!/bin/sh\necho foreign\n');
    expect(run(remove).status).toBe(0);
    expect(readFileSync(unit, 'utf8')).toContain('/elsewhere/proton-drive-sync');
    expect(readFileSync(link, 'utf8')).toBe('#!/bin/sh\necho foreign\n');
  });
});
