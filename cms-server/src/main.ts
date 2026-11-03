// The entry point of cms-server (`npm start -w cms-server`, WORKPLAN 2.1i). It runs run() on this process's
// arguments and environment, prints a failed start in one plain message with exit code 1, and stops the
// CMS on SIGINT and SIGTERM. The logic lives in run.ts and signals.ts.
import { describeError, run } from './run.ts';
import { wireSignals } from './signals.ts';

try {
  const running = await run(process.argv.slice(2), process.env);
  wireSignals({
    stop: running.stop,
    exit: (code) => process.exit(code),
  });
} catch (error) {
  process.stderr.write(`${describeError(error)}\n`);
  process.exitCode = 1;
}
