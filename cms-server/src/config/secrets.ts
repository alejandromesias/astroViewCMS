// The two secrets of the preview (PHASE-2-DESIGN 5.1, 5.10). The environment wins
// over the file, so a deployment can set them. Otherwise they are generated once and
// kept in `<dir>/secrets.json`, so a restart does not invalidate sessions.
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

export interface Secrets {
  readonly previewTokenSecret: string;
  readonly previewInternalSecret: string;
}

// The file system and randomness, injected so that tests need neither.
export interface SecretsDeps {
  /** Rejects with an error whose `code` is `ENOENT` when the file is missing. */
  readFile: (path: string) => Promise<string>;
  writeFile: (
    path: string,
    data: string,
    options: { mode: number },
  ) => Promise<void>;
  mkdir: (path: string, options: { recursive: true }) => Promise<unknown>;
  randomBytes: (size: number) => Uint8Array;
}

export type Env = Readonly<Record<string, string | undefined>>;

const ENV_TOKEN = 'PREVIEW_TOKEN_SECRET';
const ENV_INTERNAL = 'PREVIEW_INTERNAL_SECRET';
const SECRET_BYTES = 32;
const FILE_NAME = 'secrets.json';
// The owner only. Windows ignores the mode, so only POSIX systems enforce it.
const FILE_MODE = 0o600;

// 32 bytes as hex is 64 digits. Either case is accepted, so a hand-written file still works.
const HEX_SECRET = z.string().regex(/^[0-9a-f]{64}$/i);
const FileSecretsSchema = z.strictObject({
  previewTokenSecret: HEX_SECRET,
  previewInternalSecret: HEX_SECRET,
});

/**
 * Returns the two secrets for the site whose folder is `dir`. An empty environment
 * variable counts as unset. Nothing is read or written when both come from the
 * environment.
 */
export async function loadSecrets(
  dir: string,
  env: Env,
  deps: SecretsDeps = {
    readFile: (path) => readFile(path, 'utf8'),
    writeFile: (path, data, options) => writeFile(path, data, options),
    mkdir: (path, options) => mkdir(path, options),
    randomBytes,
  },
): Promise<Secrets> {
  const fromEnvToken = fromEnvironment(ENV_TOKEN, env[ENV_TOKEN]);
  const fromEnvInternal = fromEnvironment(ENV_INTERNAL, env[ENV_INTERNAL]);
  if (fromEnvToken !== undefined && fromEnvInternal !== undefined) {
    return {
      previewTokenSecret: fromEnvToken,
      previewInternalSecret: fromEnvInternal,
    };
  }
  const kept = await keptSecrets(dir, deps);
  return {
    previewTokenSecret: fromEnvToken ?? kept.previewTokenSecret,
    previewInternalSecret: fromEnvInternal ?? kept.previewInternalSecret,
  };
}

// An environment value gets the same check as the file: 64 hex digits, so a
// bad deployment value fails at start rather than being used as a key.
function fromEnvironment(
  name: string,
  value: string | undefined,
): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (!HEX_SECRET.safeParse(value).success) {
    throw new Error(`${name} must be 64 hex digits`);
  }
  return value;
}

// Reads the file, or creates it with two new secrets when it does not exist.
// Any other read error is passed on: a file we cannot read must not be replaced.
async function keptSecrets(dir: string, deps: SecretsDeps): Promise<Secrets> {
  const path = join(dir, FILE_NAME);
  let text: string;
  try {
    text = await deps.readFile(path);
  } catch (error) {
    if (!isNotFound(error)) throw error;
    const created = {
      previewTokenSecret: hexSecret(deps.randomBytes),
      previewInternalSecret: hexSecret(deps.randomBytes),
    };
    await deps.mkdir(dir, { recursive: true });
    await deps.writeFile(path, `${JSON.stringify(created, null, 2)}\n`, {
      mode: FILE_MODE,
    });
    return created;
  }
  return parseSecretsFile(path, text);
}

function parseSecretsFile(path: string, text: string): Secrets {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = undefined;
  }
  const result = FileSecretsSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`${path} is not a valid secrets file`);
  }
  return result.data;
}

function hexSecret(random: (size: number) => Uint8Array): string {
  return Buffer.from(random(SECRET_BYTES)).toString('hex');
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
