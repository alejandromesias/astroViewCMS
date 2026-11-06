import { describe, expect, it } from 'vitest';
import {
  type BuildFn,
  type BuildJob,
  type BuildResult,
  createBuildRunner,
} from './build-runner.ts';

const FIRST: BuildJob = { commit: 'c1', bundleId: 'b1' };
const SECOND: BuildJob = { commit: 'c2', bundleId: 'b2' };
const NEWEST: BuildJob = { commit: 'c3', bundleId: 'b2' };

// The result a build of `job` gives in these tests.
function resultOf(job: BuildJob, ok = true): BuildResult {
  return {
    bundleId: job.bundleId,
    dir: `/bundles/${job.bundleId}`,
    ok,
    firstError: ok
      ? null
      : {
          file: 'src/pages/broken.astro',
          message: 'CompilerError: Unexpected token',
        },
  };
}

// Bundle ids b1, b2, ... in the order the runner asks for them.
function sequence(): () => string {
  let count = 0;
  return () => {
    count += 1;
    return `b${count}`;
  };
}

// Builds that wait until the test finishes them. `started` lists the jobs in the order they began.
// `peak` is the most builds that ran at the same time.
function heldBuilds() {
  const started: BuildJob[] = [];
  const holds: PromiseWithResolvers<BuildResult>[] = [];
  let active = 0;
  let peak = 0;
  const build: BuildFn = (job) => {
    started.push(job);
    active += 1;
    peak = Math.max(peak, active);
    const hold = Promise.withResolvers<BuildResult>();
    holds.push(hold);
    return hold.promise.finally(() => {
      active -= 1;
    });
  };
  return { build, started, holds, peak: () => peak };
}

describe('createBuildRunner', () => {
  it('resolves a request with the result of its build', async () => {
    const runner = createBuildRunner({
      build: async (job) => resultOf(job),
      newBundleId: sequence(),
    });
    expect(await runner.request('c1')).toEqual(resultOf(FIRST));
  });

  it('passes a failed build through unchanged', async () => {
    const runner = createBuildRunner({
      build: async (job) => resultOf(job, false),
      newBundleId: sequence(),
    });
    expect(await runner.request('c1')).toEqual({
      bundleId: 'b1',
      dir: '/bundles/b1',
      ok: false,
      firstError: {
        file: 'src/pages/broken.astro',
        message: 'CompilerError: Unexpected token',
      },
    });
  });

  it('gives each build a random UUID unless told otherwise', async () => {
    const jobs: BuildJob[] = [];
    const runner = createBuildRunner({
      build: async (job) => {
        jobs.push(job);
        return resultOf(job);
      },
    });
    await runner.request('c1');
    expect(jobs[0]?.bundleId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('runs one build at a time, and the next request waits for the running one', async () => {
    const held = heldBuilds();
    const runner = createBuildRunner({
      build: held.build,
      newBundleId: sequence(),
    });
    const first = runner.request('c1');
    const second = runner.request('c2');
    expect(held.started).toEqual([FIRST]);
    held.holds[0]?.resolve(resultOf(FIRST));
    expect(await first).toEqual(resultOf(FIRST));
    expect(held.started).toEqual([FIRST, SECOND]);
    held.holds[1]?.resolve(resultOf(SECOND));
    expect(await second).toEqual(resultOf(SECOND));
    expect(held.peak()).toBe(1);
  });

  it('merges the requests made during a build into one queued build for the newest commit', async () => {
    const held = heldBuilds();
    const runner = createBuildRunner({
      build: held.build,
      newBundleId: sequence(),
    });
    const first = runner.request('c1');
    const second = runner.request('c2');
    const third = runner.request('c3');
    expect(third).toBe(second);
    held.holds[0]?.resolve(resultOf(FIRST));
    await first;
    expect(held.started).toEqual([FIRST, NEWEST]);
    held.holds[1]?.resolve(resultOf(NEWEST));
    expect(await second).toEqual(resultOf(NEWEST));
    expect(await third).toEqual(resultOf(NEWEST));
  });

  it('rejects the callers of a build that throws, and runs the queued build after it', async () => {
    const held = heldBuilds();
    const runner = createBuildRunner({
      build: held.build,
      newBundleId: sequence(),
    });
    const first = runner.request('c1');
    const second = runner.request('c2');
    const failure = new Error('disk full');
    held.holds[0]?.reject(failure);
    await expect(first).rejects.toBe(failure);
    held.holds[1]?.resolve(resultOf(SECOND));
    expect(await second).toEqual(resultOf(SECOND));
  });

  it('starts a new build for a request made after the queue has drained', async () => {
    const held = heldBuilds();
    const runner = createBuildRunner({
      build: held.build,
      newBundleId: sequence(),
    });
    const first = runner.request('c1');
    held.holds[0]?.resolve(resultOf(FIRST));
    await first;
    const second = runner.request('c2');
    expect(held.started).toEqual([FIRST, SECOND]);
    held.holds[1]?.resolve(resultOf(SECOND));
    await second;
  });
});
