import { Hono } from 'hono';

// What the routes need from the outside. Empty in 2.1a; each route group adds its own field.
export type AppDeps = Readonly<Record<string, never>>;

// Hono only routes (PHASE-2-DESIGN 4.1): the modules behind the routes don't import Hono.
export function createApp(_deps: AppDeps): Hono {
  const app = new Hono();
  app.notFound((c) => c.json({ error: 'not_found' }, 404));
  return app;
}
