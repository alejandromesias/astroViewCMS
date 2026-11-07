import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findReports, loadCounts, readPlan, writePlan } from './stryker-reports.ts';

// Each test gets its own root, as a finished run leaves it: <root>/<group>/mutation/triage-<group>.json.
let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'stryker-reports-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeReport(group: string, files: Record<string, string[]>): void {
  const folder = path.join(root, group, 'mutation');
  mkdirSync(folder, { recursive: true });
  const report = {
    files: Object.fromEntries(
      Object.entries(files).map(([file, statuses]) => [file, { mutants: statuses.map((status) => ({ status })) }]),
    ),
  };
  writeFileSync(path.join(folder, `triage-${group}.json`), JSON.stringify(report));
}

describe('findReports', () => {
  it('finds the group reports, and nothing else', () => {
    writeReport('serve', { 'preview-render-server/src/serve/static.ts': ['Killed'] });
    writeFileSync(path.join(root, 'summary.json'), '{}');
    mkdirSync(path.join(root, 'serve', 'reports'), { recursive: true });
    writeFileSync(path.join(root, 'serve', 'reports', 'stryker-triage-serve.json'), '{}');
    expect(findReports(root).map((found) => found.group)).toEqual(['serve']);
  });

  it('finds nothing in a folder that does not exist', () => {
    expect(findReports(path.join(root, 'missing'))).toEqual([]);
  });
});

describe('loadCounts', () => {
  it('merges the counts of every group and names the groups that reported', () => {
    writeReport('serve', { 'preview-render-server/src/serve/static.ts': ['Killed', 'Survived'] });
    writeReport('protocol', { 'preview-protocol/src/index.ts': ['Killed', 'Timeout'] });
    const loaded = loadCounts(root);
    expect(loaded.reported).toEqual(new Set(['protocol', 'serve']));
    expect(loaded.counts.get('preview-protocol/src/index.ts')).toEqual({ detected: 2, valid: 2 });
    expect(loaded.counts.get('preview-render-server/src/serve/static.ts')).toEqual({ detected: 1, valid: 2 });
  });

  it('throws when one file is in two group reports', () => {
    writeReport('serve', { 'preview-render-server/src/serve/static.ts': ['Killed'] });
    writeReport('preview', { 'preview-render-server/src/serve/static.ts': ['Killed'] });
    expect(() => loadCounts(root)).toThrow('preview-render-server/src/serve/static.ts is in two group reports');
  });
});

describe('readPlan and writePlan', () => {
  it('reads back the plan that was written', () => {
    const file = writePlan(root, {
      base: 'origin/main',
      mergeBase: 'abc',
      groups: { protocol: ['preview-protocol/src/index.ts'] },
      dropped: ['DOCS/x.md'],
    });
    expect(readPlan(file)).toEqual({
      groups: { protocol: ['preview-protocol/src/index.ts'] },
      dropped: ['DOCS/x.md'],
    });
  });

  it('throws for a file that is not a plan', () => {
    const file = path.join(root, 'plan.json');
    writeFileSync(file, JSON.stringify({ groups: { protocol: 'index.ts' }, dropped: [] }));
    expect(() => readPlan(file)).toThrow(`${file}: group protocol has no file list`);
  });

  it('says to run stryker-changed first when there is no plan', () => {
    expect(() => readPlan(path.join(root, 'plan.json'))).toThrow('run scripts/stryker-changed.ts first');
  });
});
