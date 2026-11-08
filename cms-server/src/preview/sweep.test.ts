import { existsSync } from 'node:fs';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTestRoot, removeTestRoot } from '../../test/helpers/git.ts';
import type { Logger } from '../log.ts';
import type { WorktreeLock } from './build-commit.ts';
import { sweepLeftovers } from './sweep.ts';

const SITE = 'demo';

interface LogCall {
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
  readonly fields:
    | Record<string, string | number | boolean | string[]>
    | undefined;
}

let root: string;
let cmsDir: string;
let siteRoot: string;
let events: string[];
let logged: LogCall[];

beforeEach(async () => {
  root = await makeTestRoot();
  cmsDir = path.join(root, '.cms');
  siteRoot = path.join(cmsDir, SITE);
  events = [];
  logged = [];
});

afterEach(async () => {
  await removeTestRoot(root);
});

// Writes a file at `parts` under the site folder, with the folders above it.
async function makeFile(
  parts: readonly string[],
  content = 'leftover\n',
): Promise<void> {
  const file = path.join(siteRoot, ...parts);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

// The repo lock of the tests. Every lock and removal is recorded in `events`; `remove` does the removal.
function fakeRepo(remove: (name: string) => Promise<void>): WorktreeLock {
  return {
    async locked(holder, work) {
      events.push(`lock ${holder}`);
      return work({
        async worktreeAdd() {
          throw new Error('the sweep adds no worktree');
        },
        async worktreeRemove(name) {
          events.push(`remove ${name}`);
          await remove(name);
        },
      });
    },
  };
}

// What git does when it removes a worktree: the folder goes.
const gitRemoves = (name: string) =>
  rm(path.join(siteRoot, 'worktrees', name), { recursive: true, force: true });

function recordingLog(): Logger {
  const record =
    (level: LogCall['level']) =>
    (message: string, fields?: LogCall['fields']) => {
      logged.push({ level, message, fields });
    };
  return { info: record('info'), warn: record('warn'), error: record('error') };
}

describe('sweepLeftovers', () => {
  it('removes a leftover build worktree through git, under the lock, when git can', async () => {
    await makeFile(['worktrees', 'build-old', 'file.txt']);
    const result = await sweepLeftovers({
      repo: fakeRepo(gitRemoves),
      cmsDir,
      site: SITE,
      log: recordingLog(),
    });
    expect(result).toEqual({ worktrees: ['build-old'], bundles: [], temp: [] });
    expect(existsSync(path.join(siteRoot, 'worktrees', 'build-old'))).toBe(
      false,
    );
    expect(events).toEqual(['lock sweep build-old', 'remove build-old']);
  });

  it('deletes the folder of a leftover build worktree that git cannot remove, and logs why', async () => {
    await makeFile(['worktrees', 'build-crashed', 'file.txt']);
    const log = recordingLog();
    const result = await sweepLeftovers({
      repo: fakeRepo(async () => {
        throw new Error('not a working tree');
      }),
      cmsDir,
      site: SITE,
      log,
    });
    expect(result).toEqual({
      worktrees: ['build-crashed'],
      bundles: [],
      temp: [],
    });
    expect(existsSync(path.join(siteRoot, 'worktrees', 'build-crashed'))).toBe(
      false,
    );
    expect(logged).toEqual([
      {
        level: 'warn',
        message:
          'Git could not remove a leftover build worktree; its folder is deleted',
        fields: { worktree: 'build-crashed', error: 'not a working tree' },
      },
    ]);
  });

  it('leaves the other folders of the worktrees folder alone, and takes the build folders in name order', async () => {
    await makeFile(['worktrees', 'keep-me', 'file.txt']);
    await makeFile(['worktrees', 'buildx', 'file.txt']);
    await makeFile(['worktrees', 'build-x', 'file.txt']);
    await makeFile(['worktrees', 'build-a', 'file.txt']);
    const result = await sweepLeftovers({
      repo: fakeRepo(gitRemoves),
      cmsDir,
      site: SITE,
      log: recordingLog(),
    });
    expect(result.worktrees).toEqual(['build-a', 'build-x']);
    expect(existsSync(path.join(siteRoot, 'worktrees', 'keep-me'))).toBe(true);
    expect(existsSync(path.join(siteRoot, 'worktrees', 'buildx'))).toBe(true);
    expect(events).toEqual([
      'lock sweep build-a',
      'remove build-a',
      'lock sweep build-x',
      'remove build-x',
    ]);
  });

  it('uses the real folder delete and logger when none is given', async () => {
    await makeFile(['worktrees', 'build-plain', 'file.txt']);
    const write = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    try {
      const result = await sweepLeftovers({
        repo: fakeRepo(async () => {
          throw new Error('not a working tree');
        }),
        cmsDir,
        site: SITE,
      });
      expect(result.worktrees).toEqual(['build-plain']);
      expect(existsSync(path.join(siteRoot, 'worktrees', 'build-plain'))).toBe(
        false,
      );
      expect(JSON.parse(String(write.mock.calls[0]?.[0]))).toMatchObject({
        level: 'warn',
        message:
          'Git could not remove a leftover build worktree; its folder is deleted',
        worktree: 'build-plain',
        error: 'not a working tree',
      });
    } finally {
      write.mockRestore();
    }
  });

  it('logs a leftover that cannot be deleted, leaves it out of the result, and goes on with the rest', async () => {
    await makeFile(['worktrees', 'build-a', 'file.txt']);
    await makeFile(['worktrees', 'build-stuck', 'file.txt']);
    const log = recordingLog();
    const result = await sweepLeftovers({
      // Git refuses both; the Node delete then refuses build-stuck only.
      repo: fakeRepo(async () => {
        throw new Error('locked by another process');
      }),
      cmsDir,
      site: SITE,
      log,
      deleteFolder: async (folder) => {
        if (folder.endsWith('build-stuck')) throw new Error('access denied');
        await rm(folder, { recursive: true, force: true });
      },
    });
    expect(result.worktrees).toEqual(['build-a']);
    expect(logged.map((call) => call.message)).toEqual([
      'Git could not remove a leftover build worktree; its folder is deleted',
      'Git could not remove a leftover build worktree; its folder is deleted',
      'Could not delete a leftover entry',
    ]);
    expect(logged[2]).toEqual({
      level: 'warn',
      message: 'Could not delete a leftover entry',
      fields: { entry: 'build-stuck', error: 'access denied' },
    });
  });

  it('removes the bundle folders with no bundle.json and the temporary index files, and keeps the complete bundles', async () => {
    await makeFile(['bundles', 'partial', 'manifest', 'half.json']);
    await makeFile(['bundles', 'done', 'manifest', 'bundle.json'], '{}\n');
    await makeFile(['tmp', 'index-1']);
    await makeFile(['tmp', 'leftover-dir', 'index-2']);
    await makeFile(['tmp', 'zz-index']);
    const result = await sweepLeftovers({
      repo: fakeRepo(gitRemoves),
      cmsDir,
      site: SITE,
      log: recordingLog(),
    });
    expect(result).toEqual({
      worktrees: [],
      bundles: ['partial'],
      temp: ['index-1', 'leftover-dir', 'zz-index'],
    });
    expect(await readdir(path.join(siteRoot, 'bundles'))).toEqual(['done']);
    expect(await readdir(path.join(siteRoot, 'tmp'))).toEqual([]);
  });

  it('does nothing on a first start, when the .cms folder does not exist yet', async () => {
    const result = await sweepLeftovers({
      repo: fakeRepo(gitRemoves),
      cmsDir: path.join(root, 'not-yet'),
      site: SITE,
      log: recordingLog(),
    });
    expect(result).toEqual({ worktrees: [], bundles: [], temp: [] });
    expect(events).toEqual([]);
    expect(logged).toEqual([]);
  });

  it('fails when the worktrees path is a file, not a folder', async () => {
    await mkdir(siteRoot, { recursive: true });
    await writeFile(path.join(siteRoot, 'worktrees'), 'not a folder');
    await expect(
      sweepLeftovers({
        repo: fakeRepo(gitRemoves),
        cmsDir,
        site: SITE,
        log: recordingLog(),
      }),
    ).rejects.toMatchObject({ code: 'ENOTDIR' });
  });
});
