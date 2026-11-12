import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  GROUP_NAMES,
  groupOf,
  isMutated,
  planFiles,
  sourceOf,
} from './stryker-plan.ts';

// The base config's `mutate` list, as stryker.config.json has it.
const MUTATE = [
  'preview-contract/src/**/*.ts',
  '!preview-contract/src/**/*.test.ts',
  'preview-protocol/src/**/*.ts',
  '!preview-protocol/src/**/*.test.ts',
  'cms-server/src/**/*.ts',
  '!cms-server/src/**/*.test.ts',
  'cms-server/editor/**/*.ts',
  '!cms-server/editor/**/*.test.ts',
  'preview-render-server/src/**/*.ts',
  '!preview-render-server/src/**/*.test.ts',
  '!preview-render-server/src/**/*.d.ts',
  '!preview-render-server/src/types.ts',
  '!preview-render-server/src/build.ts',
];

describe('groupOf', () => {
  it.each([
    ['preview-render-server/src/serve/static.ts', 'serve'],
    ['preview-render-server/src/preview-config.ts', 'serve'],
    ['preview-render-server/src/manifest/documents.ts', 'preview'],
    ['preview-render-server/src/render/envelope.ts', 'renderer'],
    ['preview-protocol/src/index.ts', 'protocol'],
    ['preview-contract/src/revision.ts', 'contract'],
    ['cms-server/src/git/repo.ts', 'cms-git'],
    ['cms-server/src/git/ops.ts', 'cms-git-ops'],
    ['cms-server/src/preview/supervisor.ts', 'cms-preview'],
    ['cms-server/src/save/write.ts', 'cms-save'],
    ['cms-server/src/documents/paths.ts', 'cms-documents'],
    ['cms-server/src/codecs/yaml.ts', 'cms-codecs'],
    ['cms-server/src/schema/walk.ts', 'cms-codecs'],
    ['cms-server/src/http/changes-routes.ts', 'cms-server'],
    ['cms-server/src/run.ts', 'cms-server'],
    ['cms-server/editor/editor.ts', 'cms-editor'],
  ])('puts %s in group %s', (file, group) => {
    expect(groupOf(file)).toBe(group);
  });

  it('has no group for a file outside every package source folder', () => {
    expect(groupOf('sample-site/src/pages/index.ts')).toBeUndefined();
    expect(groupOf('cms-server/test/helpers/x.ts')).toBeUndefined();
  });

  it('does not take a sibling folder whose name starts the same way', () => {
    // `serve` must match its folder, not `serve-extra/`.
    expect(groupOf('preview-render-server/src/serve-extra/x.ts')).toBe(
      'renderer',
    );
  });
});

describe('the cms-server groups', () => {
  it('cover every folder of cms-server/src, so a new folder lands in the rest group and not nowhere', () => {
    expect(GROUP_NAMES).toEqual([
      'serve',
      'preview',
      'renderer',
      'protocol',
      'contract',
      'cms-preview',
      'cms-save',
      'cms-documents',
      'cms-git-ops',
      'cms-git',
      'cms-codecs',
      'cms-server',
      'cms-editor',
    ]);
    expect(groupOf('cms-server/src/brand-new/x.ts')).toBe('cms-server');
    expect(groupOf('cms-server/editor/brand-new.ts')).toBe('cms-editor');
  });

  it('has a Stryker config for every group', () => {
    for (const group of GROUP_NAMES) {
      expect(
        existsSync(
          new URL(`../../stryker.${group}.config.mjs`, import.meta.url),
        ),
      ).toBe(true);
    }
  });
});

describe('isMutated', () => {
  it('selects a source file and drops its test, declaration file and excluded entrypoint', () => {
    expect(isMutated('cms-server/src/git/repo.ts', MUTATE)).toBe(true);
    expect(isMutated('cms-server/src/git/repo.test.ts', MUTATE)).toBe(false);
    expect(isMutated('preview-render-server/src/virtual.d.ts', MUTATE)).toBe(
      false,
    );
    expect(isMutated('preview-render-server/src/build.ts', MUTATE)).toBe(false);
  });

  it('drops a file outside every pattern, including a near miss of one', () => {
    expect(isMutated('cms-server/test/helpers/x.ts', MUTATE)).toBe(false);
    expect(isMutated('cms-server/src/git/repo.js', MUTATE)).toBe(false);
    expect(isMutated('preview-render-server/src/build.tsx', MUTATE)).toBe(
      false,
    );
  });
});

describe('sourceOf', () => {
  const exists = (file: string): boolean =>
    file === 'cms-server/src/git/repo.ts';

  it('takes a changed test file to its source when the source exists', () => {
    expect(sourceOf('cms-server/src/git/repo.test.ts', exists)).toBe(
      'cms-server/src/git/repo.ts',
    );
  });

  it('has no source for a test file whose source is gone', () => {
    expect(sourceOf('cms-server/src/git/gone.test.ts', exists)).toBeUndefined();
  });

  it('is its own source for a TypeScript file, and none for another file', () => {
    expect(sourceOf('cms-server/src/git/repo.ts', exists)).toBe(
      'cms-server/src/git/repo.ts',
    );
    expect(sourceOf('cms-server/src/git/repo.json', exists)).toBeUndefined();
    expect(sourceOf('DOCS/x.md', exists)).toBeUndefined();
  });
});

describe('planFiles', () => {
  const exists = (file: string): boolean =>
    file.startsWith('cms-server/src/') || file.startsWith('preview-');

  it('groups the changed sources, sorted, and lists what it drops', () => {
    const plan = planFiles(
      [
        'preview-render-server/src/serve/static.ts',
        'cms-server/src/git/repo.ts',
        'cms-server/src/git/repo.test.ts',
        'cms-server/src/git/repo.test.ts',
        'DOCS/WORKPLAN-PHASE-2.md',
        'preview-render-server/src/types.ts',
        'preview-render-server/src/build.ts',
      ],
      MUTATE,
      exists,
    );
    expect(plan).toEqual({
      groups: {
        serve: ['preview-render-server/src/serve/static.ts'],
        'cms-git': ['cms-server/src/git/repo.ts'],
      },
      dropped: [
        'DOCS/WORKPLAN-PHASE-2.md',
        'preview-render-server/src/build.ts',
        'preview-render-server/src/types.ts',
      ],
    });
  });

  it('gives an empty plan for no changed file', () => {
    expect(planFiles([], MUTATE, exists)).toEqual({ groups: {}, dropped: [] });
  });

  it('throws when a mutated file has no group, so a new package cannot be skipped silently', () => {
    expect(() =>
      planFiles(
        ['sample-site/src/x.ts'],
        ['sample-site/src/**/*.ts'],
        () => true,
      ),
    ).toThrow('no Stryker group for sample-site/src/x.ts');
  });
});
