import { describe, expect, it } from 'vitest';
import { parseOptions } from './stryker-changed.ts';

describe('parseOptions', () => {
  it('plans the changed files against origin/main by default', () => {
    expect(parseOptions([])).toEqual({
      base: 'origin/main',
      run: false,
      all: false,
      group: undefined,
    });
  });

  it('reads --run, --base, and --all with --group', () => {
    expect(parseOptions(['--run', '--base', 'origin/wave-6'])).toEqual({
      base: 'origin/wave-6',
      run: true,
      all: false,
      group: undefined,
    });
    expect(parseOptions(['--all', '--group', 'protocol', '--run'])).toEqual({
      base: 'origin/main',
      run: true,
      all: true,
      group: 'protocol',
    });
  });

  it.each([
    [['--base'], '--base needs a value'],
    [['--frobnicate'], 'unknown option: --frobnicate'],
    [
      ['--group', 'protocol', '--run'],
      '--group needs --all (a shard covers every file of its group)',
    ],
    [
      ['--all', '--group', 'sample-site'],
      '--group must be one of serve, preview, renderer, protocol, contract, cms-preview, cms-save, cms-documents, cms-git, cms-codecs, cms-server',
    ],
  ])('rejects %j', (args, message) => {
    expect(() => parseOptions(args)).toThrow(message);
  });
});
