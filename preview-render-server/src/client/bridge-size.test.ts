// Size budget of the bridge (QUALITY-TOOLING-PLAN.md step 7a). The bridge is
// added to every page of the preview, so its weight is paid on each render.
// The budget is the measured size plus about 20%; raise it on purpose, not to
// make a failing test pass.
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { rolldown } from 'rolldown';
import { expect, it } from 'vitest';

const BRIDGE = new URL('./bridge.ts', import.meta.url);
const MEASURED_GZIP_BYTES = 5318;
const BUDGET_GZIP_BYTES = 6400;

async function bundledBridge(): Promise<Buffer> {
  const bundle = await rolldown({
    input: fileURLToPath(BRIDGE),
    platform: 'browser',
    logLevel: 'warn',
  });
  const { output } = await bundle.generate({ format: 'esm', minify: true });
  await bundle.close();
  return Buffer.from(output[0].code);
}

it(`bridge stays under ${BUDGET_GZIP_BYTES} bytes gzipped (measured ${MEASURED_GZIP_BYTES})`, async () => {
  const size = gzipSync(await bundledBridge()).length;
  console.log(`bridge: ${size} bytes gzipped`);
  expect(
    size,
    `bridge is ${size} bytes gzipped, budget ${BUDGET_GZIP_BYTES}`,
  ).toBeLessThanOrEqual(BUDGET_GZIP_BYTES);
}, 30_000);
