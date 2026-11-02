// Atomic file writes (2.7a gaps; 2.9c reuses this). The bytes go to a temp file in the
// same folder, which is then renamed over the target, so a reader sees the old file or
// the new one, never half of a write. On Windows the rename fails with EPERM or EBUSY
// while another process (an indexer) holds the target: those are retried after a short
// delay, and any other error is thrown at once.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';

export const RENAME_ATTEMPTS = 5;
const RENAME_DELAY_MS = 20;
const RETRYABLE = new Set(['EPERM', 'EBUSY']);

export interface AtomicWriteDeps {
  rename?: (from: string, to: string) => Promise<void>;
  wait?: (ms: number) => Promise<void>;
  attempts?: number;
  delayMs?: number;
}

/** The `code` of a Node system error (`ENOENT`, `EPERM`, ...), or undefined for anything else. */
export function errorCode(error: unknown): string | undefined {
  return error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : undefined;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Writes `data` to `file` in one step. The temp file is removed if any step fails. */
export async function writeFileAtomic(
  file: string,
  data: string | Uint8Array,
  deps: AtomicWriteDeps = {},
): Promise<void> {
  const {
    rename = fs.rename,
    wait = sleep,
    attempts = RENAME_ATTEMPTS,
    delayMs = RENAME_DELAY_MS,
  } = deps;
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, data);
    for (let attempt = 1; ; attempt += 1) {
      try {
        await rename(temp, file);
        return;
      } catch (error) {
        const code = errorCode(error);
        if (code === undefined || !RETRYABLE.has(code) || attempt >= attempts) {
          throw error;
        }
        await wait(delayMs);
      }
    }
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}
