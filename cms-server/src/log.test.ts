import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from './log.ts';

const NOW = '2026-11-02T10:00:00.000Z';

describe('logger', () => {
  let stdout: ReturnType<typeof vi.spyOn>;
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('writes info to stdout as one JSON line, and nothing to stderr', () => {
    logger.info('repo ready');
    expect(stdout.mock.calls).toEqual([
      [`{"time":"${NOW}","level":"info","message":"repo ready"}\n`],
    ]);
    expect(stderr).not.toHaveBeenCalled();
  });

  it('writes warn to stderr with its fields, in the order given', () => {
    logger.warn('Discarded the uncommitted changes', {
      paths: ['a.md', 'b.md'],
      count: 2,
      forced: true,
    });
    expect(stderr.mock.calls).toEqual([
      [
        `{"paths":["a.md","b.md"],"count":2,"forced":true,"time":"${NOW}","level":"warn","message":"Discarded the uncommitted changes"}\n`,
      ],
    ]);
    expect(stdout).not.toHaveBeenCalled();
  });

  it('writes error to stderr', () => {
    logger.error('clone failed');
    expect(stderr.mock.calls).toEqual([
      [`{"time":"${NOW}","level":"error","message":"clone failed"}\n`],
    ]);
  });

  it('redacts the credentials in string fields and in string lists', () => {
    logger.error('clone failed', {
      remote: 'https://me:secret@github.com/owner/repo.git',
      urls: ['https://a:b@host/x.git', 'https://github.com/owner/repo.git'],
    });
    expect(stderr.mock.calls).toEqual([
      [
        `{"remote":"https://***@github.com/owner/repo.git","urls":["https://***@host/x.git","https://github.com/owner/repo.git"],"time":"${NOW}","level":"error","message":"clone failed"}\n`,
      ],
    ]);
  });

  it('keeps a field named __proto__ as an ordinary key', () => {
    logger.info('event', JSON.parse('{"__proto__": "kept"}'));
    expect(stdout.mock.calls).toEqual([
      [
        `{"__proto__":"kept","time":"${NOW}","level":"info","message":"event"}\n`,
      ],
    ]);
  });

  it('does not let a field replace the level or the message', () => {
    logger.info('real message', { message: 'fake', level: 'warn' });
    expect(stdout.mock.calls).toEqual([
      [`{"message":"real message","level":"info","time":"${NOW}"}\n`],
    ]);
  });
});
