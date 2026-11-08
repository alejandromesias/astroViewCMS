import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeTestRoot, removeTestRoot } from '../../test/helpers/git.ts';
import {
  checkAstroResolves,
  DependenciesMissingError,
} from './dependencies.ts';

// The workspace root, two folders above cms-server: its node_modules hold the packages of every site inside it.
const WORKSPACE = path.resolve(import.meta.dirname, '../../..');

// The error that `run` throws, or undefined when it returns.
function errorOf(run: () => unknown): unknown {
  try {
    run();
  } catch (error: unknown) {
    return error;
  }
  return undefined;
}

describe('checkAstroResolves', () => {
  it('passes a site folder inside the workspace, and resolves astro to the workspace copy', async () => {
    const root = await makeTestRoot();
    const site = path.join(root, 'site');
    await mkdir(site);
    await writeFile(path.join(site, 'package.json'), '{}\n');
    const expected = createRequire(
      path.join(WORKSPACE, 'package.json'),
    ).resolve('astro');
    expect(checkAstroResolves(site)).toBe(expected);
    await removeTestRoot(root);
  });

  it('refuses a site folder outside the workspace, and names the folder and the rule', async () => {
    const outside = await mkdtemp(path.join(tmpdir(), 'deps-'));
    try {
      const error = errorOf(() => checkAstroResolves(outside));
      expect(error).toBeInstanceOf(DependenciesMissingError);
      expect(error).toMatchObject({
        name: 'DependenciesMissingError',
        code: 'dependencies-missing',
        message: `dependencies-missing: astro cannot be resolved from ${outside}. Rule: keep the config inside the workspace, so the site resolves its packages from the workspace node_modules.`,
      });
    } finally {
      await removeTestRoot(outside);
    }
  });

  it('names the folder by its absolute path, when it is given a relative one', async () => {
    const outside = await mkdtemp(path.join(tmpdir(), 'deps-'));
    try {
      const error = errorOf(() =>
        checkAstroResolves(path.relative(process.cwd(), outside)),
      );
      expect(error).toMatchObject({
        message: `dependencies-missing: astro cannot be resolved from ${outside}. Rule: keep the config inside the workspace, so the site resolves its packages from the workspace node_modules.`,
      });
    } finally {
      await removeTestRoot(outside);
    }
  });
});
