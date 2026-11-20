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

describe('candidate (2.10m)', () => {
  it('runs the candidate function under a new bundle id, and resolves with its result', async () => {
    const jobs: BuildJob[] = [];
    const runner = createBuildRunner({
      build: async () => {
        throw new Error('the request function must not run');
      },
      buildCandidate: async (job) => {
        jobs.push(job);
        return resultOf(job);
      },
      newBundleId: sequence(),
    });
    expect(await runner.candidate('c1')).toEqual(resultOf(FIRST));
    expect(jobs).toEqual([FIRST]);
  });

  it('runs the request function when no candidate function is given', async () => {
    const runner = createBuildRunner({
      build: async (job) => resultOf(job),
      newBundleId: sequence(),
    });
    expect(await runner.candidate('c1')).toEqual(resultOf(FIRST));
  });

  it('waits for the running build and the builds queued before it, and runs after them', async () => {
    const held = heldBuilds();
    const order: string[] = [];
    const runner = createBuildRunner({
      build: (job) => {
        order.push(`build ${job.commit}`);
        return held.build(job);
      },
      buildCandidate: async (job) => {
        order.push(`candidate ${job.commit}`);
        return resultOf(job);
      },
      newBundleId: sequence(),
    });
    const first = runner.request('c1');
    const queued = runner.request('c2');
    const candidate = runner.candidate('c3');
    expect(order).toEqual(['build c1']);
    held.holds[0]?.resolve(resultOf(FIRST));
    await first;
    expect(order).toEqual(['build c1', 'build c2']);
    held.holds[1]?.resolve(resultOf(SECOND));
    await queued;
    expect(await candidate).toEqual(resultOf({ commit: 'c3', bundleId: 'b3' }));
    expect(order).toEqual(['build c1', 'build c2', 'candidate c3']);
  });

  it('does not merge a request made during the candidate into it: the request queues behind it', async () => {
    const release = Promise.withResolvers<void>();
    const order: string[] = [];
    const runner = createBuildRunner({
      build: async (job) => {
        order.push(`build ${job.commit}`);
        return resultOf(job);
      },
      buildCandidate: async (job) => {
        order.push(`candidate ${job.commit}`);
        await release.promise;
        return resultOf(job);
      },
      newBundleId: sequence(),
    });
    const candidate = runner.candidate('c1');
    const after = runner.request('c2');
    const later = runner.request('c3');
    expect(later).toBe(after);
    release.resolve();
    expect(await candidate).toEqual(resultOf(FIRST));
    expect(await after).toEqual(resultOf({ commit: 'c3', bundleId: 'b2' }));
    expect(order).toEqual(['candidate c1', 'build c3']);
  });

  it('rejects the caller of a candidate whose build throws, and the request after it still runs', async () => {
    const held = heldBuilds();
    const failure = new Error('disk full');
    const runner = createBuildRunner({
      build: held.build,
      buildCandidate: () => Promise.reject(failure),
      newBundleId: sequence(),
    });
    const candidate = runner.candidate('c1');
    await expect(candidate).rejects.toBe(failure);
    const after = runner.request('c2');
    expect(held.started).toEqual([SECOND]);
    held.holds[0]?.resolve(resultOf(SECOND));
    expect(await after).toEqual(resultOf(SECOND));
  });
});
