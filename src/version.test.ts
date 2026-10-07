import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { packageVersion, readPackageVersion } from './version.js';

const repoVersion = (JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../package.json'), 'utf8')) as { version: string }).version;

function writePackage(dir: string, value: unknown): void {
  writeFileSync(path.join(dir, 'package.json'), typeof value === 'string' ? value : JSON.stringify(value));
}

describe('packageVersion', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
  });

  function temp(): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'pds-version-'));
    dirs.push(dir);
    return dir;
  }

  it('returns the repo package version', () => {
    expect(packageVersion()).toBe(repoVersion);
  });

  it('returns null when package.json is missing, invalid, misnamed, or has a rejected version', () => {
    expect(readPackageVersion(temp())).toBeNull();

    const invalid = temp();
    writePackage(invalid, '{');
    expect(readPackageVersion(invalid)).toBeNull();

    const other = temp();
    writePackage(other, { name: 'other-tool', version: '1.2.3' });
    expect(readPackageVersion(other)).toBeNull();

    const rejected = temp();
    writePackage(rejected, { name: 'proton-drive-sync', version: '0.2.1 ' });
    expect(readPackageVersion(rejected)).toBeNull();
  });

  it('reads a matching package.json up to six parents and stops after that', () => {
    const root = temp();
    writePackage(root, { name: 'proton-drive-sync', version: '4.5.6' });
    const sixth = path.join(root, 'a', 'b', 'c', 'd', 'e', 'f');
    mkdirSync(sixth, { recursive: true });
    expect(readPackageVersion(sixth)).toBe('4.5.6');

    const seventh = path.join(sixth, 'g');
    mkdirSync(seventh);
    expect(readPackageVersion(seventh)).toBeNull();
  });
});
