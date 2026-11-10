// The write stage of a save (WORKPLAN 2.5c items 6, 8, 9 and 10, PHASE-2-DESIGN 5.3): the planned files are written
// atomically, committed on cms/work, and the after-commit hooks run. A failure restores the paths from HEAD, so the
// working copy is as it was before the save. Runs inside the repo lock.
import { mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { DocumentEntry } from '../bundle/read.ts';
import { changesetOf } from '../documents/changeset.ts';
import type { FileOp } from '../documents/plan-write.ts';
import type { FileReads } from '../documents/read.ts';
import { revisionOfDocument } from '../documents/revision.ts';
import { writeFileAtomic } from '../fs/atomic.ts';
import type { SaveContext, SaveStop } from './context.ts';
import type { SaveChange } from './body.ts';
import { needsRebuild } from './rebuild.ts';

/** Writes the save's files, commits them, runs the after-commit hooks and sets the revisions and the rebuild flag. */
export async function writeChanges(
  ctx: SaveContext,
): Promise<SaveStop | undefined> {
  ctx.rebuild = needsRebuild(ctx.changes, ctx.documents, ctx.stored);
  // The copied images and the text files, each path once. commitSave stages them and restore puts them back (2.7d).
  const paths = [
    ...new Set([
      ...ctx.copies.map((copy) => copy.to),
      ...ctx.plan.map((op) => op.path),
    ]),
  ];
  try {
    await copyImages(ctx);
    for (const op of ctx.plan) await applyOp(ctx, op);
    await ctx.tx.commitSave(paths, commitMessageOf(ctx.changes));
  } catch (error) {
    let message = `The save was not written: ${messageOf(error)}`;
    try {
      await ctx.tx.restore(paths);
    } catch (restoreError) {
      // The working copy may be partly written, so the client is told; the save's own error is kept.
      ctx.log.error(
        'the working copy could not be restored after a failed save',
        {
          reason: messageOf(restoreError),
        },
      );
      message += `; the working copy could not be restored: ${messageOf(restoreError)}`;
    }
    return { status: 500, body: { error: 'save-failed', message } };
  }
  for (const hook of ctx.afterCommit) {
    try {
      await hook(ctx);
    } catch (error) {
      ctx.log.error('an after-commit hook of the save failed', {
        reason: messageOf(error),
      });
    }
  }
  try {
    ctx.revisions = await revisionsAfter(ctx);
  } catch (error) {
    // The save is committed, so this is not a failed save: the client is told to reload, not to resend.
    ctx.log.error('the revisions of a committed save could not be read', {
      reason: messageOf(error),
    });
    return {
      status: 500,
      body: {
        error: 'save-committed',
        message:
          'The save was committed, but its revisions could not be read. Reload the documents before the next save.',
      },
    };
  }
  return undefined;
}

/** The commit message (WORKPLAN 2.5c item 8): a subject with the count, then one `<status> <key>` line per document. */
export function commitMessageOf(changes: readonly SaveChange[]): string {
  const lines = changes.map(
    (change) => `${statusOf(change)} ${change.document}`,
  );
  return [`CMS save: ${changes.length} document(s)`, '', ...lines].join('\n');
}

// The status a change gives its document in the commit message.
function statusOf(change: SaveChange): string {
  if (change.deleted) return 'deleted';
  return change.baseRevision === null ? 'created' : 'modified';
}

/**
 * Copies the bytes of `from` to `to` atomically: the real copier of the save, which a test replaces (WORKPLAN 2.7d).
 * The folder of `to` must exist.
 */
export async function copyFileAtomic(from: string, to: string): Promise<void> {
  await writeFileAtomic(to, await readFile(from));
}

// Copies each staged image into the site once per target, before any text file is written. A target listed twice
// is copied once. A new file's folder is made first, as for a text file.
async function copyImages(ctx: SaveContext): Promise<void> {
  const copied = new Set<string>();
  for (const copy of ctx.copies) {
    if (copied.has(copy.to)) continue;
    copied.add(copy.to);
    const target = join(ctx.siteFolder, copy.to);
    await mkdir(dirname(target), { recursive: true });
    await ctx.copyFile(copy.from, target);
  }
}

// Writes one planned file, or removes it. A new file's folder is made first.
async function applyOp(ctx: SaveContext, op: FileOp): Promise<void> {
  const target = join(ctx.siteFolder, op.path);
  if (op.op === 'delete') {
    await rm(target);
    return;
  }
  await mkdir(dirname(target), { recursive: true });
  await ctx.writeFile(target, op.text);
}

/**
 * The revision of each created and updated document, read from the working copy after the commit. An update is read
 * from its document; a create is in the changeset, which holds the documents that cms/work adds to the merge base.
 */
async function revisionsAfter(ctx: SaveContext): Promise<Map<string, string>> {
  const reads: FileReads = new Map();
  let created: ReadonlyMap<string, DocumentEntry> | undefined;
  const revisions = new Map<string, string>();
  for (const change of ctx.changes) {
    if (change.deleted) continue;
    const known = ctx.documents.get(change.document);
    let revision: string | null | undefined;
    if (known === undefined) {
      created ??= await createdRecordsOf(ctx);
      revision = created.get(change.document)?.revision;
    } else {
      const facts = await revisionOfDocument(
        ctx.siteFolder,
        known,
        reads,
        false,
      );
      revision = facts?.revision;
    }
    if (revision === undefined || revision === null)
      throw new Error(`"${change.document}" has no revision after the save`);
    revisions.set(change.document, revision);
  }
  return revisions;
}

// The documents that the changeset holds as created, by key.
async function createdRecordsOf(
  ctx: SaveContext,
): Promise<ReadonlyMap<string, DocumentEntry>> {
  const changeset = await changesetOf({
    bundle: ctx.bundle,
    repo: ctx.repo,
    siteFolder: ctx.siteFolder,
  });
  return new Map(
    changeset.createdRecords.map((record) => [record.key, record]),
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
