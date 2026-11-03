import { describe, expect, it, vi } from 'vitest';
import { type Clock, createMutex, LockTimeoutError } from './mutex.ts';

// A timer the test fires by hand. `cleared` records a `clearTimeout` on it.
interface FakeTimer {
  callback: () => void;
  ms: number;
  cleared: boolean;
}

// A clock whose timers fire only when the test calls them. Each handle is the timer itself.
function fakeClock(): { clock: Clock; timers: FakeTimer[] } {
  const timers: FakeTimer[] = [];
  const clock: Clock = {
    setTimeout: (callback, ms) => {
      const timer: FakeTimer = { callback, ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (handle) => {
      (handle as FakeTimer).cleared = true;
    },
  };
  return { clock, timers };
}

// A promise the test resolves by hand, to hold a lock for as long as it needs.
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('createMutex', () => {
  it('runs a task on a free lock and returns its value', async () => {
    const mutex = createMutex();
    await expect(mutex.run('save', async () => 42)).resolves.toBe(42);
  });

  it('lets one holder in at a time, and the rest in arrival order', async () => {
    const mutex = createMutex({ clock: fakeClock().clock });
    const order: string[] = [];
    const gate = deferred();
    const first = mutex.run('first', async () => {
      order.push('first starts');
      await gate.promise;
      order.push('first ends');
    });
    const second = mutex.run('second', async () => {
      order.push('second');
    });
    const third = mutex.run('third', async () => {
      order.push('third');
    });
    gate.resolve();
    await Promise.all([first, second, third]);
    expect(order).toEqual(['first starts', 'first ends', 'second', 'third']);
  });

  it('gives up a waiter after the default 30 s, and the error names the holder', async () => {
    const { clock, timers } = fakeClock();
    const mutex = createMutex({ clock });
    const gate = deferred();
    const holding = mutex.run('save', async () => {
      await gate.promise;
      return 'held';
    });
    const waiting = mutex.run('sync', async () => 'never');
    expect(timers.map((timer) => timer.ms)).toEqual([30_000]);
    timers[0]?.callback();
    await expect(waiting).rejects.toMatchObject({
      name: 'LockTimeoutError',
      holder: 'save',
      message:
        'Timed out after 30000 ms waiting for the repo lock, which save holds.',
    });
    gate.resolve();
    // The holder is not interrupted by the waiter's timeout.
    await expect(holding).resolves.toBe('held');
  });

  it('uses the timeout it was given', async () => {
    const { clock, timers } = fakeClock();
    const mutex = createMutex({ clock, timeoutMs: 1_500 });
    const gate = deferred();
    const holding = mutex.run('publish', () => gate.promise);
    const waiting = mutex.run('save', async () => undefined);
    expect(timers.map((timer) => timer.ms)).toEqual([1_500]);
    gate.resolve();
    await holding;
    await waiting;
  });

  it('a waiter that timed out leaves the line, so the next waiter gets the lock', async () => {
    const { clock, timers } = fakeClock();
    const mutex = createMutex({ clock });
    const order: string[] = [];
    const gate = deferred();
    const holding = mutex.run('first', async () => {
      await gate.promise;
      order.push('first');
    });
    const gone = mutex.run('second', async () => {
      order.push('second');
    });
    const next = mutex.run('third', async () => {
      order.push('third');
    });
    timers[0]?.callback();
    await expect(gone).rejects.toMatchObject({
      name: 'LockTimeoutError',
      holder: 'first',
      message:
        'Timed out after 30000 ms waiting for the repo lock, which first holds.',
    });
    gate.resolve();
    await Promise.all([holding, next]);
    expect(order).toEqual(['first', 'third']);
  });

  it('clears the timer of a waiter that gets the lock', async () => {
    const { clock, timers } = fakeClock();
    const mutex = createMutex({ clock });
    const gate = deferred();
    const holding = mutex.run('first', () => gate.promise);
    const waiting = mutex.run('second', async () => 'got it');
    gate.resolve();
    await holding;
    await expect(waiting).resolves.toBe('got it');
    expect(timers.map((timer) => timer.cleared)).toEqual([true]);
  });

  it('releases the lock when the task throws', async () => {
    const mutex = createMutex({ clock: fakeClock().clock });
    const failing = mutex.run('save', async () => {
      throw new Error('boom');
    });
    const after = mutex.run('sync', async () => 'next ran');
    await expect(failing).rejects.toThrow(new Error('boom'));
    await expect(after).resolves.toBe('next ran');
  });

  it('releases the lock when the task throws before its first await', async () => {
    const mutex = createMutex({ clock: fakeClock().clock });
    const failing = mutex.run('save', () => {
      throw new Error('sync boom');
    });
    await expect(failing).rejects.toThrow(new Error('sync boom'));
    await expect(mutex.run('sync', async () => 'free')).resolves.toBe('free');
  });

  it('with the real clock, a waiter times out after the given milliseconds', async () => {
    const mutex = createMutex({ timeoutMs: 20 });
    const gate = deferred();
    const holding = mutex.run('save', () => gate.promise);
    const waiting = mutex.run('sync', async () => 'never');
    const outcome = await waiting.catch((error: unknown) => error);
    expect(outcome).toBeInstanceOf(LockTimeoutError);
    expect(outcome).toMatchObject({
      holder: 'save',
      message:
        'Timed out after 20 ms waiting for the repo lock, which save holds.',
    });
    gate.resolve();
    await holding;
  });

  it('the real clock is used when no clock is given', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const mutex = createMutex({ timeoutMs: 5 });
    const gate = deferred();
    const holding = mutex.run('save', () => gate.promise);
    const waiting = mutex.run('sync', async () => 'never');
    await expect(waiting).rejects.toThrow(LockTimeoutError);
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 5);
    gate.resolve();
    await holding;
    setTimeoutSpy.mockRestore();
  });
});
