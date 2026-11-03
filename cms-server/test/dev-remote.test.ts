// The pure parts of scripts/dev-remote.ts: the config it writes and the remote it seeds. The script's
// main() runs only when the file is run directly, so importing it here has no side effects.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderConfig, seedRemote } from '../scripts/dev-remote.ts';
import { git, makeTestRoot, removeTestRoot } from './helpers/git.ts';

const EXAMPLE = [
  'export default {',
  "  site: 'sample-site',",
  "  remote: 'https://github.com/OWNER/REPO.git',",
  '};',
  '',
].join('\n');

describe('renderConfig', () => {
  it('replaces the remote line, keeping its indent, and nothing else', () => {
    expect(renderConfig(EXAMPLE, '/work/.dev/remote.git')).toBe(
      [
        'export default {',
        "  site: 'sample-site',",
        '  remote: "/work/.dev/remote.git",',
        '};',
        '',
      ].join('\n'),
    );
  });

  it.each([
    ['no remote line', 'export default {};\n', 0],
    ['two remote lines', "  remote: 'a',\n  remote: 'b',\n", 2],
  ])('refuses an example with %s', (_case, example, found) => {
    expect(() => renderConfig(example, '/x.git')).toThrow(
      new Error(
        `cms.config.example.ts must have one remote line, found ${found}`,
      ),
    );
  });
});

describe('seedRemote', () => {
  it('seeds a bare repo with one commit of the site, and leaves an existing remote alone', async () => {
    const root = await makeTestRoot();
    try {
      const site = join(root, 'site');
      await mkdir(join(site, 'src'), { recursive: true });
      await mkdir(join(site, 'node_modules'), { recursive: true });
      await writeFile(join(site, 'src', 'page.txt'), 'hello\n');
      await writeFile(join(site, 'node_modules', 'skipped.txt'), 'no\n');
      const remote = join(root, 'remote.git');

      seedRemote(remote, site);
      expect(await git(remote, ['show', 'main:src/page.txt'])).toBe('hello\n');
      await expect(
        git(remote, ['cat-file', '-e', 'main:node_modules/skipped.txt']),
      ).rejects.toThrow(
        'git cat-file -e main:node_modules/skipped.txt failed: ',
      );

      seedRemote(remote, site);
      expect((await git(remote, ['rev-list', '--count', 'main'])).trim()).toBe(
        '1',
      );
    } finally {
      await removeTestRoot(root);
    }
  });
});
