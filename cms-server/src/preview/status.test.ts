import { describe, expect, it, vi } from 'vitest';
import { createStatus, type StatusOptions } from './status.ts';
import type { Supervisor } from './supervisor.ts';

/** An upstream build failure: the origin commit that does not build, and its first error (2.10f). */
const UPSTREAM = { sha: 'a'.repeat(40), firstError: 'src/a.astro: boom' };

/** A node that is ready on `b-1`, with no error. */
const READY: ReturnType<Supervisor['status']> = {
  state: 'ready',
  port: 4401,
  bundleId: 'b-1',
  failures: 0,
  error: null,
};

/** The options of a holder: a builder that is on, a ready node, and a changeset of two paths. */
function optionsOf(overrides: Partial<StatusOptions> = {}): StatusOptions {
  return {
    builder: 'on',
    node: () => READY,
    changedPaths: () => Promise.resolve([{ path: 'a.md' }, { path: 'b.md' }]),
    ...overrides,
  };
}

describe('the status snapshot', () => {
  it('a builder that is on starts idle, with nothing set, and reads the node and the changeset', async () => {
    const status = createStatus(optionsOf());
    expect(await status.snapshot()).toStrictEqual({
      builder: 'on',
      build: { state: 'idle', error: null, failedCommit: null },
      node: { state: 'ready', bundleId: 'b-1', error: null },
      lastSync: null,
      syncError: null,
      renamed: [],
      changesetSize: 2,
      publish: { state: 'idle', error: null },
      errors: { protocolMismatch: null, upstreamBuildFailed: null, swap: null },
    });
  });

  it('with the builder off, its state is off', async () => {
    const status = createStatus(optionsOf({ builder: 'off' }));
    expect(await status.snapshot()).toMatchObject({
      builder: 'off',
      build: { state: 'off', error: null },
    });
  });

  it('a changeset that git cannot count is null, not an error', async () => {
    const status = createStatus(
      optionsOf({
        changedPaths: () => Promise.reject(new Error('git failed')),
      }),
    );
    expect((await status.snapshot()).changesetSize).toBeNull();
  });

  it('reads the node on each snapshot, and the changeset only after an event (2.12d-3)', async () => {
    let node: ReturnType<Supervisor['status']> = READY;
    let paths: { path: string }[] = [];
    const status = createStatus(
      optionsOf({
        node: () => node,
        changedPaths: () => Promise.resolve(paths),
      }),
    );
    expect((await status.snapshot()).changesetSize).toBe(0);
    node = { ...READY, state: 'restarting', bundleId: null };
    paths = [{ path: 'c.md' }];
    expect(await status.snapshot()).toMatchObject({
      node: { state: 'restarting', bundleId: null, error: null },
      changesetSize: 0,
    });
    status.invalidateChangeset();
    expect((await status.snapshot()).changesetSize).toBe(1);
  });
});

describe('the changeset size, counted once until an event (2.12d-3)', () => {
  it('repeated reads with no event in between run changedPaths once', async () => {
    const changedPaths = vi.fn(() =>
      Promise.resolve([{ path: 'a.md' }, { path: 'b.md' }]),
    );
    const status = createStatus(optionsOf({ changedPaths }));
    expect((await status.snapshot()).changesetSize).toBe(2);
    expect((await status.snapshot()).changesetSize).toBe(2);
    expect((await status.snapshot()).changesetSize).toBe(2);
    expect(changedPaths).toHaveBeenCalledTimes(1);
  });

  it('after invalidateChangeset, the next read counts again, and the one after that does not', async () => {
    let paths: { path: string }[] = [{ path: 'a.md' }];
    const changedPaths = vi.fn(() => Promise.resolve(paths));
    const status = createStatus(optionsOf({ changedPaths }));
    expect((await status.snapshot()).changesetSize).toBe(1);
    paths = [{ path: 'a.md' }, { path: 'b.md' }];
    expect((await status.snapshot()).changesetSize).toBe(1);
    status.invalidateChangeset();
    expect((await status.snapshot()).changesetSize).toBe(2);
    expect((await status.snapshot()).changesetSize).toBe(2);
    expect(changedPaths).toHaveBeenCalledTimes(2);
  });

  it('a count still in flight when the event comes does not answer the reads after it', async () => {
    let calls = 0;
    let resolveFirst: (paths: readonly unknown[]) => void = () => undefined;
    const status = createStatus(
      optionsOf({
        changedPaths: () => {
          calls += 1;
          if (calls === 1)
            return new Promise<readonly unknown[]>((resolve) => {
              resolveFirst = resolve;
            });
          return Promise.resolve([{ path: 'a.md' }, { path: 'b.md' }]);
        },
      }),
    );
    const stale = status.snapshot();
    status.invalidateChangeset();
    expect((await status.snapshot()).changesetSize).toBe(2);
    resolveFirst([{ path: 'a.md' }]);
    expect((await stale).changesetSize).toBe(1);
    expect((await status.snapshot()).changesetSize).toBe(2);
    expect(calls).toBe(2);
  });

  it('a count that git fails on is null for that read, and the next read counts again', async () => {
    let calls = 0;
    let fail = true;
    const status = createStatus(
      optionsOf({
        changedPaths: () => {
          calls += 1;
          return fail
            ? Promise.reject(new Error('git failed'))
            : Promise.resolve([{ path: 'a.md' }]);
        },
      }),
    );
    expect((await status.snapshot()).changesetSize).toBeNull();
    fail = false;
    expect((await status.snapshot()).changesetSize).toBe(1);
    expect((await status.snapshot()).changesetSize).toBe(1);
    expect(calls).toBe(2);
  });
});

describe('the setters', () => {
  it('each setter shows in the next snapshot', async () => {
    const status = createStatus(optionsOf());
    status.setBuildState('building');
    status.setBuildError('src/a.md: bad');
    status.setFailedCommit('d'.repeat(40));
    status.setSwapError('node down');
    status.setProtocolMismatch('Bundle b-1 speaks protocol 1');
    status.setLastSync('2026-11-09T10:00:00.000Z');
    status.setSyncError('fetch failed');
    status.setUpstreamBuildFailed(UPSTREAM);
    status.setPublish('failed', 'The remote refused the push');
    expect(await status.snapshot()).toStrictEqual({
      builder: 'on',
      build: {
        state: 'building',
        error: 'src/a.md: bad',
        failedCommit: 'd'.repeat(40),
      },
      node: { state: 'ready', bundleId: 'b-1', error: null },
      lastSync: '2026-11-09T10:00:00.000Z',
      syncError: 'fetch failed',
      renamed: [],
      changesetSize: 2,
      publish: { state: 'failed', error: 'The remote refused the push' },
      errors: {
        protocolMismatch: 'Bundle b-1 speaks protocol 1',
        upstreamBuildFailed: UPSTREAM,
        swap: 'node down',
      },
    });
  });

  it('setRenamed shows the renamed documents in the next snapshot, and an empty list clears them', async () => {
    const status = createStatus(optionsOf());
    const renamed = [
      {
        key: 'blog/a',
        from: 'src/content/blog/a.md',
        to: 'src/content/blog/b.md',
      },
    ];
    status.setRenamed(renamed);
    expect((await status.snapshot()).renamed).toStrictEqual(renamed);
    status.setRenamed([]);
    expect((await status.snapshot()).renamed).toStrictEqual([]);
  });

  it('each setter clears its field with null, or with idle and no error for the publish state', async () => {
    const status = createStatus(optionsOf());
    status.setBuildError('x');
    status.setFailedCommit('x');
    status.setSwapError('x');
    status.setProtocolMismatch('x');
    status.setLastSync('x');
    status.setSyncError('x');
    status.setUpstreamBuildFailed(UPSTREAM);
    status.setPublish('failed', 'x');
    status.setBuildError(null);
    status.setFailedCommit(null);
    status.setSwapError(null);
    status.setProtocolMismatch(null);
    status.setLastSync(null);
    status.setSyncError(null);
    status.setUpstreamBuildFailed(null);
    status.setPublish('idle');
    expect(await status.snapshot()).toMatchObject({
      build: { error: null, failedCommit: null },
      lastSync: null,
      syncError: null,
      publish: { state: 'idle', error: null },
      errors: { protocolMismatch: null, upstreamBuildFailed: null, swap: null },
    });
  });

  it('publishing carries no error, and a failed publish keeps the one it was given', async () => {
    const status = createStatus(optionsOf());
    status.setPublish('publishing');
    expect((await status.snapshot()).publish).toStrictEqual({
      state: 'publishing',
      error: null,
    });
    status.setPublish('failed', 'The remote refused the push');
    expect((await status.snapshot()).publish).toStrictEqual({
      state: 'failed',
      error: 'The remote refused the push',
    });
    status.setPublish('publishing');
    expect((await status.snapshot()).publish).toStrictEqual({
      state: 'publishing',
      error: null,
    });
  });

  it('getRenamed answers what setRenamed was given, and nothing before', () => {
    const status = createStatus(optionsOf());
    expect(status.getRenamed()).toStrictEqual([]);
    const renamed = [{ key: 'blog/a', from: 'a.md', to: 'b.md' }];
    status.setRenamed(renamed);
    expect(status.getRenamed()).toStrictEqual(renamed);
  });

  it('the upstream build failure is the commit and its first error, and getUpstreamBuildFailed answers it (2.10f)', async () => {
    const status = createStatus(optionsOf());
    expect(status.getUpstreamBuildFailed()).toBe(null);
    status.setUpstreamBuildFailed(UPSTREAM);
    expect(status.getUpstreamBuildFailed()).toStrictEqual(UPSTREAM);
    expect((await status.snapshot()).errors.upstreamBuildFailed).toStrictEqual(
      UPSTREAM,
    );
    status.setUpstreamBuildFailed(null);
    expect(status.getUpstreamBuildFailed()).toBe(null);
  });

  it('the build state can go from failed back to idle', async () => {
    const status = createStatus(optionsOf());
    status.setBuildState('failed');
    expect((await status.snapshot()).build.state).toBe('failed');
    status.setBuildState('idle');
    expect((await status.snapshot()).build.state).toBe('idle');
  });
});
