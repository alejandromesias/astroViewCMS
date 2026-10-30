// End-to-end decision tests for slash ids, hostile document keys (D10), and
// the phase 1 MDX preview limit (D11).
import { describe, expect, inject, it } from 'vitest';

const BASE = inject('baseUrl');

interface Rendered {
  html: string;
  documents: string[];
  limits: string[];
}

const render = async (page: string, documents: Record<string, unknown>) => {
  const response = await fetch(
    `${BASE}/__preview/render?path=${encodeURIComponent(page)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ documents }),
    },
  );
  return { status: response.status, json: (await response.json()) as Rendered };
};

describe('decision tests D10 and D11', () => {
  it('renders a slash id and keeps prototype-named overlay keys as data', async () => {
    const documents = JSON.parse(
      '{"blog/generated/post-001":{"data":{"title":"D10 slash draft","description":"D10 description","date":"2026-10-30T00:00:00.000Z","author":"ana-torres","tags":["design"],"draft":false},"body":"D10 body marker."},"blog/__proto__":{"data":{"title":"D10 proto near miss"},"body":"proto"},"blog/constructor":{"data":{"title":"D10 constructor near miss"},"body":"constructor"},"__proto__":{"title":"D10 root proto key"},"constructor":{"title":"D10 root constructor key"}}',
    ) as Record<string, unknown>;

    const { status, json } = await render(
      '/blog/generated/post-001',
      documents,
    );

    expect(status).toBe(200);
    expect(json.html).toContain(
      '<h1 class="h2 text-left my-6">D10 slash draft',
    );
    expect(json.html).toContain('D10 body marker.');
    expect(json.html).not.toContain('D10 proto near miss');
    expect(json.html).not.toContain('D10 constructor near miss');
    expect(json.html).not.toContain('D10 root proto key');
    expect(json.html).not.toContain('D10 root constructor key');
    expect(json.documents).toContain('blog/generated/post-001');
    expect(json.limits).toEqual([]);
  });

  // Phase 1 behaviour. The restricted renderer (D11, phase 3) replaces this test:
  // a draft body will render, and only a placeholder case answers mdx-body.
  it('an MDX draft shows the new frontmatter, keeps the saved body and reports mdx-body', async () => {
    const { status, json } = await render('/elements', {
      'pages/elements': {
        data: {
          title: 'D11 frontmatter draft',
          meta_title: '',
          description: 'D11 description',
          draft: false,
        },
        body: '# D11 unsaved body marker',
      },
    });

    expect(status).toBe(200);
    expect(json.html).toContain(
      '<h1 class="h2 mb-8 text-center">D11 frontmatter draft',
    );
    expect(json.html).toContain('<h1 id="heading-1">Heading 1');
    expect(json.html).not.toContain('D11 unsaved body marker');
    expect(json.documents).toContain('pages/elements');
    expect(json.limits).toEqual(['mdx-body']);
  });

  it('a Markdown draft renders its new body and reports no limit (near miss)', async () => {
    const { status, json } = await render('/blog/blog-1', {
      'blog/blog-1': {
        data: {
          title: 'D11 markdown near miss',
          date: '2025-07-01T05:00:00Z',
          author: 'ana-torres',
          tags: ['design'],
          draft: false,
        },
        body: 'D11 markdown body marker.\n',
      },
    });

    expect(status).toBe(200);
    expect(json.html).toContain('D11 markdown body marker.');
    expect(json.limits).toEqual([]);
  });
});
