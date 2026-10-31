// End-to-end decision tests for D13: supported formats. A YAML author, a YAML
// file() collection with dates, one-file-per-entry YAML partners, and the
// authors listing that mixes JSON and YAML documents.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, inject, it } from 'vitest';

const BASE = inject('baseUrl');
const CLIENT = path.join(inject('buildDir'), 'sample-site', 'client');
// The YAML author as src/content/authors/noor-haddad.yaml holds it.
const readYamlAuthor = () => ({
  name: 'Noor Haddad',
  role: 'Staff Writer',
  bio: 'Noor writes about editorial tooling and plain-language documentation.',
  avatar: '../../assets/authors/noor-haddad.png',
});

async function post(route: string, body: unknown, search = '') {
  const response = await fetch(`${BASE}/__preview/${route}${search}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    json: response.headers.get('content-type')?.includes('json')
      ? (JSON.parse(text) as any)
      : undefined,
  };
}

const render = (path_: string, documents: Record<string, unknown>) =>
  post('render', { documents }, `?path=${encodeURIComponent(path_)}`);

// `key` of each error, as `document:field.path`.
const failures = (json: { errors: { key: string; path: string[] }[] }) =>
  json.errors.map((e) => `${e.key}:${e.path.join('.')}`);

// The stats entries of the home page, in order.
const statsOf = (html: string) =>
  [
    ...html.matchAll(
      /<dt>([^<]*)<\/dt>\s*<dd class="h2">([^<]*)<\/dd>\s*<dd class="text-sm">\s*Updated (\d{4}-\d{2}-\d{2})/g,
    ),
  ].map(([, label, value, updated]) => ({ label, value, updated }));

// The partner names of the home page, in order.
const partnersOf = (html: string) =>
  [
    ...html.matchAll(/<span class="block text-sm">\s*([^<]*?), since \d{4}/g),
  ].map(([, name]) => name);

const builtPage = (urlPath: string) =>
  fs.readFileSync(path.join(CLIENT, urlPath, 'index.html'), 'utf8');

// The file() loader orders entries by id: editors, sites, uptime.
const BUILT_STATS = [
  { label: 'Active editors', value: '1,800', updated: '2026-09-14' },
  { label: 'Sites launched', value: '240+', updated: '2026-09-01' },
  { label: 'Uptime', value: '99.98%', updated: '2026-10-01' },
];

describe('D13: a draft of the YAML author changes the post that references it', () => {
  it('blog-5 by noor-haddad (YAML) shows the drafted name', async () => {
    const { status, json } = await render('/blog/blog-5', {
      'authors/noor-haddad': { ...readYamlAuthor(), name: 'Noor H. (draft)' },
    });
    expect(status).toBe(200);
    expect(json.html).toContain('<p class="h5 mb-0">Noor H. (draft)</p>');
    expect(json.documents).toContain('authors/noor-haddad');
  });

  it('near miss: the same draft does not change a post by another author', async () => {
    const { status, json } = await render('/blog/blog-1', {
      'authors/noor-haddad': { ...readYamlAuthor(), name: 'Noor H. (draft)' },
    });
    expect(status).toBe(200);
    expect(json.html).toContain('<p class="h5 mb-0">Ana Torres</p>');
    expect(json.html).not.toContain('Noor H. (draft)');
  });
});

describe('D13: a draft of one stats entry', () => {
  it('changes only that entry, and its ISO-string updated passes the plain z.date()', async () => {
    const { status, json } = await render('/landing/home-v2', {
      'stats/sites': {
        id: 'sites',
        label: 'Sites launched',
        value: '250+',
        updated: '2026-11-05T00:00:00.000Z',
      },
    });
    expect(status).toBe(200);
    expect(statsOf(json.html)).toEqual([
      BUILT_STATS[0],
      { label: 'Sites launched', value: '250+', updated: '2026-11-05' },
      BUILT_STATS[2],
    ]);
    expect(json.documents).toContain('stats/sites');
    expect(json.limits).toEqual([]);
  });

  it('near miss: the same page with no stats draft shows the built entries', async () => {
    const { status, json } = await render('/landing/home-v2', {});
    expect(status).toBe(200);
    expect(statsOf(json.html)).toEqual(BUILT_STATS);
  });

  it('a draft updated that is not a date still fails, with its field path', async () => {
    const { status, json } = await render('/landing/home-v2', {
      'stats/sites': {
        id: 'sites',
        label: 'Sites launched',
        value: '250+',
        updated: 'not a date',
      },
    });
    expect(status).toBe(422);
    expect(failures(json)).toEqual(['stats/sites:updated']);
  });
});

describe('D13: a partners draft reorders the block', () => {
  it('moves the drafted partner to its new place in the order', async () => {
    const { status, json } = await render('/landing/home-v2', {
      'partners/atlas': {
        name: 'Atlas Studio',
        logo: '../../assets/partners/atlas.png',
        url: 'https://example.com/atlas',
        order: 0,
        since: '2022-01-20T00:00:00.000Z',
      },
    });
    expect(status).toBe(200);
    const built = partnersOf(builtPage('landing/home-v2'));
    expect(partnersOf(json.html)).toEqual([
      'Atlas Studio',
      ...built.filter((name) => name !== 'Atlas Studio'),
    ]);
    expect(partnersOf(json.html)[0]).toBe('Atlas Studio');
  });

  it('near miss: with no partners draft the built order stands', async () => {
    const { json } = await render('/landing/home-v2', {});
    expect(partnersOf(json.html)).toEqual(
      partnersOf(builtPage('landing/home-v2')),
    );
  });
});

describe('D13: the authors listing mixes JSON and YAML entries', () => {
  it('documents.json lists each author with its own format', () => {
    const documents = JSON.parse(
      fs.readFileSync(
        path.join(inject('buildDir'), 'sample-site-manifest', 'documents.json'),
        'utf8',
      ),
    ) as { key: string; format: string; editable?: false }[];
    const authors = documents
      .filter((doc) => doc.key.startsWith('authors/'))
      .map((doc) => [doc.key, doc.format, doc.editable ?? true])
      .sort(([a], [b]) => (a as string).localeCompare(b as string));
    expect(authors).toEqual([
      ['authors/ana-torres', 'json', true],
      ['authors/kofi-mensah', 'json', true],
      ['authors/lena-fischer', 'json', true],
      ['authors/marco-rossi', 'json', true],
      ['authors/noor-haddad', 'yaml', true],
    ]);
  });

  it('the test-only fixtures collection is listed as not editable', () => {
    const documents = JSON.parse(
      fs.readFileSync(
        path.join(inject('buildDir'), 'sample-site-manifest', 'documents.json'),
        'utf8',
      ),
    ) as { key: string; format: string; editable?: false }[];
    const fixtures = documents
      .filter((doc) => doc.key.startsWith('fixtures/'))
      .map((doc) => [doc.key, doc.format, doc.editable ?? true]);
    expect(fixtures).toEqual([['fixtures/define-vars', 'json', false]]);
  });

  it('a JSON author and a YAML author both render from the same collection', async () => {
    const json = await render('/blog/blog-1', {});
    expect(json.json.documents).toContain('authors/ana-torres');
    const yaml = await render('/blog/blog-5', {});
    expect(yaml.json.documents).toContain('authors/noor-haddad');
    expect(yaml.json.html).toContain('<p class="h5 mb-0">Noor Haddad</p>');
  });
});
