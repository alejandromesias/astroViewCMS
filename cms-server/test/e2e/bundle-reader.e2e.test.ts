// End-to-end (WORKPLAN 2.4a): the bundle reader reads a real build of sample-site, and the
// committed fixture still names the same collections as that build (it is a trimmed copy and
// would otherwise drift when the sample changes).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, inject, it } from 'vitest';
import { readBundle } from '../../src/bundle/read.ts';
import { directoryBundleSource } from '../../src/bundle/source.ts';

const FIXTURE = path.resolve(import.meta.dirname, '../fixtures/bundle');
const names = (schemaFile: string): string[] =>
  Object.keys(JSON.parse(fs.readFileSync(schemaFile, 'utf8'))).sort();

describe('the bundle reader on a real build', () => {
  const dir = path.join(inject('bundleDir'), 'manifest');

  it('reads all five files', async () => {
    const ref = await directoryBundleSource(dir).current();
    if (ref === null) throw new Error('no bundle.json in the build');
    expect(ref.identity.bundleId).toBe('e2e-first');
    const bundle = await readBundle(ref.dir, ref.identity);
    expect(bundle.documents.size).toBeGreaterThan(0);
  });

  it('the fixture names the same collections as the real schema.json', () => {
    expect(names(path.join(FIXTURE, 'schema.json'))).toEqual(
      names(path.join(dir, 'schema.json')),
    );
  });
});
