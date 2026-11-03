import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadSecrets, type SecretsDeps } from './secrets.ts';

const TMP_ROOT = fileURLToPath(new URL('../../.test-tmp/', import.meta.url));
const DIR = join('site-folder', '.cms', 'sample-site');
const FILE = join(DIR, 'secrets.json');
const HEX_01 = '01'.repeat(32);
const HEX_02 = '02'.repeat(32);
// Environment values are checked like file values, so they are 64 hex digits too.
const ENV_TOKEN_HEX = 'ab'.repeat(32);
const ENV_INTERNAL_HEX = 'cd'.repeat(32);

function missing(): Error {
  return Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
}

// An in-memory file system. `text` is the existing file, or undefined when it is missing.
// Each generated secret is filled with the next counter value: 01s first, then 02s.
function fakeFs(text?: string | Error) {
  const reads: string[] = [];
  const mkdirs: Array<{ path: string; options: { recursive: true } }> = [];
  const writes: Array<{
    path: string;
    data: string;
    options: { mode: number };
  }> = [];
  const sizes: number[] = [];
  let counter = 0;
  const deps: SecretsDeps = {
    readFile: async (path) => {
      reads.push(path);
      if (text instanceof Error) throw text;
      if (text === undefined) throw missing();
      return text;
    },
    writeFile: async (path, data, options) => {
      writes.push({ path, data, options });
    },
    mkdir: async (path, options) => {
      mkdirs.push({ path, options });
      return undefined;
    },
    randomBytes: (size) => {
      sizes.push(size);
      counter += 1;
      return new Uint8Array(size).fill(counter);
    },
  };
  return { deps, reads, mkdirs, writes, sizes };
}

function storedText(token: string, internal: string): string {
  return `${JSON.stringify({ previewTokenSecret: token, previewInternalSecret: internal }, null, 2)}\n`;
}

describe('loadSecrets when nothing is in the environment', () => {
  it('generates two 32-byte secrets as hex and writes them to a new file', async () => {
    const fs = fakeFs();
    const secrets = await loadSecrets(DIR, {}, fs.deps);
    expect(secrets).toEqual({
      previewTokenSecret: HEX_01,
      previewInternalSecret: HEX_02,
    });
    expect(fs.sizes).toEqual([32, 32]);
    expect(fs.mkdirs).toEqual([{ path: DIR, options: { recursive: true } }]);
    expect(fs.writes).toEqual([
      {
        path: FILE,
        data: storedText(HEX_01, HEX_02),
        options: { mode: 0o600 },
      },
    ]);
  });

  it('returns the secrets already in the file, and writes nothing', async () => {
    const fs = fakeFs(storedText(HEX_01, HEX_02));
    const secrets = await loadSecrets(DIR, {}, fs.deps);
    expect(secrets).toEqual({
      previewTokenSecret: HEX_01,
      previewInternalSecret: HEX_02,
    });
    expect(fs.reads).toEqual([FILE]);
    expect(fs.writes).toEqual([]);
    expect(fs.mkdirs).toEqual([]);
    expect(fs.sizes).toEqual([]);
  });

  it('accepts upper-case hex in a hand-written file', async () => {
    const fs = fakeFs(storedText(HEX_01.toUpperCase(), HEX_02));
    const secrets = await loadSecrets(DIR, {}, fs.deps);
    expect(secrets.previewTokenSecret).toBe(HEX_01.toUpperCase());
  });

  it('rethrows a read error other than "missing", and replaces nothing', async () => {
    const denied = Object.assign(new Error('EACCES: permission denied'), {
      code: 'EACCES',
    });
    const fs = fakeFs(denied);
    await expect(loadSecrets(DIR, {}, fs.deps)).rejects.toBe(denied);
    expect(fs.writes).toEqual([]);
  });

  it('rethrows a rejected value that is not an Error, even with code ENOENT', async () => {
    const fs = fakeFs();
    const notAnError = { code: 'ENOENT' };
    const deps: SecretsDeps = {
      ...fs.deps,
      readFile: () => Promise.reject(notAnError),
    };
    await expect(loadSecrets(DIR, {}, deps)).rejects.toBe(notAnError);
    expect(fs.writes).toEqual([]);
  });

  it.each([
    ['not JSON', 'not json'],
    ['an empty object', '{}'],
    ['a JSON array', '[]'],
    ['a token one digit short', storedText(`${'01'.repeat(31)}0`, HEX_02)],
    ['a token one digit long', storedText(`${'01'.repeat(32)}0`, HEX_02)],
    ['a token with a non-hex digit', storedText('g'.padEnd(64, '1'), HEX_02)],
    [
      'an extra key',
      JSON.stringify({
        previewTokenSecret: HEX_01,
        previewInternalSecret: HEX_02,
        extra: 'x',
      }),
    ],
    [
      'a missing internal secret',
      JSON.stringify({ previewTokenSecret: HEX_01 }),
    ],
    [
      'a number instead of a string',
      JSON.stringify({ previewTokenSecret: 1, previewInternalSecret: HEX_02 }),
    ],
  ])('refuses a secrets file with %s', async (_label, text) => {
    const fs = fakeFs(text);
    await expect(loadSecrets(DIR, {}, fs.deps)).rejects.toThrow(
      new Error(`${FILE} is not a valid secrets file`),
    );
    expect(fs.writes).toEqual([]);
  });
});

describe('loadSecrets with the environment', () => {
  it('uses both environment values, and does not read or write the file', async () => {
    const fs = fakeFs();
    const secrets = await loadSecrets(
      DIR,
      {
        PREVIEW_TOKEN_SECRET: ENV_TOKEN_HEX,
        PREVIEW_INTERNAL_SECRET: ENV_INTERNAL_HEX,
      },
      fs.deps,
    );
    expect(secrets).toEqual({
      previewTokenSecret: ENV_TOKEN_HEX,
      previewInternalSecret: ENV_INTERNAL_HEX,
    });
    expect(fs.reads).toEqual([]);
    expect(fs.writes).toEqual([]);
    expect(fs.mkdirs).toEqual([]);
  });

  it('prefers the environment token over the file, and keeps the file value for the internal secret', async () => {
    const fs = fakeFs(storedText(HEX_01, HEX_02));
    const secrets = await loadSecrets(
      DIR,
      { PREVIEW_TOKEN_SECRET: ENV_TOKEN_HEX },
      fs.deps,
    );
    expect(secrets).toEqual({
      previewTokenSecret: ENV_TOKEN_HEX,
      previewInternalSecret: HEX_02,
    });
    expect(fs.writes).toEqual([]);
  });

  it('prefers the environment internal secret over the file', async () => {
    const fs = fakeFs(storedText(HEX_01, HEX_02));
    const secrets = await loadSecrets(
      DIR,
      { PREVIEW_INTERNAL_SECRET: ENV_INTERNAL_HEX },
      fs.deps,
    );
    expect(secrets).toEqual({
      previewTokenSecret: HEX_01,
      previewInternalSecret: ENV_INTERNAL_HEX,
    });
  });

  it('creates the file with both generated secrets when only the internal secret is in the environment', async () => {
    const fs = fakeFs();
    const secrets = await loadSecrets(
      DIR,
      { PREVIEW_INTERNAL_SECRET: ENV_INTERNAL_HEX },
      fs.deps,
    );
    expect(secrets).toEqual({
      previewTokenSecret: HEX_01,
      previewInternalSecret: ENV_INTERNAL_HEX,
    });
    expect(fs.writes).toEqual([
      {
        path: FILE,
        data: storedText(HEX_01, HEX_02),
        options: { mode: 0o600 },
      },
    ]);
  });

  it('treats an empty environment value as unset', async () => {
    const fs = fakeFs();
    const secrets = await loadSecrets(
      DIR,
      { PREVIEW_TOKEN_SECRET: '', PREVIEW_INTERNAL_SECRET: '' },
      fs.deps,
    );
    expect(secrets).toEqual({
      previewTokenSecret: HEX_01,
      previewInternalSecret: HEX_02,
    });
    expect(fs.reads).toEqual([FILE]);
  });
});

describe('loadSecrets with a malformed environment value', () => {
  it.each([
    ['too short', 'ab'.repeat(31)],
    ['too long', `${'ab'.repeat(32)}a`],
    ['not hex', 'zz'.repeat(32)],
    ['with a space', `${'ab'.repeat(31)} a`],
  ])(
    'refuses PREVIEW_TOKEN_SECRET that is %s, and reads and writes nothing',
    async (_label, value) => {
      const fs = fakeFs();
      await expect(
        loadSecrets(DIR, { PREVIEW_TOKEN_SECRET: value }, fs.deps),
      ).rejects.toThrow(
        new Error('PREVIEW_TOKEN_SECRET must be 64 hex digits'),
      );
      expect(fs.reads).toEqual([]);
      expect(fs.writes).toEqual([]);
    },
  );

  it('refuses PREVIEW_INTERNAL_SECRET even when the token secret is valid', async () => {
    const fs = fakeFs();
    await expect(
      loadSecrets(
        DIR,
        {
          PREVIEW_TOKEN_SECRET: ENV_TOKEN_HEX,
          PREVIEW_INTERNAL_SECRET: 'not-hex',
        },
        fs.deps,
      ),
    ).rejects.toThrow(
      new Error('PREVIEW_INTERNAL_SECRET must be 64 hex digits'),
    );
    expect(fs.writes).toEqual([]);
  });

  it('accepts upper-case hex from the environment, as the file does', async () => {
    const fs = fakeFs();
    const secrets = await loadSecrets(
      DIR,
      {
        PREVIEW_TOKEN_SECRET: ENV_TOKEN_HEX.toUpperCase(),
        PREVIEW_INTERNAL_SECRET: ENV_INTERNAL_HEX,
      },
      fs.deps,
    );
    expect(secrets.previewTokenSecret).toBe(ENV_TOKEN_HEX.toUpperCase());
  });
});

describe('loadSecrets refuses equal secrets (WORKPLAN 2.9b)', () => {
  const MUST_DIFFER = new Error(
    'The preview token secret and the internal secret must differ',
  );

  it('refuses two equal environment values', async () => {
    const fs = fakeFs();
    await expect(
      loadSecrets(
        DIR,
        {
          PREVIEW_TOKEN_SECRET: ENV_TOKEN_HEX,
          PREVIEW_INTERNAL_SECRET: ENV_TOKEN_HEX,
        },
        fs.deps,
      ),
    ).rejects.toThrow(MUST_DIFFER);
    expect(fs.writes).toEqual([]);
  });

  it('refuses a secrets file whose two values are equal', async () => {
    const fs = fakeFs(storedText(HEX_01, HEX_01));
    await expect(loadSecrets(DIR, {}, fs.deps)).rejects.toThrow(MUST_DIFFER);
    expect(fs.writes).toEqual([]);
  });

  it('refuses generated secrets that come out equal, and writes no file', async () => {
    const fs = fakeFs();
    const sameBytes = {
      ...fs.deps,
      randomBytes: () => new Uint8Array(32).fill(7),
    };
    await expect(loadSecrets(DIR, {}, sameBytes)).rejects.toThrow(MUST_DIFFER);
    expect(fs.writes).toEqual([]);
    expect(fs.mkdirs).toEqual([]);
  });

  it('refuses an environment token equal to the internal secret kept in the file', async () => {
    const fs = fakeFs(storedText(HEX_01, HEX_02));
    await expect(
      loadSecrets(DIR, { PREVIEW_TOKEN_SECRET: HEX_02 }, fs.deps),
    ).rejects.toThrow(MUST_DIFFER);
  });
});

describe('loadSecrets with the real file system', () => {
  it('generates a file on the first call, and returns the same secrets on the next (restart)', async () => {
    await mkdir(TMP_ROOT, { recursive: true });
    const dir = await mkdtemp(join(TMP_ROOT, 'secrets-'));
    try {
      const first = await loadSecrets(dir, {});
      const second = await loadSecrets(dir, {});
      expect(first.previewTokenSecret).toMatch(/^[0-9a-f]{64}$/);
      expect(first.previewInternalSecret).toMatch(/^[0-9a-f]{64}$/);
      expect(first.previewTokenSecret).not.toBe(first.previewInternalSecret);
      expect(second).toEqual(first);
      const stored = JSON.parse(
        await readFile(join(dir, 'secrets.json'), 'utf8'),
      ) as unknown;
      expect(stored).toEqual({
        previewTokenSecret: first.previewTokenSecret,
        previewInternalSecret: first.previewInternalSecret,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === 'win32')(
    'writes the secrets file with mode 600',
    async () => {
      await mkdir(TMP_ROOT, { recursive: true });
      const dir = await mkdtemp(join(TMP_ROOT, 'secrets-'));
      try {
        await loadSecrets(dir, {});
        const mode = (await stat(join(dir, 'secrets.json'))).mode & 0o777;
        expect(mode).toBe(0o600);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );

  it('creates the site folder when it does not exist yet', async () => {
    await mkdir(TMP_ROOT, { recursive: true });
    const root = await mkdtemp(join(TMP_ROOT, 'secrets-'));
    const dir = join(root, 'site', 'nested');
    try {
      const secrets = await loadSecrets(dir, {});
      const stored = JSON.parse(
        await readFile(join(dir, 'secrets.json'), 'utf8'),
      ) as unknown;
      expect(stored).toEqual(secrets);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
