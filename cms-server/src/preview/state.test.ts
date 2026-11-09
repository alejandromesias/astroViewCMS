import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '../log.ts';
import {
  createStateStore,
  decodeState,
  emptyState,
  encodeState,
  type PreviewState,
  readState,
} from './state.ts';

const BASE = 'a'.repeat(40);
const ONE = { bundleId: 'b-1', baseCommit: BASE };
const TWO = { bundleId: 'b-2', baseCommit: 'c'.repeat(40) };

// Each test gets its own folder, and removes it after.
let dir = '';
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'state-test-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A logger whose calls are spies. */
function spyLog() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() } satisfies Logger;
}

/** A state with one served bundle, its last good bundle, and one protocol rebuild. */
function servedState(): PreviewState {
  return {
    current: ONE,
    lastGood: TWO,
    protocolAttempts: new Map([['b-1', 1]]),
  };
}

describe('decodeState and encodeState', () => {
  it('reads back what encodeState wrote, with the attempts as a Map', () => {
    const state = servedState();
    expect(decodeState(encodeState(state))).toStrictEqual(state);
  });

  it('writes the file as it is documented: two-space JSON with a final newline', () => {
    const text = encodeState(servedState());
    expect(text).toBe(
      `{
  "current": {
    "bundleId": "b-1",
    "baseCommit": "${BASE}"
  },
  "lastGood": {
    "bundleId": "b-2",
    "baseCommit": "${'c'.repeat(40)}"
  },
  "protocolAttempts": {
    "b-1": 1
  }
}
`,
    );
  });

  it('reads an empty state, with nothing served and no attempts', () => {
    expect(
      decodeState('{"current":null,"lastGood":null,"protocolAttempts":{}}'),
    ).toStrictEqual(emptyState());
  });

  it.each([
    ['text that is not JSON', '{'],
    ['JSON that is not an object', 'null'],
    ['a state with no current key', '{"lastGood":null,"protocolAttempts":{}}'],
    [
      'a bundle entry with an empty bundleId',
      '{"current":{"bundleId":"","baseCommit":"x"},"lastGood":null,"protocolAttempts":{}}',
    ],
    [
      'a bundle entry with no baseCommit',
      '{"current":{"bundleId":"x"},"lastGood":null,"protocolAttempts":{}}',
    ],
    [
      'a negative attempt count',
      '{"current":null,"lastGood":null,"protocolAttempts":{"x":-1}}',
    ],
    [
      'a fractional attempt count',
      '{"current":null,"lastGood":null,"protocolAttempts":{"x":1.5}}',
    ],
    [
      'an attempt count that is a string',
      '{"current":null,"lastGood":null,"protocolAttempts":{"x":"1"}}',
    ],
  ])('rejects %s', (_label, text) => {
    expect(decodeState(text)).toBeNull();
  });

  it('keeps a bundleId named __proto__ as a key of its own, in both directions', () => {
    const text =
      '{"current":null,"lastGood":null,"protocolAttempts":{"__proto__":2}}';
    const decoded = decodeState(text);
    expect(decoded?.protocolAttempts.get('__proto__')).toBe(2);
    const state: PreviewState = {
      current: null,
      lastGood: null,
      protocolAttempts: new Map([['__proto__', 3]]),
    };
    expect(decodeState(encodeState(state))?.protocolAttempts).toStrictEqual(
      new Map([['__proto__', 3]]),
    );
  });
});

describe('readState', () => {
  it('reads a state file that encodeState wrote', async () => {
    const file = path.join(dir, 'state.json');
    await writeFile(file, encodeState(servedState()));
    expect(await readState(file, spyLog())).toStrictEqual(servedState());
  });

  it('answers an empty state for a missing file, and does not log', async () => {
    const log = spyLog();
    expect(await readState(path.join(dir, 'state.json'), log)).toStrictEqual(
      emptyState(),
    );
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  it('logs a corrupt file and answers an empty state', async () => {
    const file = path.join(dir, 'state.json');
    await writeFile(file, '{"current": ');
    const log = spyLog();
    expect(await readState(file, log)).toStrictEqual(emptyState());
    expect(log.warn).toHaveBeenCalledWith(
      'The preview state is corrupt, so it starts empty',
      { file },
    );
  });

  it('logs a file that cannot be read, and answers an empty state', async () => {
    // A folder where the file should be: reading it fails, and it is not a missing file.
    const file = path.join(dir, 'state.json');
    await mkdir(file);
    const log = spyLog();
    expect(await readState(file, log)).toStrictEqual(emptyState());
    expect(log.warn).toHaveBeenCalledWith(
      'Could not read the preview state, so it starts empty',
      { file, error: expect.stringContaining('EISDIR') },
    );
  });

  it('uses the cms-server logger when none is given', async () => {
    // A missing file is quiet, so the default logger is not written to here.
    expect(await readState(path.join(dir, 'missing.json'))).toStrictEqual(
      emptyState(),
    );
  });
});

describe('createStateStore', () => {
  it('writes the file on set, and get answers the state it was given', async () => {
    const file = path.join(dir, 'nested', 'state.json');
    const store = createStateStore(file, emptyState(), spyLog());
    await store.set(servedState());
    expect(await readFile(file, 'utf8')).toBe(encodeState(servedState()));
    expect(store.get()).toStrictEqual(servedState());
  });

  it('logs a write that fails, and keeps the new state in memory', async () => {
    // A folder where the file should be: the atomic rename onto it fails.
    const file = path.join(dir, 'state.json');
    await mkdir(file);
    const log = spyLog();
    const store = createStateStore(file, emptyState(), log);
    await store.set(servedState());
    expect(log.error).toHaveBeenCalledWith(
      'Could not write the preview state',
      {
        file,
        error: expect.any(String),
      },
    );
    expect(store.get()).toStrictEqual(servedState());
  });

  it('keeps the served bundle and the last good one, once each', () => {
    const store = createStateStore(
      path.join(dir, 'state.json'),
      servedState(),
      spyLog(),
    );
    expect([...store.keptBundles()].sort()).toStrictEqual(['b-1', 'b-2']);
  });

  it('keeps one id when the served and last good bundles are the same', () => {
    const store = createStateStore(
      path.join(dir, 'state.json'),
      { current: ONE, lastGood: ONE, protocolAttempts: new Map() },
      spyLog(),
    );
    expect([...store.keptBundles()]).toStrictEqual(['b-1']);
  });

  it('keeps nothing when no bundle is named', () => {
    const store = createStateStore(
      path.join(dir, 'state.json'),
      emptyState(),
      spyLog(),
    );
    expect(store.keptBundles().size).toBe(0);
  });

  it('keeps only the last good bundle when nothing is served', () => {
    const store = createStateStore(
      path.join(dir, 'state.json'),
      { current: null, lastGood: TWO, protocolAttempts: new Map() },
      spyLog(),
    );
    expect([...store.keptBundles()]).toStrictEqual(['b-2']);
  });
});
