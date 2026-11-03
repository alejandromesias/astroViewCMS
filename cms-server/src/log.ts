// The log of cms-server (WORKPLAN 2.3b). One JSON line per event: stdout for info, stderr for warn and error.
// Every string field goes through the credential redaction of git/exec.ts, so a remote URL with a password
// cannot reach a line. Code that logs takes a `Logger` as a parameter, with `logger` as the real default.
import { redact } from './git/exec.ts';

/** A value a log line can carry. */
type LogField = string | number | boolean | string[];

export interface Logger {
  info(message: string, fields?: Record<string, LogField>): void;
  warn(message: string, fields?: Record<string, LogField>): void;
  error(message: string, fields?: Record<string, LogField>): void;
}

/** Where a line goes. `process.stdout` and `process.stderr` both fit. */
interface LineSink {
  write(chunk: string): boolean;
}

export const logger: Logger = {
  info: (message, fields) => emit(process.stdout, 'info', message, fields),
  warn: (message, fields) => emit(process.stderr, 'warn', message, fields),
  error: (message, fields) => emit(process.stderr, 'error', message, fields),
};

// `time`, `level` and `message` come last, so a field of the same name cannot replace them.
function emit(
  sink: LineSink,
  level: string,
  message: string,
  fields: Record<string, LogField> = {},
): void {
  const line = {
    ...redactFields(fields),
    time: new Date().toISOString(),
    level,
    message,
  };
  sink.write(`${JSON.stringify(line)}\n`);
}

// Entries go through Object.fromEntries, so a field named `__proto__` stays an ordinary key.
function redactFields(
  fields: Record<string, LogField>,
): Record<string, LogField> {
  const pairs: [string, LogField][] = Object.entries(fields).map(
    ([name, value]) => [name, redactField(value)],
  );
  return Object.fromEntries(pairs);
}

function redactField(value: LogField): LogField {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(redact);
  return value;
}
