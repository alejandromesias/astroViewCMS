// Publish timing (WORKPLAN 2.13a). Not a gate, and not run in CI (architect, 2026-11-24): run it by hand before a phase
// close or after a change to publish, build or swap. For each buildCheck mode (never, auto, always) it starts cms-server
// with the real builder on a local bare repo seeded from sample-site (no --bundle), waits for its node, and makes RUNS
// rounds. A round saves one content document, publishes it, and waits until the publish has settled before the next save.
// A publish settles when the build is idle, the node serves the bundle of the last finished build, and SETTLE_GRACE_MS
// has passed since the response. A publish that pushes also asks for a rebuild after its response, under every mode, and
// `always` builds a candidate before it.
// Per publish it reports: the latency of POST /api/publish (ms); the candidate build (under `always`); the rebuild after
// the response (build ms); its swap, from the `Build finished` log line to the first /api/status sample with the node
// `ready` on that bundle (ms); the time to settle; the asks that never finished; and the rss and commit charge of
// cms-server after the settle. Per mode it reports the highest rss and commit charge across the rounds. Commit charge
// (PrivateMemorySize64) is the private memory the process has committed, which working-set trimming does not lower.
// The start prints the machine's load; a busy machine gets a warning, and the run goes on.
// /api/status is polled every POLL_MS from before each publish. A local remote leaves out network time (section 8 of
// WORKPLAN-PHASE-2-CLOSE.md).
import { spawnSync } from 'node:child_process';
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
// The trigger a publish starts is logged inside the publish's lock, before its response. The grace is a margin for that
// log line and for the first status sample after the response: settling waits this long after the response.
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

/** The commit charge of a process (Windows PrivateMemorySize64): the private memory it has committed. */
function commitBytes(pid) {
  if (process.platform !== 'win32')
    throw new Error(
      `commit charge is read on Windows only, not on ${process.platform}`,
    );
  const ps = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `(Get-Process -Id ${pid}).PrivateMemorySize64`,
    ],
    { encoding: 'utf8' },
  );
  const bytes = Number.parseInt(ps.stdout.trim(), 10);
  if (!Number.isFinite(bytes))
    throw new Error(`no commit charge for ${pid}: ${ps.stderr}`);
  return bytes;
}

/**
 * The machine's load before the run: CPU count, free memory, and the busy share of the CPUs over one second. A busy
 * machine gets a warning; the run is not refused.
 */
async function machineLoad() {
  const before = os.cpus().map((cpu) => cpu.times);
  await sleep(1000);
  const after = os.cpus().map((cpu) => cpu.times);
  let busy = 0;
  let total = 0;
  after.forEach((now, i) => {
    const used = (key) => now[key] - before[i][key];
    const all =
      used('user') + used('nice') + used('sys') + used('irq') + used('idle');
    busy += all - used('idle');
    total += all;
  });
  const share = total === 0 ? 0 : busy / total;
  console.log(
    `machine: ${os.cpus().length} CPUs, ${(os.freemem() / MB).toFixed(0)} MB free, CPUs ${(100 * share).toFixed(0)}% busy over 1 s`,
  );
  if (share > 0.5)
    console.log(
      'warning: the machine looks busy; timings from this run are not comparable with a quiet run',
    );
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
      const served = lines
        .filter((line) => line.message === 'Build finished')
        .at(-1)?.entry.bundleId;
      // The state decides, not a count of asks: an ask can finish without a `Build finished` line (an adopted candidate
      // that already serves the head, or a shared build), and such a publish would otherwise wait out SETTLE_MS.
      if (
        Date.now() >= endedAt + SETTLE_GRACE_MS &&
        latest !== undefined &&
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
    // Asks logged without a matching `Build finished` by the time of the settle (see the settle rule above).
    unfinished: Math.max(
      0,
      lines.filter((line) => ASKED.has(line.message)).length -
        lines.filter((line) => line.message === 'Build finished').length,
    ),
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

/** Starts cms-server under `mode`, makes RUNS save-and-publish rounds, and returns one row per round (with rss and commit charge after its settle). */
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
      const row = await publishOnce(base, mode, run, output);
      // One process sample per publish, after its settle: each sample is a PowerShell call, too slow for the poll loop.
      rows.push({
        ...row,
        rss: rssBytes(server.pid),
        commit: commitBytes(server.pid),
      });
    }
    return rows;
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
await machineLoad();
const results = [];
for (const mode of MODES) {
  console.log(`mode ${mode}: starting`);
  results.push({ mode, rows: await runMode(mode, home) });
}

const present = (rows, key) =>
  rows.flatMap((row) => (row[key] === undefined ? [] : [row[key]]));
console.log(
  `\nsample-site, local bare remote, ${RUNS} publishes per mode, ${process.platform}`,
);
/** The highest value of `key` across the rows, in MB with one decimal. */
const highestMb = (rows, key) =>
  (Math.max(...rows.map((row) => row[key])) / MB).toFixed(1);
console.log(
  'mode'.padEnd(8),
  'publish ms'.padEnd(34),
  'candidate ms'.padEnd(30),
  'candidate swap ms'.padEnd(30),
  'rebuild ms'.padEnd(30),
  'rebuild swap ms'.padEnd(30),
  'settled'.padEnd(9),
  'rss MB max'.padStart(11),
  'commit MB max'.padStart(14),
  'unfinished'.padStart(11),
);
for (const { mode, rows } of results) {
  console.log(
    mode.padEnd(8),
    describe(present(rows, 'latency')).padEnd(34),
    describe(present(rows, 'candidate')).padEnd(30),
    describe(present(rows, 'candidateSwap')).padEnd(30),
    describe(present(rows, 'rebuild')).padEnd(30),
    describe(present(rows, 'swap')).padEnd(30),
    `${present(rows, 'settled').length} of ${RUNS}`.padEnd(9),
    highestMb(rows, 'rss').padStart(11),
    highestMb(rows, 'commit').padStart(14),
    String(rows.reduce((sum, row) => sum + row.unfinished, 0)).padStart(11),
  );
}
console.log(
  '\nper publish:',
  JSON.stringify(
    results.map(({ mode, rows }) => ({
      mode,
      rows: rows.map((row) => ({
        latency: Math.round(row.latency),
        rss: Math.round(row.rss / MB),
        commit: Math.round(row.commit / MB),
        unfinished: row.unfinished,
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
