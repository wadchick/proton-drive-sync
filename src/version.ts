import { readFileSync } from 'node:fs';
import path from 'node:path';

const PACKAGE_NAME = 'proton-drive-sync';
const VERSION_PATTERN = /^[0-9A-Za-z.+-]{1,32}$/;
/** Start directory plus this many parents. The bundle and the sources sit at different depths. */
const MAX_PARENTS = 6;

/**
 * Read the package version by walking up from `startDir`.
 * Returns null when no acceptable `package.json` is found in range.
 */
export function readPackageVersion(startDir: string): string | null {
  let dir = startDir;
  for (let parents = 0; parents <= MAX_PARENTS; parents += 1) {
    const found = versionAt(dir);
    if (found !== undefined) return found;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/** Package version of the module that is running, or null when it cannot be read. */
export function packageVersion(): string | null {
  return readPackageVersion(import.meta.dirname);
}

function versionAt(dir: string): string | null | undefined {
  const file = path.join(dir, 'package.json');
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if (isEnoent(error)) return undefined;
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const name = 'name' in parsed ? parsed.name : undefined;
  if (name !== PACKAGE_NAME) return undefined;
  const version = 'version' in parsed ? parsed.version : undefined;
  if (typeof version !== 'string' || !VERSION_PATTERN.test(version)) return null;
  return version;
}

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
