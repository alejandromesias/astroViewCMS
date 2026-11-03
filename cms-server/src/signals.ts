// Stops cms-server on SIGINT and SIGTERM (WORKPLAN 2.1i). The first signal starts the stop; later signals
// are ignored. The process exits with 0 when the stop finishes, or with 1 after it reports a failure.
// The signal source is injected, so that a test can fire the signals itself.

/** The part of the process the wiring uses: its signal listeners. */
export interface SignalSource {
  on(signal: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
}

export interface SignalDeps {
  /** Stops cms-server. Resolves when it is down. */
  stop: () => Promise<void>;
  /** Ends the process with `code`. */
  exit: (code: number) => void;
  /** Where the signals come from. Default: the process. */
  source?: SignalSource;
  /** Writes the message of a failed stop. Default: stderr, with a line break. */
  report?: (message: string) => void;
}

/** Writes one line to stderr. The default report. */
function writeStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}

/** Registers the stop on SIGINT and SIGTERM. Nothing else happens until a signal arrives. */
export function wireSignals({
  stop,
  exit,
  source = process,
  report = writeStderr,
}: SignalDeps): void {
  let stopping = false;
  const onSignal = (): void => {
    if (stopping) return;
    stopping = true;
    stop().then(
      () => exit(0),
      (error: unknown) => {
        report(error instanceof Error ? error.message : String(error));
        exit(1);
      },
    );
  };
  source.on('SIGINT', onSignal);
  source.on('SIGTERM', onSignal);
}
