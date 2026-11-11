import { describe, expect, it } from 'vitest';
import { createStatus, type StatusOptions } from './status.ts';
import type { Supervisor } from './supervisor.ts';

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
      publish: 'idle',
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

  it('reads the node and the changeset on each snapshot, not once', async () => {
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
      changesetSize: 1,
    });
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
    status.setUpstreamBuildFailed('upstream does not build');
    status.setPublish('failed');
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
      publish: 'failed',
      errors: {
        protocolMismatch: 'Bundle b-1 speaks protocol 1',
        upstreamBuildFailed: 'upstream does not build',
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

  it('each setter clears its field with null, or with idle for the publish state', async () => {
    const status = createStatus(optionsOf());
    status.setBuildError('x');
    status.setFailedCommit('x');
    status.setSwapError('x');
    status.setProtocolMismatch('x');
    status.setLastSync('x');
    status.setSyncError('x');
    status.setUpstreamBuildFailed('x');
    status.setPublish('publishing');
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
      publish: 'idle',
      errors: { protocolMismatch: null, upstreamBuildFailed: null, swap: null },
    });
  });

  it('the build state can go from failed back to idle', async () => {
    const status = createStatus(optionsOf());
    status.setBuildState('failed');
    expect((await status.snapshot()).build.state).toBe('failed');
    status.setBuildState('idle');
    expect((await status.snapshot()).build.state).toBe('idle');
  });
});
