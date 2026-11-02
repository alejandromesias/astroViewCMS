// The browser suite's harness page is served here (vitest.browser.config.ts).
// The node lists this origin as an editor origin (PREVIEW_EDITOR_ORIGINS, set by
// global-setup.ts), so the bridge accepts the harness's messages, as it does an
// editor in the product.
export const HARNESS_PORT = 5174;
export const HARNESS_ORIGIN = `http://localhost:${HARNESS_PORT}`;
