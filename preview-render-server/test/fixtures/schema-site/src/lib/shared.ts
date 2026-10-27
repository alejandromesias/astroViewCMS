import { z } from 'astro/zod';

// A helper the content config imports through the "@/" alias.
export const slug = z.string().regex(/^[a-z0-9-]+$/);
