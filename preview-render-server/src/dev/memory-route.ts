// GET /__dev/memory: process.memoryUsage() after a forced GC, for the memory
// budget e2e test (QUALITY-TOOLING-PLAN.md step 7c). Injected only when the
// build runs with PREVIEW_DEV=1. `gc` exists only if the server was started
// with --expose-gc; without it the numbers include garbage.
import type { APIRoute } from 'astro';

export const prerender = false;

export const ALL: APIRoute = () => {
  const gc = (globalThis as { gc?: () => void }).gc;
  gc?.();
  return Response.json({ ...process.memoryUsage(), gc: gc !== undefined });
};
