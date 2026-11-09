// The preview state file of cms-server (WORKPLAN 2.9c, PHASE-2-DESIGN 5.6): `.cms/<site>/state.json`. It names the
// bundle the node serves (`current`), the last bundle that served (`lastGood`), and how many protocol rebuilds each
// bundle has had (`protocolAttempts`, keyed by bundleId). Each bundle entry records `baseCommit`, the origin/<branch>
// SHA the bundle was built on. The file is written atomically. A missing file, or one that does not parse, is an empty
// state: a corrupt file is logged, and the start goes on.
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { writeFileAtomic } from '../fs/atomic.ts';
import { type Logger, logger } from '../log.ts';

/** One bundle the state names: its id, and the origin/<branch> SHA it was built on. */
export interface BundleEntry {
  readonly bundleId: string;
  readonly baseCommit: string;
}

/** The preview state. `protocolAttempts` is a Map from bundleId to the protocol rebuilds that bundle has had. */
export interface PreviewState {
  readonly current: BundleEntry | null;
  readonly lastGood: BundleEntry | null;
  readonly protocolAttempts: ReadonlyMap<string, number>;
}

// The shape of state.json. Parsed with Zod, since the file is read at a trust boundary.
const entrySchema = z.object({
  bundleId: z.string().min(1),
  baseCommit: z.string().min(1),
});
// The attempt counts are checked by countsOf, not by a Zod record: a record drops a bundleId named `__proto__`.
const fileSchema = z.object({
  current: entrySchema.nullable(),
  lastGood: entrySchema.nullable(),
  protocolAttempts: z.unknown(),
});
const countSchema = z.number().int().nonnegative();

/** The state of a first start: nothing built, and no protocol rebuilds. */
export function emptyState(): PreviewState {
  return { current: null, lastGood: null, protocolAttempts: new Map() };
}

/** Reads the text of a state file. Null when the text is not JSON of the state's shape. */
export function decodeState(text: string): PreviewState | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = fileSchema.safeParse(value);
  if (!parsed.success) return null;
  const protocolAttempts = countsOf(parsed.data.protocolAttempts);
  if (protocolAttempts === null) return null;
  return {
    current: parsed.data.current,
    lastGood: parsed.data.lastGood,
    protocolAttempts,
  };
}

/** The attempt counts of a state file: a plain object of bundleId to a whole, non-negative count. Null when it is not one. */
function countsOf(value: unknown): Map<string, number> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const counts = new Map<string, number>();
  // Object.entries lists an own key named `__proto__` too, so no bundleId is lost here.
  for (const [bundleId, count] of Object.entries(
    value as Record<string, unknown>,
  )) {
    const checked = countSchema.safeParse(count);
    if (!checked.success) return null;
    counts.set(bundleId, checked.data);
  }
  return counts;
}

/** The text written to the state file: the state as JSON, indented two spaces, with a final newline. */
export function encodeState(state: PreviewState): string {
  const file = {
    current: state.current,
    lastGood: state.lastGood,
    // Object.fromEntries, not a plain assignment: a bundleId such as `__proto__` stays a key of its own.
    protocolAttempts: Object.fromEntries(state.protocolAttempts),
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

/**
 * Reads the state file. A missing file is an empty state, without a log line. A file that cannot be read, or whose text
 * does not decode, is logged and read as an empty state, so the start goes on.
 */
export async function readState(
  file: string,
  log: Logger = logger,
): Promise<PreviewState> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error: unknown) {
    if (isMissing(error)) return emptyState();
    log.warn('Could not read the preview state, so it starts empty', {
      file,
      error: messageOf(error),
    });
    return emptyState();
  }
  const state = decodeState(text);
  if (state !== null) return state;
  log.warn('The preview state is corrupt, so it starts empty', { file });
  return emptyState();
}

/** The state in memory, and the file it is written to. */
export interface StateStore {
  /** The state as last set. */
  get(): PreviewState;
  /** Replaces the state and writes the file. A write that fails is logged and does not reject: the state stays in memory. */
  set(next: PreviewState): Promise<void>;
  /** The bundle ids a build must keep: the served one (`current`) and the last good one. */
  keptBundles(): ReadonlySet<string>;
}

/** A store over `file`, starting from `initial` (what readState gave). */
export function createStateStore(
  file: string,
  initial: PreviewState,
  log: Logger = logger,
): StateStore {
  let state = initial;
  return {
    get: () => state,
    async set(next) {
      state = next;
      try {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFileAtomic(file, encodeState(next));
      } catch (error: unknown) {
        log.error('Could not write the preview state', {
          file,
          error: messageOf(error),
        });
      }
    },
    keptBundles() {
      const kept = new Set<string>();
      if (state.current !== null) kept.add(state.current.bundleId);
      if (state.lastGood !== null) kept.add(state.lastGood.bundleId);
      return kept;
    },
  };
}

// True for the error of a path that does not exist.
function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
