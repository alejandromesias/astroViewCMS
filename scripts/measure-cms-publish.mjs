// Publish timing (WORKPLAN 2.13a). Not a gate. For each buildCheck mode (never, auto, always) it starts cms-server with the
// real builder on a local bare repo seeded from sample-site (no --bundle), waits for its node, and makes RUNS publishes.
// Each publish follows one save of a content document, so under `auto` the save is a content-only change and triggers no
// build. It reports, per publish: the latency of POST /api/publish (ms); the swap, from the end of the candidate build
// (build.state leaves `building`) to node.state `ready` on the new bundle (ms), when the publish builds; and, per mode, the
// rss of cms-server after its publishes. /api/status is polled every POLL_MS during a publish, so a swap is read to that
// step. A local remote leaves out network time (section 8 of WORKPLAN-PHASE-2-CLOSE.md).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ask,
  claimConfigFile,
  configText,
  freePort,
  MB,
  ROOT,
  rssBytes,
  seedRemote,
  sleep,
  startCms,
  stop,
  waitForListening,
  waitForReady,
} from './measure-cms-shared.mjs';

const MODES = ['never', 'auto', 'always'];
const RUNS = 3;
const SITE = 'publish-measure';
const DOCUMENT = 'landing/home-v2';
// The run writes this file and deletes it afterwards (claimConfigFile); it sits in the repo root, as in measure-cms-memory.
const CONFIG_FILE = path.join(ROOT, 'cms-publish-measure.config.ts');
const SITE_DIR = path.join(ROOT, '.cms', SITE);
const POLL_MS = 25;
// The first start builds the sample site with the real builder before the node is ready.
const READY_MS = 600_000;

/** Mean, lowest and highest of the numbers, rounded to whole milliseconds. */
function summary(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    mean: Math.round(mean),
    min: Math.round(Math.min(...values)),
    max: Math.round(Math.max(...values)),
  };
}

/** Saves the sample document with a new title, so the publish has one content change to push. */
async function saveOnce(base, home, run) {
  const doc = JSON.parse(
    await ask(`${base}/api/documents?key=${encodeURIComponent(DOCUMENT)}`),
  );
  home.blocks[0].title = `Publish run ${run}`;
  const answer = JSON.parse(
    await ask(`${base}/api/changes`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        changes: [
          { document: DOCUMENT, baseRevision: doc.revision, data: home },
        ],
      }),
    }),
  );
  if (answer.revisions[DOCUMENT] === undefined)
    throw new Error(`save ${run} gave no revision`);
}

/** The log lines cms-server wrote so far, parsed. `at` is the line's time in wall-clock milliseconds. */
function logLines(text) {
  return text.split('\n').flatMap((line) => {
    if (!line.startsWith('{')) return [];
    const entry = JSON.parse(line);
    return [{ at: Date.parse(entry.time), message: entry.message, entry }];
  });
}

/**
 * One publish, with /api/status polled while it runs. A candidate build is read from the log: its `Build finished` line
 * ends it, and the swap ends at the first `ready` sample on that build's bundle. Times are wall-clock milliseconds.
 */
async function publishOnce(base, mode, run, output) {
  const timeline = [];
  let done = false;
  const polling = (async () => {
    while (!done) {
      const status = JSON.parse(await ask(`${base}/api/status`));
      timeline.push({
        at: Date.now(),
        node: status.node.state,
        bundleId: status.node.bundleId,
      });
      await sleep(POLL_MS);
    }
  })();
  const startedAt = Date.now();
  const res = await fetch(`${base}/api/publish`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  const endedAt = Date.now();
  const text = await res.text();
  done = true;
  await polling;
  if (res.status !== 200)
    throw new Error(`${mode} publish ${run} answered ${res.status}: ${text}`);

  const lines = logLines(output()).filter((line) => line.at >= startedAt);
  const built = lines.find((line) => line.message === 'Build finished');
  const swapped =
    built === undefined
      ? undefined
      : timeline.find(
          (sample) =>
            sample.at >= built.at &&
            sample.node === 'ready' &&
            sample.bundleId === built.entry.bundleId,
        );
  return {
    latency: endedAt - startedAt,
    built: built !== undefined,
    swap: swapped === undefined ? undefined : swapped.at - built.at,
    skipped: JSON.parse(text).buildCheckSkipped,
    events: lines.map((line) => `${line.message} +${line.at - startedAt}`),
  };
}

/** Starts cms-server under `mode`, makes RUNS save-and-publish rounds, and returns the rows and the rss after them. */
async function runMode(mode, home) {
  claimConfigFile(CONFIG_FILE);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cms-publish-'));
  fs.rmSync(SITE_DIR, { recursive: true, force: true });
  let server;
  let output = () => '';
  try {
    const remote = seedRemote(work);
    const cmsPort = await freePort();
    const previewPort = await freePort();
    fs.writeFileSync(
      CONFIG_FILE,
      configText({ site: SITE, remote, cmsPort, previewPort, publish: mode }),
      'utf8',
    );
    const started = startCms(CONFIG_FILE);
    server = started.server;
    output = started.output;
    await waitForListening(cmsPort, server, output);
    const base = `http://127.0.0.1:${cmsPort}`;
    await waitForReady(base, output, READY_MS);

    const rows = [];
    for (let run = 1; run <= RUNS; run++) {
      await saveOnce(base, home, run);
      rows.push(await publishOnce(base, mode, run, output));
    }
    return { rows, rss: rssBytes(server.pid) };
  } finally {
    if (server !== undefined) await stop(server);
    fs.rmSync(CONFIG_FILE, { force: true });
    fs.rmSync(SITE_DIR, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
  }
}

const home = JSON.parse(
  fs.readFileSync(
    path.join(ROOT, 'sample-site/src/content', `${DOCUMENT}.json`),
    'utf8',
  ),
);
const results = [];
for (const mode of MODES) {
  console.log(`mode ${mode}: starting`);
  results.push({ mode, ...(await runMode(mode, home)) });
}

console.log(
  `\nsample-site, local bare remote, ${RUNS} publishes per mode, ${process.platform}`,
);
console.log(
  'mode'.padEnd(8),
  'publish ms (mean, range)'.padEnd(28),
  'swap ms (mean, range, n)'.padEnd(30),
  'built'.padEnd(7),
  'rss MB'.padStart(8),
);
for (const { mode, rows, rss } of results) {
  const latency = summary(rows.map((row) => row.latency));
  const swaps = rows.flatMap((row) =>
    row.swap === undefined ? [] : [row.swap],
  );
  const swap =
    swaps.length === 0
      ? 'none'
      : `${summary(swaps).mean} (${summary(swaps).min} to ${summary(swaps).max}, n ${swaps.length})`;
  console.log(
    mode.padEnd(8),
    `${latency.mean} (${latency.min} to ${latency.max})`.padEnd(28),
    swap.padEnd(30),
    `${rows.filter((row) => row.built).length} of ${RUNS}`.padEnd(7),
    (rss / MB).toFixed(1).padStart(8),
  );
}
console.log(
  '\nper publish:',
  JSON.stringify(
    results.map(({ mode, rows }) => ({
      mode,
      rows: rows.map((row) => ({
        latency: Math.round(row.latency),
        swap: row.swap === undefined ? null : Math.round(row.swap),
        built: row.built,
        skipped: row.skipped ?? null,
        events: row.events,
      })),
    })),
  ),
);
