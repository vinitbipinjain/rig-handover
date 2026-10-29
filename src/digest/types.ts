// Plan morning-digest § 1. The contract every part of § 2 builds against.

export type RunStatus = 'ok' | 'retry' | 'fail';

// One parsed line of runs/<night>.jsonl.
export type RunLine = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

// One row per job. Times keep the offset from the log.
export type DigestRow = {
  job: string;
  // Owner on the job's last line; null renders as `—`.
  owner: string | null;
  runs: number;
  retries: number;
  lastStatus: RunStatus;
  // Most recent error the job logged that night, even if it recovered after; null if none.
  lastError: string | null;
  firstAt: string;
  lastAt: string;
};

// Run lines per status, bad lines not included.
export type StatusCounts = Record<RunStatus, number>;

export type Night = {
  night: string;
  // Sorted by job. The page and the JSON both use this order.
  rows: DigestRow[];
  counts: StatusCounts;
  // Non-blank lines that did not parse as a run line. Counted, never thrown.
  badLines: number;
};

// Returns null when runs/<night>.jsonl does not exist (or night is not YYYY-MM-DD).
export type ReadNight = (runsDir: string, night: string) => Night | null;

export const NIGHT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
