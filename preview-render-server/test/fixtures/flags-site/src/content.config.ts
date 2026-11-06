import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

// `fixtures` is read-only in the test site; `people` sets its own ids (WORKPLAN 2.0j).
const fixtures = defineCollection({
  loader: glob({ pattern: '**/*.json', base: 'src/content/fixtures' }),
});

const people = defineCollection({
  loader: glob({
    pattern: '**/*.json',
    base: 'src/content/people',
    generateId: ({ data }: { data: { name: string } }) => data.name,
  }),
});

export const collections = { fixtures, people };
