import { describe, expect, it } from 'vitest';
import { type ChildKind, childEnvironment } from './child-env.ts';

// What the parent of cms-server holds: the allowlisted names, and the tokens, git and SSH settings that must not
// reach a child. A fresh object per case, so no case can change another's input.
function parentEnv(): NodeJS.ProcessEnv {
  return {
    PATH: '/bin',
    TMPDIR: '/tmp',
    SYSTEMROOT: 'C:\\Windows',
    NODE_OPTIONS: '--max-old-space-size=4096',
    ASTRO_TELEMETRY_DISABLED: '0',
    HOME: '/home/me',
    PREVIEW_TOKEN_SECRET: 'leaked',
    PREVIEW_INTERNAL_SECRET: 'leaked',
    GITHUB_TOKEN: 'leaked',
    SSH_AUTH_SOCK: '/agent.sock',
    GIT_DIR: '/repo/.git',
    GIT_SSH_COMMAND: 'ssh -i key',
  };
}

describe('childEnvironment', () => {
  it('gives the node the search path, the temp folders and the Windows system folders, and nothing else', () => {
    expect(childEnvironment(parentEnv(), 'node')).toEqual({
      PATH: '/bin',
      TMPDIR: '/tmp',
      SYSTEMROOT: 'C:\\Windows',
    });
  });

  it('gives the build the same set, plus NODE_OPTIONS and the astro telemetry switch', () => {
    expect(childEnvironment(parentEnv(), 'build')).toEqual({
      PATH: '/bin',
      TMPDIR: '/tmp',
      SYSTEMROOT: 'C:\\Windows',
      NODE_OPTIONS: '--max-old-space-size=4096',
      ASTRO_TELEMETRY_DISABLED: '1',
    });
  });

  it.each<ChildKind>(['node', 'build'])(
    'gives a %s no token, no SSH_AUTH_SOCK, no GIT_* setting and no HOME',
    (kind) => {
      const env = childEnvironment(parentEnv(), kind);
      for (const name of [
        'PREVIEW_TOKEN_SECRET',
        'PREVIEW_INTERNAL_SECRET',
        'GITHUB_TOKEN',
        'SSH_AUTH_SOCK',
        'GIT_DIR',
        'GIT_SSH_COMMAND',
        'HOME',
      ]) {
        expect(env).not.toHaveProperty(name);
      }
    },
  );

  it.each(['PATH', 'TEMP', 'TMP', 'TMPDIR', 'SYSTEMROOT', 'WINDIR'])(
    'passes %s to both children',
    (name) => {
      expect(childEnvironment({ [name]: 'value' }, 'node')).toEqual({
        [name]: 'value',
      });
      expect(childEnvironment({ [name]: 'value' }, 'build')).toEqual({
        [name]: 'value',
        ASTRO_TELEMETRY_DISABLED: '1',
      });
    },
  );

  it('keeps an allowlisted name whatever its case, and leaves NODE_OPTIONS to the build alone', () => {
    const parent = { Path: '/bin', tmp: '/t', node_options: '--x' };
    expect(childEnvironment(parent, 'node')).toEqual({
      Path: '/bin',
      tmp: '/t',
    });
    expect(childEnvironment(parent, 'build')).toEqual({
      Path: '/bin',
      tmp: '/t',
      node_options: '--x',
      ASTRO_TELEMETRY_DISABLED: '1',
    });
  });

  it('leaves out an allowlisted name that has no value', () => {
    expect(childEnvironment({ PATH: undefined, TMP: '/t' }, 'node')).toEqual({
      TMP: '/t',
    });
    expect(childEnvironment({ NODE_OPTIONS: undefined }, 'build')).toEqual({
      ASTRO_TELEMETRY_DISABLED: '1',
    });
  });

  it('sets the telemetry switch of the build whatever the parent says, and never for the node', () => {
    expect(
      childEnvironment({ ASTRO_TELEMETRY_DISABLED: '0' }, 'build')
        .ASTRO_TELEMETRY_DISABLED,
    ).toBe('1');
    expect(
      childEnvironment({ ASTRO_TELEMETRY_DISABLED: '0' }, 'node'),
    ).not.toHaveProperty('ASTRO_TELEMETRY_DISABLED');
  });

  it('does not let a prototype key of the parent into the child', () => {
    // JSON.parse makes `__proto__` and `constructor` ordinary keys, the way a hostile config could.
    const parent: NodeJS.ProcessEnv = JSON.parse(
      '{"__proto__": "x", "constructor": "y", "PATH": "/bin"}',
    );
    const env = childEnvironment(parent, 'build');
    expect(Object.getPrototypeOf(env)).toBe(Object.prototype);
    expect(Object.keys(env)).toEqual(['PATH', 'ASTRO_TELEMETRY_DISABLED']);
  });
});
