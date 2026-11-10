import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { revisionOf } from 'preview-contract';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  authorsCollections,
  bundleOf,
  documentOf,
  emptyChangeset,
  fakeTx,
  saveContext,
} from '../../test/helpers/save-context.ts';
import {
  removeWorkingCopies,
  tempWorkingCopy,
} from '../../test/helpers/working-copy.ts';
import { writeFileAtomic } from '../fs/atomic.ts';
import type { SaveChange } from './body.ts';
import { commitMessageOf, copyFileAtomic, writeChanges } from './write.ts';

const ANA = 'src/content/authors/ana.json';
const ANA_TEXT = '{\n  "name": "Ana"\n}\n';
const ANA_NEW = '{\n  "name": "Ana Torres"\n}\n';
const LEE = 'src/content/authors/lee.json';
const LEE_TEXT = '{\n  "name": "Lee"\n}\n';
const SHARED = 'src/content/authors/all.json';
const SHARED_TEXT = '{\n  "ana": { "name": "Ana" }\n}\n';

afterEach(removeWorkingCopies);

// The change of Ana's update, and the create of Lee.
const UPDATE: SaveChange = {
  document: 'authors/ana',
  baseRevision: 'r',
  deleted: false,
  data: { name: 'Ana Torres' },
};
const CREATE: SaveChange = {
  document: 'authors/lee',
  baseRevision: null,
  deleted: false,
  data: { name: 'Lee' },
};
// The answer when the commit went through but the revisions could not be read (see write.ts).
const SAVE_COMMITTED = {
  status: 500,
  body: {
    error: 'save-committed',
    message:
      'The save was committed, but its revisions could not be read. Reload the documents before the next save.',
  },
};

describe('writeChanges', () => {
  it('writes an update, commits it, and answers the revision of the new file', async () => {
    const siteFolder = await tempWorkingCopy({ [ANA]: ANA_TEXT });
    const tx = fakeTx();
    const ctx = saveContext({
      siteFolder,
      tx,
      writeFile: writeFileAtomic,
      changes: [UPDATE],
      bundle: bundleOf([documentOf('authors/ana', { file: ANA })]),
      documents: bundleOf([documentOf('authors/ana', { file: ANA })]).documents,
      plan: [{ op: 'write', path: ANA, text: ANA_NEW }],
    });
    expect(await writeChanges(ctx)).toBeUndefined();
    expect(await readFile(join(siteFolder, ANA), 'utf8')).toBe(ANA_NEW);
    expect(tx.commitSave).toHaveBeenCalledWith(
      [ANA],
      'CMS save: 1 document(s)\n\nmodified authors/ana',
    );
    expect(ctx.revisions).toStrictEqual(
      new Map([['authors/ana', revisionOf(ANA_NEW)]]),
    );
    expect(ctx.rebuild).toBe(false);
  });

  it('makes the folder of a new file, and removes a deleted one', async () => {
    const siteFolder = await tempWorkingCopy({ [ANA]: ANA_TEXT });
    const ctx = saveContext({
      siteFolder,
      writeFile: writeFileAtomic,
      changes: [{ document: 'authors/ana', baseRevision: 'r', deleted: true }],
      bundle: bundleOf([documentOf('authors/ana', { file: ANA })]),
      documents: bundleOf([documentOf('authors/ana', { file: ANA })]).documents,
      plan: [
        { op: 'write', path: 'src/content/extra/lee.json', text: LEE_TEXT },
        { op: 'delete', path: ANA },
      ],
    });
    expect(await writeChanges(ctx)).toBeUndefined();
    expect(
      await readFile(join(siteFolder, 'src/content/extra/lee.json'), 'utf8'),
    ).toBe(LEE_TEXT);
    await expect(access(join(siteFolder, ANA))).rejects.toThrow('ENOENT');
    expect(ctx.tx.commitSave).toHaveBeenCalledWith(
      ['src/content/extra/lee.json', ANA],
      'CMS save: 1 document(s)\n\ndeleted authors/ana',
    );
    expect(ctx.revisions.size).toBe(0);
  });

  it('answers the revision of a created document, from the changeset after the commit', async () => {
    const siteFolder = await tempWorkingCopy({ [LEE]: LEE_TEXT });
    const repo = {
      ...emptyChangeset(),
      changedPaths: vi.fn(async () => [
        { path: LEE, status: 'created' as const },
      ]),
    };
    const ctx = saveContext({
      siteFolder,
      repo,
      bundle: bundleOf([], authorsCollections()),
      writeFile: writeFileAtomic,
      changes: [CREATE],
      plan: [{ op: 'write', path: LEE, text: LEE_TEXT }],
    });
    expect(await writeChanges(ctx)).toBeUndefined();
    expect(ctx.revisions).toStrictEqual(
      new Map([['authors/lee', revisionOf(LEE_TEXT)]]),
    );
  });

  it('answers save-committed, and logs the missing revision, when a created document is not in the changeset after the commit', async () => {
    const siteFolder = await tempWorkingCopy({ [LEE]: LEE_TEXT });
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const ctx = saveContext({
      siteFolder,
      log,
      bundle: bundleOf([], authorsCollections()),
      writeFile: writeFileAtomic,
      changes: [CREATE],
      plan: [{ op: 'write', path: LEE, text: LEE_TEXT }],
    });
    expect(await writeChanges(ctx)).toStrictEqual(SAVE_COMMITTED);
    expect(log.error).toHaveBeenCalledWith(
      'the revisions of a committed save could not be read',
      { reason: '"authors/lee" has no revision after the save' },
    );
  });

  it('answers save-committed, and logs the document, when its file is gone after the commit', async () => {
    const siteFolder = await tempWorkingCopy({ [ANA]: ANA_TEXT });
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const ctx = saveContext({
      siteFolder,
      writeFile: writeFileAtomic,
      changes: [UPDATE],
      bundle: bundleOf([documentOf('authors/ana', { file: ANA })]),
      documents: bundleOf([documentOf('authors/ana', { file: ANA })]).documents,
      plan: [{ op: 'delete', path: ANA }],
      log,
    });
    expect(await writeChanges(ctx)).toStrictEqual(SAVE_COMMITTED);
    expect(log.error).toHaveBeenCalledWith(
      'the revisions of a committed save could not be read',
      { reason: '"authors/ana" has no revision after the save' },
    );
  });

  it('answers save-committed when a shared file no longer parses after the commit, so the entry has no revision', async () => {
    const siteFolder = await tempWorkingCopy({ [SHARED]: SHARED_TEXT });
    const entry = documentOf('authors/ana', {
      file: SHARED,
      entryKey: 'ana',
    });
    const ctx = saveContext({
      siteFolder,
      writeFile: writeFileAtomic,
      changes: [UPDATE],
      bundle: bundleOf([entry]),
      documents: bundleOf([entry]).documents,
      plan: [{ op: 'write', path: SHARED, text: '{ "ana": ' }],
    });
    expect(await writeChanges(ctx)).toStrictEqual(SAVE_COMMITTED);
  });

  it('restores the planned paths and answers 500 when a write fails', async () => {
    const siteFolder = await tempWorkingCopy({ [ANA]: ANA_TEXT });
    const tx = fakeTx();
    let writes = 0;
    const ctx = saveContext({
      siteFolder,
      tx,
      writeFile: async (file, text) => {
        writes += 1;
        if (writes === 2) throw new Error('disk full');
        await writeFileAtomic(file, text);
      },
      changes: [UPDATE, CREATE],
      bundle: bundleOf([documentOf('authors/ana', { file: ANA })]),
      documents: bundleOf([documentOf('authors/ana', { file: ANA })]).documents,
      plan: [
        { op: 'write', path: ANA, text: ANA_NEW },
        { op: 'write', path: LEE, text: LEE_TEXT },
      ],
    });
    expect(await writeChanges(ctx)).toStrictEqual({
      status: 500,
      body: {
        error: 'save-failed',
        message: 'The save was not written: disk full',
      },
    });
    expect(tx.restore).toHaveBeenCalledWith([ANA, LEE]);
    expect(tx.commitSave).not.toHaveBeenCalled();
    expect(ctx.revisions.size).toBe(0);
  });

  it('restores the planned paths and answers 500 when the commit fails', async () => {
    const siteFolder = await tempWorkingCopy({ [ANA]: ANA_TEXT });
    const tx = fakeTx({
      commitSave: vi.fn(() => Promise.reject(new Error('commit refused'))),
    });
    const ctx = saveContext({
      siteFolder,
      tx,
      writeFile: writeFileAtomic,
      changes: [UPDATE],
      plan: [{ op: 'write', path: ANA, text: ANA_NEW }],
    });
    expect(await writeChanges(ctx)).toStrictEqual({
      status: 500,
      body: {
        error: 'save-failed',
        message: 'The save was not written: commit refused',
      },
    });
    expect(tx.restore).toHaveBeenCalledWith([ANA]);
  });

  it('keeps the write error in the answer when the restore after it fails too', async () => {
    const siteFolder = await tempWorkingCopy({ [ANA]: ANA_TEXT });
    const tx = fakeTx({
      restore: vi.fn(() => Promise.reject(new Error('lock lost'))),
    });
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const ctx = saveContext({
      siteFolder,
      tx,
      log,
      writeFile: async () => {
        throw new Error('disk full');
      },
      changes: [UPDATE],
      plan: [{ op: 'write', path: ANA, text: ANA_NEW }],
    });
    expect(await writeChanges(ctx)).toStrictEqual({
      status: 500,
      body: {
        error: 'save-failed',
        message:
          'The save was not written: disk full; the working copy could not be restored: lock lost',
      },
    });
    expect(log.error).toHaveBeenCalledWith(
      'the working copy could not be restored after a failed save',
      { reason: 'lock lost' },
    );
  });

  it('answers save-committed, not save-failed, when the revisions cannot be read after the commit', async () => {
    const siteFolder = await tempWorkingCopy({ [ANA]: ANA_TEXT });
    const tx = fakeTx();
    const bundle = bundleOf([documentOf('authors/ana', { file: ANA })]);
    const ctx = saveContext({
      siteFolder,
      tx,
      writeFile: writeFileAtomic,
      changes: [UPDATE],
      bundle,
      documents: bundle.documents,
      plan: [{ op: 'delete', path: ANA }],
    });
    expect(await writeChanges(ctx)).toStrictEqual({
      status: 500,
      body: {
        error: 'save-committed',
        message:
          'The save was committed, but its revisions could not be read. Reload the documents before the next save.',
      },
    });
    expect(tx.commitSave).toHaveBeenCalled();
    expect(tx.restore).not.toHaveBeenCalled();
  });

  it('runs every after-commit hook, and logs a hook that throws without failing the save', async () => {
    const siteFolder = await tempWorkingCopy({ [ANA]: ANA_TEXT });
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const broken = vi.fn(async () => {
      throw new Error('index broke');
    });
    const later = vi.fn(async () => {});
    const ctx = saveContext({
      siteFolder,
      log,
      writeFile: writeFileAtomic,
      changes: [UPDATE],
      bundle: bundleOf([documentOf('authors/ana', { file: ANA })]),
      documents: bundleOf([documentOf('authors/ana', { file: ANA })]).documents,
      afterCommit: [broken, later],
      plan: [{ op: 'write', path: ANA, text: ANA_NEW }],
    });
    expect(await writeChanges(ctx)).toBeUndefined();
    expect(log.error).toHaveBeenCalledWith(
      'an after-commit hook of the save failed',
      { reason: 'index broke' },
    );
    expect(later).toHaveBeenCalledWith(ctx);
  });

  it('sets the rebuild flag when a build-time field changed', async () => {
    const siteFolder = await tempWorkingCopy({ [ANA]: ANA_TEXT });
    const documents = [
      documentOf('authors/ana', {
        file: ANA,
        buildTime: true,
        buildTimeFields: ['name'],
      }),
    ];
    const ctx = saveContext({
      siteFolder,
      writeFile: writeFileAtomic,
      changes: [UPDATE],
      bundle: bundleOf(documents),
      documents: bundleOf(documents).documents,
      stored: new Map([['authors/ana', { name: 'Ana' }]]),
      plan: [{ op: 'write', path: ANA, text: ANA_NEW }],
    });
    expect(await writeChanges(ctx)).toBeUndefined();
    expect(ctx.rebuild).toBe(true);
  });
});

// A staged image (2.7d seam): its absolute staging path, and the site-relative target it is copied to.
const STAGED = '/staging/ana.png';
const PHOTO = 'public/images/ana.png';

describe('writeChanges with staged image copies', () => {
  it('copies each image before the text files, and commits the copy with them', async () => {
    const siteFolder = await tempWorkingCopy({ [ANA]: ANA_TEXT });
    const order: string[] = [];
    const copyFile = vi.fn(async (_from: string, to: string) => {
      order.push(`copy ${to}`);
    });
    const tx = fakeTx();
    const ctx = saveContext({
      siteFolder,
      tx,
      copyFile,
      writeFile: async (file, text) => {
        order.push(`write ${file}`);
        await writeFileAtomic(file, text);
      },
      changes: [UPDATE],
      documents: bundleOf([documentOf('authors/ana', { file: ANA })]).documents,
      copies: [{ from: STAGED, to: PHOTO }],
      plan: [{ op: 'write', path: ANA, text: ANA_NEW }],
    });
    expect(await writeChanges(ctx)).toBeUndefined();
    expect(order).toStrictEqual([
      `copy ${join(siteFolder, PHOTO)}`,
      `write ${join(siteFolder, ANA)}`,
    ]);
    expect(copyFile).toHaveBeenCalledWith(STAGED, join(siteFolder, PHOTO));
    expect(tx.commitSave).toHaveBeenCalledWith(
      [PHOTO, ANA],
      'CMS save: 1 document(s)\n\nmodified authors/ana',
    );
  });

  it('restores the copied image with the planned files when the commit fails', async () => {
    const siteFolder = await tempWorkingCopy({ [ANA]: ANA_TEXT });
    const copyFile = vi.fn(async () => {});
    const tx = fakeTx({
      commitSave: vi.fn(() => Promise.reject(new Error('commit refused'))),
    });
    const ctx = saveContext({
      siteFolder,
      tx,
      copyFile,
      writeFile: writeFileAtomic,
      changes: [UPDATE],
      copies: [{ from: STAGED, to: PHOTO }],
      plan: [{ op: 'write', path: ANA, text: ANA_NEW }],
    });
    expect(await writeChanges(ctx)).toStrictEqual({
      status: 500,
      body: {
        error: 'save-failed',
        message: 'The save was not written: commit refused',
      },
    });
    expect(copyFile).toHaveBeenCalledTimes(1);
    expect(tx.restore).toHaveBeenCalledWith([PHOTO, ANA]);
  });

  it('restores the copied image when a copy fails, before any text file is written', async () => {
    const siteFolder = await tempWorkingCopy({ [ANA]: ANA_TEXT });
    const writeFile = vi.fn(async () => {});
    const tx = fakeTx();
    const ctx = saveContext({
      siteFolder,
      tx,
      copyFile: vi.fn(async () => {
        throw new Error('disk full');
      }),
      writeFile,
      changes: [UPDATE],
      copies: [{ from: STAGED, to: PHOTO }],
      plan: [{ op: 'write', path: ANA, text: ANA_NEW }],
    });
    expect(await writeChanges(ctx)).toStrictEqual({
      status: 500,
      body: {
        error: 'save-failed',
        message: 'The save was not written: disk full',
      },
    });
    expect(writeFile).not.toHaveBeenCalled();
    expect(tx.commitSave).not.toHaveBeenCalled();
    expect(tx.restore).toHaveBeenCalledWith([PHOTO, ANA]);
  });

  it('copies a target that two copies name once, and lists its path once', async () => {
    const siteFolder = await tempWorkingCopy({ [ANA]: ANA_TEXT });
    const copyFile = vi.fn(async () => {});
    const tx = fakeTx();
    const ctx = saveContext({
      siteFolder,
      tx,
      copyFile,
      writeFile: writeFileAtomic,
      changes: [UPDATE],
      documents: bundleOf([documentOf('authors/ana', { file: ANA })]).documents,
      copies: [
        { from: STAGED, to: PHOTO },
        { from: STAGED, to: PHOTO },
      ],
      plan: [{ op: 'write', path: ANA, text: ANA_NEW }],
    });
    expect(await writeChanges(ctx)).toBeUndefined();
    expect(copyFile).toHaveBeenCalledTimes(1);
    expect(tx.commitSave).toHaveBeenCalledWith(
      [PHOTO, ANA],
      'CMS save: 1 document(s)\n\nmodified authors/ana',
    );
  });

  it('copies nothing and lists only the text files when no image is staged', async () => {
    const siteFolder = await tempWorkingCopy({ [ANA]: ANA_TEXT });
    const copyFile = vi.fn(async () => {});
    const tx = fakeTx();
    const ctx = saveContext({
      siteFolder,
      tx,
      copyFile,
      writeFile: writeFileAtomic,
      changes: [UPDATE],
      documents: bundleOf([documentOf('authors/ana', { file: ANA })]).documents,
      plan: [{ op: 'write', path: ANA, text: ANA_NEW }],
    });
    expect(await writeChanges(ctx)).toBeUndefined();
    expect(copyFile).not.toHaveBeenCalled();
    expect(tx.commitSave).toHaveBeenCalledWith(
      [ANA],
      'CMS save: 1 document(s)\n\nmodified authors/ana',
    );
  });
});

describe('copyFileAtomic', () => {
  it('copies the bytes of a file to a new path, and keeps the original', async () => {
    const siteFolder = await tempWorkingCopy({
      'staging/ana.png': 'PNG bytes',
    });
    await copyFileAtomic(
      join(siteFolder, 'staging/ana.png'),
      join(siteFolder, 'staging/copy.png'),
    );
    expect(await readFile(join(siteFolder, 'staging/copy.png'), 'utf8')).toBe(
      'PNG bytes',
    );
    expect(await readFile(join(siteFolder, 'staging/ana.png'), 'utf8')).toBe(
      'PNG bytes',
    );
  });

  it('rejects with the system error when the source is missing', async () => {
    const siteFolder = await tempWorkingCopy({ 'staging/keep.txt': 'x' });
    await expect(
      copyFileAtomic(
        join(siteFolder, 'staging/missing.png'),
        join(siteFolder, 'staging/copy.png'),
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('commitMessageOf', () => {
  it('has the count as its subject, and one status line per document', () => {
    const changes: SaveChange[] = [
      CREATE,
      UPDATE,
      { document: 'authors/old', baseRevision: 'r', deleted: true },
    ];
    expect(commitMessageOf(changes)).toBe(
      'CMS save: 3 document(s)\n\ncreated authors/lee\nmodified authors/ana\ndeleted authors/old',
    );
  });
});
