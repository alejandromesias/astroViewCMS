// Lets tsc type the tests' imports of .astro fixtures (Vite compiles them;
// Astro's own types leave .astro imports to its editor plugin).
declare module '*.astro' {
  import type { AstroComponentFactory } from 'astro/runtime/server/index.js';

  const component: AstroComponentFactory;
  export default component;
}
