import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';

const notes = defineCollection({ schema: z.object({ text: z.string() }) });

export const collections = { notes };
