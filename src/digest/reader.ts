import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NIGHT_PATTERN, type DigestRow, type Night, type ReadNight, type RunLine, type RunStatus } from './types.js';

const STATUSES: readonly RunStatus[] = ['ok', 'retry', 'fail'];

// Parse at the edge: anything that is not a well-formed run line is null.
export function parseLine(line: string): RunLine | null {
  let v: unknown;
  try {
    v = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.at !== 'string' || typeof o.job !== 'string' || o.job === '') return null;
  if (typeof o.status !== 'string' || !STATUSES.includes(o.status as RunStatus)) return null;
  if (o.owner !== undefined && o.owner !== null && typeof o.owner !== 'string') return null;
  if (o.error !== undefined && o.error !== null && typeof o.error !== 'string') return null;
  const run: RunLine = { at: o.at, job: o.job, status: o.status as RunStatus, owner: o.owner ?? null };
  if (typeof o.error === 'string') run.error = o.error;
  return run;
}

export function digest(night: string, text: string): Night {
  const byJob = new Map<string, DigestRow>();
  const counts = { ok: 0, retry: 0, fail: 0 };
  let badLines = 0;

  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const run = parseLine(line);
    if (!run) {
      badLines++;
      continue;
    }
    counts[run.status]++;
    const row = byJob.get(run.job);
    if (!row) {
      byJob.set(run.job, {
        job: run.job,
        owner: run.owner,
        runs: 1,
        retries: run.status === 'retry' ? 1 : 0,
        lastStatus: run.status,
        lastError: run.error ?? null,
        firstAt: run.at,
        lastAt: run.at,
      });
      continue;
    }
    // The log is in time order; the line read last is the job's last run.
    row.runs++;
    if (run.status === 'retry') row.retries++;
    row.owner = run.owner;
    row.lastStatus = run.status;
    if (run.error !== undefined) row.lastError = run.error;
    row.lastAt = run.at;
  }

  const rows = [...byJob.values()].sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0));
  return { night, rows, counts, badLines };
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!NIGHT_PATTERN.test(night)) return null;
  let text: string;
  try {
    text = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
  return digest(night, text);
};
