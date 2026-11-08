// The one allowlist of the environment that cms-server gives its child processes (WORKPLAN 2.9a and 2.9c,
// PHASE-2-DESIGN 4.4 and 5.6). The supervisor starts the preview node with it and the build runner starts each
// build with it. Nothing else of cms-server reaches a child: no tokens, no SSH_AUTH_SOCK, no GIT_* settings.

/** Which child the environment is for. A build adds `NODE_OPTIONS` and the astro telemetry switch; the node gets neither. */
export type ChildKind = 'node' | 'build';

// The variables every child may inherit: the search path, the temp folders and, on Windows, the system folders.
// Matched without case, as Windows names are.
const INHERITED = new Set([
  'PATH',
  'TEMP',
  'TMP',
  'TMPDIR',
  'SYSTEMROOT',
  'WINDIR',
]);
// The variables only a build inherits, on top of INHERITED.
const BUILD_INHERITED = new Set(['NODE_OPTIONS']);

/**
 * The environment of a child of `kind`: the allowlisted variables of `parent` that have a value, and for a build
 * `ASTRO_TELEMETRY_DISABLED=1`, whatever the parent says. No other variable passes.
 */
export function childEnvironment(
  parent: NodeJS.ProcessEnv,
  kind: ChildKind,
): NodeJS.ProcessEnv {
  const allowed =
    kind === 'build' ? new Set([...INHERITED, ...BUILD_INHERITED]) : INHERITED;
  const inherited = Object.fromEntries(
    Object.entries(parent).filter(
      ([name, value]) => value !== undefined && allowed.has(name.toUpperCase()),
    ),
  );
  return kind === 'build'
    ? { ...inherited, ASTRO_TELEMETRY_DISABLED: '1' }
    : inherited;
}
