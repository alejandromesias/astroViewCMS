import { defineCollection, reference } from 'astro:content';
import { file, glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { authorRef } from '@/lib/refs';
import { slug } from '@/lib/shared';

const authors = defineCollection({
  loader: glob({ pattern: '**/*.json', base: 'src/content/authors' }),
  schema: ({ image }) => z.object({ name: z.string(), avatar: image() }),
});

const quotes = defineCollection({
  loader: file('src/content/quotes.json'),
  schema: z.object({ text: z.string() }),
});

const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: 'src/content/posts' }),
  schema: z.object({
    slug,
    author: authorRef.optional(),
    blocks: z.array(
      z.discriminatedUnion('type', [
        z.object({ type: z.literal('quote'), items: z.array(reference('quotes')) }),
        z.object({ type: z.literal('text'), body: z.string() }),
      ]),
    ),
  }),
});

export const collections = { authors, quotes, posts };
