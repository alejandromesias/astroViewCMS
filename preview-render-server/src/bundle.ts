// Bundle identity (WORKPLAN 2.0b): what build time knows about one build and
// writes into bundle.json. Build-time only: it reads git and the astro package,
// which the running node never needs.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

/** A fresh id for one build: a random UUID. build.ts uses it unless --bundle-id
 *  is given. */
export function newBundleId(): string {
  return randomUUID();
}

/** The commit that `git rev-parse HEAD` gives in the site folder, or null when
 *  the folder is not in a git checkout or git is missing. `runGit` returns the
 *  command's output; tests replace it. */
export function readSiteCommit(
  root: string,
  runGit: (cwd: string) => string = gitHead,
): string | null {
  let output: string;
  try {
    output = runGit(root);
  } catch {
    return null;
  }
  const commit = output.trim();
  return /^[0-9a-f]{40,64}$/.test(commit) ? commit : null;
}

function gitHead(cwd: string): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

/** The version of the astro package this build runs with. */
export function astroVersion(): string {
  const pkg: unknown = createRequire(import.meta.url)('astro/package.json');
  if (
    typeof pkg === 'object' &&
    pkg !== null &&
    'version' in pkg &&
    typeof pkg.version === 'string'
  ) {
    return pkg.version;
  }
  throw new Error('astro/package.json has no version');
}
