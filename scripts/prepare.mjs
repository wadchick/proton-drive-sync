// Point this checkout at the tracked commit hooks. npm install and npm ci run this.
// A checkout that is not a git repository, such as a packed tarball, skips it.
import { execFileSync } from 'node:child_process';

try {
  execFileSync('git', ['rev-parse', '--git-dir'], { stdio: 'ignore' });
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'ignore' });
} catch {
  // Not a git checkout.
}
