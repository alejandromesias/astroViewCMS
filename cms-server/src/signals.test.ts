import { describe, expect, it, vi } from 'vitest';
import { type SignalSource, wireSignals } from './signals.ts';

/** A signal source that keeps its listeners, so a test can fire a signal. */
function fakeSource(): SignalSource & {
  fire(signal: 'SIGINT' | 'SIGTERM'): void;
  events(): string[];
} {
  const listeners = new Map<string, () => void>();
  return {
    on(signal, listener) {
      listeners.set(signal, listener);
      return this;
    },
    fire(signal) {
      listeners.get(signal)?.();
    },
    events() {
      return [...listeners.keys()].sort();
    },
  };
}

/** Waits until the promises of the last signal have settled. */
function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('wireSignals', () => {
  it('listens for SIGINT and SIGTERM and does nothing before a signal', () => {
    const source = fakeSource();
    const stop = vi.fn(() => Promise.resolve());
    const exit = vi.fn();
    wireSignals({ stop, exit, source });
    expect(source.events()).toEqual(['SIGINT', 'SIGTERM']);
    expect(stop).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it('stops once on SIGINT, then exits with 0', async () => {
    const source = fakeSource();
    const stop = vi.fn(() => Promise.resolve());
    const exit = vi.fn();
    wireSignals({ stop, exit, source });
    source.fire('SIGINT');
    await settle();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('ignores a second signal while the stop runs', async () => {
    const source = fakeSource();
    const stop = vi.fn(() => Promise.resolve());
    const exit = vi.fn();
    wireSignals({ stop, exit, source });
    source.fire('SIGINT');
    source.fire('SIGTERM');
    await settle();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('reports a failed stop and exits with 1', async () => {
    const source = fakeSource();
    const report = vi.fn();
    const exit = vi.fn();
    wireSignals({
      stop: () => Promise.reject(new Error('node did not stop')),
      exit,
      source,
      report,
    });
    source.fire('SIGTERM');
    await settle();
    expect(report).toHaveBeenCalledWith('node did not stop');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('reports a failed stop that is not an Error as text', async () => {
    const source = fakeSource();
    const report = vi.fn();
    wireSignals({
      stop: () => Promise.reject('plain failure'),
      exit: vi.fn(),
      source,
      report,
    });
    source.fire('SIGINT');
    await settle();
    expect(report).toHaveBeenCalledWith('plain failure');
  });
});
