import { reference } from 'astro:content';

// A helper that imports from astro:content itself: the stubs must reach it.
export const authorRef = reference('authors');
