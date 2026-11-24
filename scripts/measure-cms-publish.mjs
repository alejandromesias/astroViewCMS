// Publish timing (WORKPLAN 2.13a). Not a gate. For each buildCheck mode (never, auto, always) it starts cms-server with the
// real builder on a local bare repo seeded from sample-site (no --bundle), waits for its node, and makes RUNS rounds. A
// round saves one content document, publishes it, and waits until the publish has settled before the next save. A
// publish settles when every build the log asked for has finished and the node serves the last one: a publish that
// pushes also asks for a rebuild after its response, under every mode, and `always` builds a candidate before it.
// Per publish it reports: the latency of POST /api/publish (ms); the candidate build (under `always`); the rebuild after
// the response (build ms); its swap, from the `Build finished` log line to the first /api/status sample with the node
// `ready` on that bundle (ms); and the time to settle. Per mode it reports the rss of cms-server after the last settle.
// /api/status is polled every POLL_MS from before each publish. A local remote leaves out network time (section 8 of
// WORKPLAN-PHASE-2-CLOSE.md).
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
const SETTLE_MS = 300_000;
// A trigger that a publish starts after its response logs its request within this grace; settling waits for it.
const SETTLE_GRACE_MS = 500;
const ASKED = new Set([
  'A build was asked for',
  'A candidate build was asked for',
]);

/** Mean, lowest and highest of the numbers, rounded to whole milliseconds. */
function summary(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    mean: Math.round(mean),
    min: Math.round(Math.min(...values)),
    max: Math.round(Math.max(...values)),
  };
}

/** "mean (min to max, n)" of the numbers, or "none". */
function describe(values) {
  if (values.length === 0) return 'none';
  const { mean, min, max } = summary(values);
  return `${mean} (${min} to ${max}, n ${values.length})`;
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

/**
 * The log lines cms-server wrote so far, parsed. `at` is the line's time in wall-clock milliseconds. The last text after
 * the final newline is a line still being written, so it is left out.
 */
function logLines(text) {
  return text
    .split('\n')
    .slice(0, -1)
    .flatMap((line) => {
      if (!line.startsWith('{')) return [];
      const entry = JSON.parse(line);
      return [{ at: Date.parse(entry.time), message: entry.message, entry }];
    });
}

/** The builds in log order, each paired with the request that asked for it (the first unpaired request). */
function pairBuilds(lines) {
  const pending = [];
  const builds = [];
  for (const line of lines) {
    if (line.message === 'A candidate build was asked for')
      pending.push({ kind: 'candidate', asked: line.at });
    else if (line.message === 'A build was asked for')
      pending.push({ kind: 'rebuild', asked: line.at });
    else if (line.message === 'Build finished') {
      const start = pending.shift();
      builds.push({
        kind: start?.kind ?? 'unknown',
        asked: start?.asked,
        finished: line.at,
        bundleId: line.entry.bundleId,
      });
    }
  }
  return builds;
}

/**
 * One publish and the work it starts. The timeline keeps each change of build state, node state and bundle, from before
 * the request on. The publish is settled when every build the log asked for has finished, the build state is idle, and
 * the node is ready on the bundle of the last build that finished. Times are wall-clock milliseconds.
 */
async function publishOnce(base, mode, run, output) {
  const timeline = [];
  let last = '';
  let done = false;
  let pollError;
  const polling = (async () => {
    while (!done) {
      const status = JSON.parse(await ask(`${base}/api/status`));
      const sample = {
        at: Date.now(),
        build: status.build.state,
        node: status.node.state,
        bundleId: status.node.bundleId,
      };
      const key = `${sample.build} ${sample.node} ${sample.bundleId}`;
      if (key !== last) {
        timeline.push(sample);
        last = key;
      }
      await sleep(POLL_MS);
    }
  })().catch((error) => {
    pollError = error;
    done = true;
  });

  const startedAt = Date.now();
  let endedAt;
  let settledAt;
  let text;
  try {
    const res = await fetch(`${base}/api/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    endedAt = Date.now();
    text = await res.text();
    if (res.status !== 200)
      throw new Error(`${mode} publish ${run} answered ${res.status}: ${text}`);
    const deadline = endedAt + SETTLE_MS;
    while (
      settledAt === undefined &&
      pollError === undefined &&
      Date.now() < deadline
    ) {
      const latest = timeline.at(-1);
      const lines = logLines(output()).filter((line) => line.at >= startedAt);
      const asked = lines.filter((line) => ASKED.has(line.message)).length;
      const finished = lines.filter(
        (line) => line.message === 'Build finished',
      );
      const served = finished.at(-1)?.entry.bundleId;
      if (
        Date.now() >= endedAt + SETTLE_GRACE_MS &&
        latest !== undefined &&
        finished.length >= asked &&
        latest.build === 'idle' &&
        latest.node === 'ready' &&
        (served === undefined || latest.bundleId === served)
      )
        settledAt = Date.now();
      else await sleep(POLL_MS);
    }
  } finally {
    done = true;
    await polling;
  }
  if (pollError !== undefined) throw pollError;

  const lines = logLines(output()).filter((line) => line.at >= startedAt);
  const builds = pairBuilds(lines);
  const candidate = builds.find((build) => build.kind === 'candidate');
  const rebuild = builds.filter((build) => build.kind === 'rebuild').at(-1);
  // The node's first ready sample on a build's own bundle, after that build finished: its swap (a candidate the node
  // adopts is served, and a rebuild is served after it finishes).
  const servedAt = (build) =>
    build === undefined
      ? undefined
      : timeline.find(
          (sample) =>
            sample.at >= build.finished &&
            sample.node === 'ready' &&
            sample.bundleId === build.bundleId,
        );
  const swapped = servedAt(rebuild);
  const adopted = servedAt(candidate);
  return {
    latency: endedAt - startedAt,
    settled: settledAt === undefined ? undefined : settledAt - endedAt,
    candidate:
      candidate === undefined
        ? undefined
        : candidate.finished - candidate.asked,
    candidateSwap:
      adopted === undefined ? undefined : adopted.at - candidate.finished,
    rebuild:
      rebuild === undefined ? undefined : rebuild.finished - rebuild.asked,
    swap: swapped === undefined ? undefined : swapped.at - rebuild.finished,
    skipped: JSON.parse(text).buildCheckSkipped ?? null,
    events: lines.map(
      (line) =>
        `${line.message} +${line.at - startedAt}${line.message === 'Build finished' ? ` ${line.entry.bundleId.slice(-8)}` : ''}`,
    ),
    transitions: timeline.map(
      (sample) =>
        `+${sample.at - startedAt} ${sample.build}/${sample.node} ${sample.bundleId?.slice(-8) ?? 'none'}`,
    ),
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

const present = (rows, key) =>
  rows.flatMap((row) => (row[key] === undefined ? [] : [row[key]]));
console.log(
  `\nsample-site, local bare remote, ${RUNS} publishes per mode, ${process.platform}`,
);
console.log(
  'mode'.padEnd(8),
  'publish ms'.padEnd(34),
  'candidate ms'.padEnd(30),
  'candidate swap ms'.padEnd(30),
  'rebuild ms'.padEnd(30),
  'rebuild swap ms'.padEnd(30),
  'settled'.padEnd(9),
  'rss MB'.padStart(8),
);
for (const { mode, rows, rss } of results) {
  console.log(
    mode.padEnd(8),
    describe(present(rows, 'latency')).padEnd(34),
    describe(present(rows, 'candidate')).padEnd(30),
    describe(present(rows, 'candidateSwap')).padEnd(30),
    describe(present(rows, 'rebuild')).padEnd(30),
    describe(present(rows, 'swap')).padEnd(30),
    `${present(rows, 'settled').length} of ${RUNS}`.padEnd(9),
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
        settled: row.settled ?? null,
        candidate: row.candidate ?? null,
        candidateSwap: row.candidateSwap ?? null,
        rebuild: row.rebuild ?? null,
        swap: row.swap ?? null,
        skipped: row.skipped,
        events: row.events,
        transitions: row.transitions,
      })),
    })),
  ),
);
