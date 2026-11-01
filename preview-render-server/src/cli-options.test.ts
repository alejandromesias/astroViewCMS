import { describe, expect, it } from 'vitest';
import { choosePort, parseCliOptions, parsePort } from './cli-options.ts';

describe('parseCliOptions', () => {
  it('reads the config path and leaves every override unset', () => {
    expect(parseCliOptions(['sites/a.config.ts'])).toEqual({
      configPath: 'sites/a.config.ts',
      root: undefined,
      out: undefined,
      port: undefined,
      dev: false,
    });
  });

  it('reads --dev as a switch next to the config path', () => {
    expect(parseCliOptions(['sites/a.config.ts', '--dev']).dev).toBe(true);
  });

  it('reads --root, --out and --port given as separate arguments', () => {
    expect(
      parseCliOptions([
        'sites/a.config.ts',
        '--root',
        '../site',
        '--out',
        '/bundles/one',
        '--port',
        '4500',
      ]),
    ).toEqual({
      configPath: 'sites/a.config.ts',
      root: '../site',
      out: '/bundles/one',
      port: 4500,
      dev: false,
    });
  });

  it('reads --flag=value the same way', () => {
    expect(
      parseCliOptions([
        'sites/a.config.ts',
        '--root=../site',
        '--out=/b',
        '--port=4501',
      ]),
    ).toEqual({
      configPath: 'sites/a.config.ts',
      root: '../site',
      out: '/b',
      port: 4501,
      dev: false,
    });
  });

  it('accepts flags before the config path', () => {
    expect(parseCliOptions(['--port', '4500', 'sites/a.config.ts'])).toEqual({
      configPath: 'sites/a.config.ts',
      root: undefined,
      out: undefined,
      port: 4500,
      dev: false,
    });
  });

  it('keeps no config path when only flags are given', () => {
    expect(parseCliOptions(['--dev']).configPath).toBeUndefined();
  });

  it.each([
    [['a.config.ts', 'b.config.ts'], 'Unexpected argument: b.config.ts'],
    [['a.config.ts', '-root'], 'Unexpected argument: -root'],
    [['a.config.ts', '--bundle-id', 'x'], 'Unknown option: --bundle-id'],
    [['a.config.ts', '--roots', '/x'], 'Unknown option: --roots'],
    [['a.config.ts', '--__proto__', 'x'], 'Unknown option: --__proto__'],
    [['a.config.ts', '--constructor=1'], 'Unknown option: --constructor'],
    [['a.config.ts', '--out'], '--out needs a value'],
    [['a.config.ts', '--out', '--dev'], '--out needs a value'],
    [['a.config.ts', '--root='], '--root needs a value'],
    [['a.config.ts', '--port', ''], '--port needs a value'],
    [['a.config.ts', '--dev=1'], '--dev takes no value'],
    [
      ['a.config.ts', '--port', '0'],
      '--port must be a number from 1 to 65535, got "0"',
    ],
  ])('rejects %j with "%s"', (args, message) => {
    expect(() => parseCliOptions(args)).toThrow(new Error(message));
  });
});

describe('parsePort', () => {
  it.each([
    ['1', 1],
    ['80', 80],
    ['4400', 4400],
    ['65535', 65535],
    ['00080', 80],
  ])('reads %s as %i', (value, port) => {
    expect(parsePort(value)).toBe(port);
  });

  it.each(['0', '65536', '4400x', '1e3', '-1', '44.5', ' 80', '123456'])(
    'rejects %j',
    (value) => {
      expect(() => parsePort(value)).toThrow(
        new Error(`--port must be a number from 1 to 65535, got "${value}"`),
      );
    },
  );
});

describe('choosePort', () => {
  it('uses the --port flag ahead of PORT and the config', () => {
    expect(choosePort(4500, '4600', 4400)).toBe('4500');
  });

  it('uses PORT ahead of the config when no flag is given', () => {
    expect(choosePort(undefined, '4600', 4400)).toBe('4600');
  });

  it('falls back to the config port when neither is given', () => {
    expect(choosePort(undefined, undefined, 4400)).toBe('4400');
  });
});
