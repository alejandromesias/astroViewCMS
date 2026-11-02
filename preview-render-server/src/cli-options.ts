// Command-line options for build.ts and start.ts. The site config file is the
// first argument that isn't a flag (argv[2] in the usual call). The flags
// override the site config (see resolveSiteConfig in site-config.ts) or the
// environment.
import { bundleIdPattern } from 'preview-contract';

/** What build.ts and start.ts take from the command line. */
export interface CliOptions {
  /** The site config file, or undefined when none was given. */
  configPath: string | undefined;
  /** Replaces the site config's `root`. Resolved against the current folder,
   *  not the config's folder. */
  root: string | undefined;
  /** Replaces the output folder. Resolved against the current folder. Keep it
   *  inside the workspace: the build resolves packages from node_modules. */
  out: string | undefined;
  /** The port start.ts listens on, ahead of the PORT variable and the config's
   *  port (see choosePort). build.ts ignores it. */
  port: number | undefined;
  /** build.ts only: the bundle id written to bundle.json, in place of a fresh
   *  random one (tests use it to know the id). start.ts ignores it. */
  bundleId: string | undefined;
  /** build.ts only: adds the editor's stopgap route, as PREVIEW_DEV=1 does. */
  dev: boolean;
}

/** Flags that take a value, written as `--flag value` or `--flag=value`. */
const VALUE_FLAGS = new Set(['--root', '--out', '--port', '--bundle-id']);
/** Flags that stand alone and take no value. */
const SWITCH_FLAGS = new Set(['--dev']);

/** Reads the arguments after the script name (`process.argv.slice(2)`). Throws
 *  on an unknown flag, a missing value, a second file argument or a bad port,
 *  so a typo stops the start instead of being ignored. */
export function parseCliOptions(args: readonly string[]): CliOptions {
  const options: CliOptions = {
    configPath: undefined,
    root: undefined,
    out: undefined,
    port: undefined,
    bundleId: undefined,
    dev: false,
  };
  // An iterator, so a value flag can take the next word as its value.
  const words = args[Symbol.iterator]();
  for (let next = words.next(); !next.done; next = words.next()) {
    const arg = next.value;
    if (!arg.startsWith('--')) {
      if (options.configPath !== undefined) {
        throw new Error(`Unexpected argument: ${arg}`);
      }
      options.configPath = arg;
      continue;
    }
    const equals = arg.indexOf('=');
    const name = equals === -1 ? arg : arg.slice(0, equals);
    if (SWITCH_FLAGS.has(name)) {
      if (equals !== -1) throw new Error(`${name} takes no value`);
      options.dev = true;
      continue;
    }
    if (!VALUE_FLAGS.has(name)) throw new Error(`Unknown option: ${name}`);
    // `--flag value` takes the next word, unless that word is another flag.
    let value: string | undefined;
    if (equals === -1) {
      const following = words.next();
      value = following.done ? undefined : following.value;
      if (value?.startsWith('--')) value = undefined;
    } else {
      value = arg.slice(equals + 1);
    }
    if (value === undefined || value === '') {
      throw new Error(`${name} needs a value`);
    }
    assignValue(options, name, value);
  }
  return options;
}

/** Stores one value flag's value in the options, parsing a port number. */
function assignValue(options: CliOptions, name: string, value: string): void {
  switch (name) {
    case '--root':
      options.root = value;
      return;
    case '--out':
      options.out = value;
      return;
    case '--port':
      options.port = parsePort(value);
      return;
    case '--bundle-id':
      options.bundleId = parseBundleId(value);
      return;
  }
}

/** Reads a bundle id. It becomes a folder name later (see bundleIdPattern), so
 *  anything with a separator or a leading dot is refused. */
export function parseBundleId(value: string): string {
  if (!bundleIdPattern.test(value)) {
    throw new Error(
      `--bundle-id must start with a letter or digit and hold only letters, digits, dots, dashes and underscores, got "${value}"`,
    );
  }
  return value;
}

/** Reads a port number from 1 to 65535. Only plain digits are accepted, so
 *  "4400x", "1e3", "-1" and "0" are rejected. */
export function parsePort(value: string): number {
  const port = Number(value);
  if (!/^\d{1,5}$/.test(value) || port < 1 || port > 65535) {
    throw new Error(`--port must be a number from 1 to 65535, got "${value}"`);
  }
  return port;
}

/** The port start.ts listens on: the --port flag first, then the PORT variable,
 *  then the config's port. The result is the string the server reads from PORT. */
export function choosePort(
  flag: number | undefined,
  envPort: string | undefined,
  configPort: number,
): string {
  return String(flag ?? envPort ?? configPort);
}
