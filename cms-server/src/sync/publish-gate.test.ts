import { describe, expect, it, vi } from 'vitest';
import { WORK_REF } from '../git/repo.ts';
import { createStatus } from '../preview/status.ts';
import { createPublishGate, type WorkTx } from './publish-gate.ts';

// The status of a test: its publish state is the only part the gate writes.
function statusOf() {
  return createStatus({
    builder: 'off',
    node: () => ({
      state: 'ready',
      port: 4401,
      bundleId: null,
      failures: 0,
      error: null,
    }),
    changedPaths: async () => [],
  });
}

// A `cms/work` whose HEAD answers `head`, one value per call (the last repeats).
function workAt(
  ...heads: string[]
): WorkTx & { revParse: ReturnType<typeof vi.fn> } {
  let calls = 0;
  return {
    revParse: vi.fn(async () => {
      const head = heads[Math.min(calls, heads.length - 1)] ?? '';
      calls += 1;
      return head;
    }),
  };
}

const REFUSAL = {
  status: 409,
  body: {
    error: 'publish-in-progress',
    message:
      'A publish is running, so nothing was saved or published by this request. Try again once it is done.',
  },
};

describe('createPublishGate: the click and the answer', () => {
  it('starts open: a save and a poll tick may run', () => {
    const gate = createPublishGate({ status: statusOf() });
    expect(gate.saveStop()).toBeUndefined();
    expect(gate.pollMayRun()).toBe(true);
  });

  it('closes on the first begin, which returns no stop, and answers 409 to a second one', () => {
    const gate = createPublishGate({ status: statusOf() });
    expect(gate.begin()).toBeUndefined();
    expect(gate.pollMayRun()).toBe(false);
    expect(gate.begin()).toStrictEqual(REFUSAL);
    expect(gate.pollMayRun()).toBe(false);
  });

  it('answers 409 to a save while closed, and leaves the publish status as it is', async () => {
    const status = statusOf();
    const gate = createPublishGate({ status });
    status.setPublish('publishing');
    gate.begin();
    expect(gate.saveStop()).toStrictEqual(REFUSAL);
    expect((await status.snapshot()).publish).toStrictEqual({
      state: 'publishing',
      error: null,
    });
  });

  it('reopens on end, so a save and a poll tick may run and a publish may begin again', () => {
    const gate = createPublishGate({ status: statusOf() });
    gate.begin();
    gate.end();
    expect(gate.saveStop()).toBeUndefined();
    expect(gate.pollMayRun()).toBe(true);
    expect(gate.begin()).toBeUndefined();
  });
});

describe('createPublishGate: a save that may run', () => {
  it('clears a sticky failed publish status, so the next save starts from idle', async () => {
    const status = statusOf();
    const gate = createPublishGate({ status });
    status.setPublish('failed', 'The remote refused the push.');
    expect(gate.saveStop()).toBeUndefined();
    expect((await status.snapshot()).publish).toStrictEqual({
      state: 'idle',
      error: null,
    });
  });
});

describe('createPublishGate: the snapshot around the push', () => {
  it('passes beforePush and afterPush while cms/work is at the base, reading its HEAD each time', async () => {
    const gate = createPublishGate({ status: statusOf() });
    const tx = workAt('base', 'base');
    await expect(gate.beforePush(tx, 'base')).resolves.toBeUndefined();
    await expect(gate.afterPush(tx, 'base')).resolves.toBeUndefined();
    expect(tx.revParse).toHaveBeenNthCalledWith(1, WORK_REF);
    expect(tx.revParse).toHaveBeenNthCalledWith(2, WORK_REF);
  });

  it('throws before the push when cms/work is not at the base', async () => {
    const gate = createPublishGate({ status: statusOf() });
    const error = await gate
      .beforePush(workAt('moved'), 'base')
      .catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      'cms/work moved from base to moved before the push, so the publish stops',
    );
  });

  it('throws after the push when cms/work is not at the base', async () => {
    const gate = createPublishGate({ status: statusOf() });
    const error = await gate
      .afterPush(workAt('moved'), 'base')
      .catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      'cms/work moved from base to moved during the push, so the publish stops',
    );
  });
});
