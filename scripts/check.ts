// One command for every quality check: `npm run check [-- --fast|--e2e|--mutation|--all]`.
// Tools run one after another (memory is low), output streams live, a failure
// does not stop the run, and a summary table closes it. DOCS/QUALITY-TOOLING.md
// describes each tool; DOCS/QUALITY-TOOLING-PLAN.md step 8b has the reasoning.
import { spawnSync } from 'node:child_process';

type Kind = 'gate' | 'report';
type Status = 'pass' | 'fail' | 'report' | 'skipped';

interface Step {
  name: string;
  command: string;
  kind: Kind;
  // Probe run first; if it fails the step is skipped with `hint` (a tool outside npm).
  requires?: { probe: string; hint: string };
}

const FAST: Step[] = [
  { name: 'tsc', command: 'npm run typecheck -w preview-render-server', kind: 'gate' },
  { name: 'tsc protocol', command: 'npm run typecheck -w preview-protocol', kind: 'gate' },
  { name: 'protocol tests', command: 'npm run test -w preview-protocol', kind: 'gate' },
  { name: 'biome lint', command: 'npm run lint', kind: 'gate' },
  { name: 'biome format', command: 'npm run format:check', kind: 'gate' },
  { name: 'unit tests', command: 'npm run test -w preview-render-server', kind: 'gate' },
  { name: 'knip', command: 'npm run knip', kind: 'gate' },
  { name: 'depcruise', command: 'npm run depcruise', kind: 'gate' },
  {
    name: 'osv-scanner',
    command: 'npm run audit',
    kind: 'gate',
    requires: {
      probe: 'osv-scanner --version',
      hint: 'winget install Google.OSVScanner',
    },
  },
];

const E2E: Step[] = [
  { name: 'e2e + budgets', command: 'npm run test:e2e -w preview-render-server', kind: 'gate' },
  // Browser suite (Vitest browser mode, Chromium): one file at a time, after e2e (tools run one at a time).
  { name: 'browser', command: 'npm run test:browser -w preview-render-server', kind: 'gate' },
  // Fails below coverage.thresholds in vitest.config.ts (step 10c).
  { name: 'coverage floors', command: 'npm run coverage -w preview-render-server', kind: 'gate' },
];

// A crash fails the run, and so does a score under `thresholds.break` in stryker.config.json (step 10c).
const MUTATION: Step[] = [
  { name: 'stryker', command: 'npx stryker run', kind: 'report' },
];

const FLAGS = ['--fast', '--e2e', '--mutation', '--all'];
const args = process.argv.slice(2);
const unknown = args.filter((a) => !FLAGS.includes(a));
if (unknown.length > 0) {
  console.error(`Unknown flag: ${unknown.join(' ')}. Use ${FLAGS.join(', ')}.`);
  process.exit(2);
}

const all = args.includes('--all');
const wantE2e = all || args.includes('--e2e');
const wantMutation = all || args.includes('--mutation');
const wantFast = all || args.includes('--fast') || args.includes('--e2e') || args.length === 0;

const steps: Step[] = [
  ...(wantFast ? FAST : []),
  ...(wantE2e ? E2E : []),
  ...(wantMutation ? MUTATION : []),
];

interface Result {
  name: string;
  status: Status;
  seconds: number;
  note: string;
}

function run(command: string): number {
  const result = spawnSync(command, { stdio: 'inherit', shell: true });
  return result.status ?? 1;
}

const results: Result[] = [];
for (const step of steps) {
  console.log(`\n=== ${step.name}: ${step.command}`);
  const started = Date.now();
  if (step.requires && spawnSync(step.requires.probe, { stdio: 'ignore', shell: true }).status !== 0) {
    console.log(`skipped: not installed. Install with: ${step.requires.hint}`);
    results.push({ name: step.name, status: 'skipped', seconds: 0, note: step.requires.hint });
    continue;
  }
  const code = run(step.command);
  const seconds = (Date.now() - started) / 1000;
  const status: Status = code !== 0 ? 'fail' : step.kind === 'report' ? 'report' : 'pass';
  results.push({ name: step.name, status, seconds, note: code !== 0 ? `exit ${code}` : '' });
}

const width = Math.max(...results.map((r) => r.name.length), 4);
console.log('\n=== Summary');
for (const r of results) {
  const time = r.seconds > 0 ? `${r.seconds.toFixed(1)} s` : '-';
  console.log(`${r.name.padEnd(width)}  ${r.status.padEnd(7)}  ${time.padStart(8)}  ${r.note}`);
}
const failed = results.filter((r) => r.status === 'fail');
console.log(failed.length > 0 ? `\n${failed.length} failed` : '\nAll gates passed');
process.exit(failed.length > 0 ? 1 : 0);
