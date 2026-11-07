// Maps changed source files to Stryker triage groups (WORKPLAN 2.1l). Each group has its own Stryker
// config (stryker.<group>.config.mjs), which runs only the Vitest tests that cover the group. Pure: the
// caller reads git and the file system, so these rules are tested without either.
import { existsSync } from 'node:fs';
import path from 'node:path';

// First matching rule wins. Prefixes are repo-relative with forward slashes. Every file the base
// Stryker config mutates must match a rule; planFiles throws for any that does not.
const RULES: ReadonlyArray<{ group: string; prefixes: readonly string[] }> = [
  {
    group: 'serve',
    prefixes: [
      'preview-render-server/src/serve/',
      'preview-render-server/src/preview-config.ts',
    ],
  },
  { group: 'preview', prefixes: ['preview-render-server/src/manifest/'] },
  { group: 'renderer', prefixes: ['preview-render-server/src/'] },
  { group: 'protocol', prefixes: ['preview-protocol/src/'] },
  { group: 'contract', prefixes: ['preview-contract/src/'] },
  { group: 'cms-server', prefixes: ['cms-server/src/'] },
];

export const GROUP_NAMES: readonly string[] = RULES.map((rule) => rule.group);

export function groupOf(file: string): string | undefined {
  return RULES.find((rule) =>
    rule.prefixes.some((prefix) => file.startsWith(prefix)),
  )?.group;
}

// True when the base config's `mutate` list selects the file: some pattern matches, and no `!` pattern does.
export function isMutated(file: string, patterns: readonly string[]): boolean {
  let included = false;
  for (const pattern of patterns) {
    if (pattern.startsWith('!')) {
      if (path.posix.matchesGlob(file, pattern.slice(1))) return false;
    } else if (path.posix.matchesGlob(file, pattern)) {
      included = true;
    }
  }
  return included;
}

// The source a changed file stands for: a changed foo.test.ts counts as a change to foo.ts (only when
// foo.ts exists); a changed .ts file is its own source; anything else has no source.
export function sourceOf(
  changed: string,
  exists: (file: string) => boolean = existsSync,
): string | undefined {
  const TEST = '.test.ts';
  if (changed.endsWith(TEST)) {
    const source = `${changed.slice(0, -TEST.length)}.ts`;
    return exists(source) ? source : undefined;
  }
  return changed.endsWith('.ts') ? changed : undefined;
}

export interface Plan {
  // Source files per group, sorted. A group with no file is left out.
  groups: Record<string, string[]>;
  // Changed files that are not mutated: not TypeScript, outside the mutate list, or a test with no source.
  dropped: string[];
}

export function planFiles(
  changed: readonly string[],
  patterns: readonly string[],
  exists: (file: string) => boolean = existsSync,
): Plan {
  const sources = new Set<string>();
  const dropped: string[] = [];
  for (const file of changed) {
    const source = sourceOf(file, exists);
    if (source === undefined || !isMutated(source, patterns)) {
      dropped.push(file);
      continue;
    }
    sources.add(source);
  }
  const byGroup = new Map<string, string[]>();
  for (const source of [...sources].sort()) {
    const group = groupOf(source);
    if (group === undefined) {
      throw new Error(
        `no Stryker group for ${source}; add a rule in scripts/lib/stryker-plan.ts`,
      );
    }
    byGroup.set(group, [...(byGroup.get(group) ?? []), source]);
  }
  return {
    groups: Object.fromEntries(
      GROUP_NAMES.filter((name) => byGroup.has(name)).map((name) => [
        name,
        byGroup.get(name) ?? [],
      ]),
    ),
    dropped: dropped.sort(),
  };
}
