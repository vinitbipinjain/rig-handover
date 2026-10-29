import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { readNight } from '../src/digest/reader.js';
import type { Night } from '../src/digest/types.js';

// runs/ is read-only: every route test reads from a temp copy.
let runsDir = '';

const app = () =>
  createApp({ adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir });

// A handcrafted night: lines out of job order, a fail, a job retried 3 times,
// one retried only twice, a null owner, and one truncated line.
const CRAFTED = [
  '{"at":"2026-10-31T23:00:00+01:00","job":"sync/flaky","status":"retry","owner":"rook","error":"timeout"}',
  '{"at":"2026-10-31T23:01:00+01:00","job":"sync/flaky","status":"retry","owner":"rook","error":"timeout"}',
  '{"at":"2026-10-31T23:02:00+01:00","job":"sync/flaky","status":"retry","owner":"rook","error":"timeout"}',
  '{"at":"2026-10-31T23:03:00+01:00","job":"sync/flaky","status":"ok","owner":"rook"}',
  '{"at":"2026-11-01T01:00:00+01:00","job":"backup/broken","status":"fail","owner":"lane-07","error":"disk full"}',
  '{"at":"2026-11-01T02:00:00+01:00","job":"render/orphan","status":"ok","owner":null}',
  '{"at":"2026-11-01T03:00:00+01:00","job":"mail/twice","status":"retry","owner":"rook","error":"smtp 421"}',
  '{"at":"2026-11-01T03:00:30+01:00","job":"mail/twice","status":"retry","owner":"rook","error":"smtp 421"}',
  '{"at":"2026-11-01T03:01:00+01:00","job":"mail/twice","status":"ok","owner":"rook"}',
  '{"at":"2026-11-01T04:00:00+01:00","job":"sync/fl',
  '',
].join('\n');

type TableRow = { attrs: string; job: string; html: string };

const stripTags = (s: string) => s.replace(/<[^>]*>/g, '').trim();

// Body rows of the page's table: every <tr> that has a <td>, job from its first cell.
function tableRows(html: string): TableRow[] {
  const rows: TableRow[] = [];
  for (const m of html.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/g)) {
    const inner = m[2]!;
    const firstCell = /<td\b[^>]*>([\s\S]*?)<\/td>/.exec(inner);
    if (!firstCell) continue;
    rows.push({ attrs: m[1]!, job: stripTags(firstCell[1]!), html: inner });
  }
  return rows;
}

const h1 = (html: string) => stripTags(/<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? '');
const tableCount = (html: string) => (html.match(/<table\b/g) ?? []).length;
const isWarn = (row: TableRow) => /class="warn"/.test(row.attrs);

async function page(night: string) {
  const res = await app().request(`/digest/${night}`);
  return { status: res.status, html: await res.text() };
}

async function json(night: string) {
  const res = await app().request(`/api/digest/${night}`);
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

beforeAll(() => {
  process.env.LANE_MARKER = 'TEST-MARKER';
  runsDir = mkdtempSync(join(tmpdir(), 'rig-routes-'));
  copyFileSync(join('runs', '2026-10-28.jsonl'), join(runsDir, '2026-10-28.jsonl'));
  writeFileSync(join(runsDir, '2026-10-30.jsonl'), '');
  writeFileSync(join(runsDir, '2026-10-31.jsonl'), CRAFTED);
});

afterAll(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

describe('GET /digest/:night', () => {
  it('renders 2026-10-28 with the lane banner, heading and one table in job order', async () => {
    const { status, html } = await page('2026-10-28');
    expect(status).toBe(200);
    expect(html).toContain('TEST-MARKER');
    expect(h1(html)).toContain('digest · 2026-10-28');
    expect(tableCount(html)).toBe(1);
    expect(tableRows(html).map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
  });

  it('marks retries >= 3 and fails as warn, and nothing else', async () => {
    const { status, html } = await page('2026-10-31');
    expect(status).toBe(200);
    const warn =  Object.fromEntries(tableRows(html).map((r) => [r.job, isWarn(r)]));
    expect(warn).toEqual({
      'backup/broken': true,
      'mail/twice': false,
      'render/orphan': false,
      'sync/flaky': true,
    });
  });

  it('renders a null owner as —', async () => {
    const { status, html } = await page('2026-10-31');
    expect(status).toBe(200);
    const orphan =  tableRows(html).find((r) => r.job === 'render/orphan');
    expect(orphan).toBeDefined();
    expect(orphan!.html).toContain('—');
  });

  it('renders the good rows of a night with a bad line and says one line could not be read', async () => {
    const { status, html } = await page('2026-10-31');
    expect(status).toBe(200);
    expect(tableRows(html).map((r) => r.job)).toEqual(['backup/broken', 'mail/twice', 'render/orphan', 'sync/flaky']);
    expect(html).toContain('1 line in the run log could not be read');
  });

  it('renders an empty night as "nothing ran" with no table', async () => {
    const { status, html } = await page('2026-10-30');
    expect(status).toBe(200);
    expect(html).toContain('nothing ran');
    expect(tableCount(html)).toBe(0);
  });

  it('returns 404 for a night with no file', async () => {
    expect((await page('2026-01-01')).status).toBe(404);
  });

  it('returns 404 for a bad night name', async () => {
    expect((await page('..%2Fpackage')).status).toBe(404);
  });
});

describe('GET /api/digest/:night', () => {
  it('returns the night for 2026-10-28', async () => {
    const { status, body } = await json('2026-10-28');
    expect(status).toBe(200);
    const night = body as Night;
    expect(night.night).toBe('2026-10-28');
    expect(night.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(night.badLines).toBe(1);
    expect(night.rows).toEqual(readNight(runsDir, '2026-10-28')!.rows);
  });

  it('returns DigestRow objects sorted by job, with a null owner kept', async () => {
    const { status, body } = await json('2026-10-31');
    expect(status).toBe(200);
    const night = body as Night;
    expect(night.rows.map((r) => r.job)).toEqual(['backup/broken', 'mail/twice', 'render/orphan', 'sync/flaky']);
    expect(night.rows.find((r) => r.job === 'sync/flaky')).toEqual({
      job: 'sync/flaky',
      owner: 'rook',
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: 'timeout',
      firstAt: '2026-10-31T23:00:00+01:00',
      lastAt: '2026-10-31T23:03:00+01:00',
    });
    expect(night.rows.find((r) => r.job === 'render/orphan')).toMatchObject({ owner: null, lastError: null });
    expect(night.rows.find((r) => r.job === 'backup/broken')).toMatchObject({ lastStatus: 'fail', lastError: 'disk full' });
  });

  it('counts a bad line without dropping the night', async () => {
    const { status, body } = await json('2026-10-31');
    expect(status).toBe(200);
    const night = body as Night;
    expect(night.badLines).toBe(1);
    expect(night.counts).toEqual({ ok: 3, retry: 5, fail: 1 });
  });

  it('returns an empty night with no rows and no bad lines', async () => {
    const { status, body } = await json('2026-10-30');
    expect(status).toBe(200);
    expect(body).toEqual({ night: '2026-10-30', rows: [], counts: { ok: 0, retry: 0, fail: 0 }, badLines: 0 });
  });

  it('returns 404 with an error for a night with no file', async () => {
    const { status, body } = await json('2026-01-01');
    expect(status).toBe(404);
    expect(body).toEqual({ error: 'no run log', night: '2026-01-01' });
  });
});

describe('page and JSON agree', () => {
  for (const night of ['2026-10-28', '2026-10-31']) {
    it(`lists the same jobs in the same order for ${night}`, async () => {
      const p = await page(night);
      const j = await json(night);
      expect(p.status).toBe(200);
      expect(j.status).toBe(200);
      const jobs = (j.body as Night).rows.map((r) => r.job);
      expect(jobs.length).toBeGreaterThan(0);
      expect(tableRows(p.html).map((r) => r.job)).toEqual(jobs);
    });
  }
});
