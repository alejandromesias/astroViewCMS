// The start-up check of the site's packages (WORKPLAN 2.9c, PHASE-2-DESIGN section 3). A clone's build resolves astro
// from the clone's site folder, upward through the node_modules folders. The workspace has the packages, so a clone
// inside the workspace builds. A clone outside it finds none, and the build would fail later and less clearly. So
// the check fails at start-up, and its message names the folder and the rule. The run calls it (2.9c-B).
import { createRequire } from 'node:module';
import path from 'node:path';

/** The code of the error for a site folder that does not resolve astro. */
const DEPENDENCIES_MISSING = 'dependencies-missing';

// The rule the user is told to follow. The message repeats it, so the fix is in the error itself.
const RULE =
  'Rule: keep the config inside the workspace, so the site resolves its packages from the workspace node_modules.';

/** Thrown when astro does not resolve from a site folder. `code` is `dependencies-missing`. */
export class DependenciesMissingError extends Error {
  readonly code = DEPENDENCIES_MISSING;

  /** The error names the folder that does not resolve astro, and the rule to keep the config inside the workspace. */
  constructor(siteFolder: string) {
    super(
      `${DEPENDENCIES_MISSING}: astro cannot be resolved from ${siteFolder}. ${RULE}`,
    );
    this.name = 'DependenciesMissingError';
  }
}

/**
 * Resolves astro from `siteFolder`, the way the build does (from the `package.json` of the folder, upward), and
 * returns the path of astro's entry. Throws `DependenciesMissingError` when it does not resolve.
 */
export function checkAstroResolves(siteFolder: string): string {
  const folder = path.resolve(siteFolder);
  try {
    return createRequire(path.join(folder, 'package.json')).resolve('astro');
  } catch {
    throw new DependenciesMissingError(folder);
  }
}
