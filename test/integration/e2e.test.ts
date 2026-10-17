/**
 * 結合テスト: ローカルの静的サーバー (sitemap 付き) を立てて実際に Lighthouse を実行する。
 * 遅いため `npm run test:integration` で手動実行する。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { runPipeline } from '../../src/pipeline.js';
import { main } from '../../src/cli.js';
import { formatRunId } from '../../src/config.js';

const PAGES: Record<string, string> = {
  '/': '<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>Home</title></head><body><h1>Home</h1></body></html>',
  '/page-a':
    '<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>A</title><link rel="stylesheet" href="/style.css"></head><body><h1>A</h1></body></html>',
  '/page-b':
    '<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>B</title><meta name="viewport" content="width=device-width"></head><body><h1>B</h1></body></html>',
  '/style.css': 'h1 { color: #333; }',
};

const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>{ORIGIN}/</loc></url>
  <url><loc>{ORIGIN}/page-a</loc></url>
  <url><loc>{ORIGIN}/page-b</loc></url>
</urlset>`;

let server: Server;
let origin = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? '/';
    if (url === '/sitemap.xml') {
      res.writeHead(200, { 'content-type': 'application/xml' });
      res.end(SITEMAP.replaceAll('{ORIGIN}', origin));
      return;
    }
    const body = PAGES[url];
    if (body === undefined) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(200, {
      'content-type': url.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8',
    });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('server address unavailable');
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

describe('end to end', () => {
  it('sitemap から URL を収集し、Lighthouse を実行して CSV を出力する', async () => {
    const outRoot = mkdtempSync(join(tmpdir(), 'lhe-e2e-'));
    try {
      const runId = formatRunId();
      await runPipeline({
        site: origin,
        sitemap: `${origin}/sitemap.xml`,
        strategies: ['mobile'],
        runs: 2,
        concurrency: 1,
        retries: 0,
        delayMs: 0,
        timeoutMs: 60_000,
        extraHeaders: {},
        noRaw: false,
        bom: false,
        allowExternalHosts: false,
        outputDir: outRoot,
        runId,
      });

      const runDir = join(outRoot, runId);
      // F1-6: urls.txt
      const urls = readFileSync(join(runDir, 'urls.txt'), 'utf8').trim().split('\n');
      expect(urls).toHaveLength(3);

      // F4: results.csv
      const csv = readFileSync(join(runDir, 'results.csv'), 'utf8');
      const rows = parseCsv(csv);
      const header = rows[0]!;
      const statusIdx = header.indexOf('status');
      const runsSucceededIdx = header.indexOf('runs_succeeded');
      const perfIdx = header.indexOf('score_performance');
      const rawPathIdx = header.indexOf('raw_path');
      const dataRows = rows.slice(1);
      expect(dataRows).toHaveLength(3); // 3 URL × 1 strategy
      for (const row of dataRows) {
        expect(row[statusIdx]).toBe('ok');
        expect(row[runsSucceededIdx]).toBe('2');
        expect(Number(row[perfIdx])).toBeGreaterThanOrEqual(0);
        expect(row[rawPathIdx]).toMatch(/\.json\.gz$/);
      }
      // AC7: 全 audit 列
      expect(header.filter((c) => c.startsWith('audit:')).length).toBeGreaterThan(50);
      expect(header).toContain('audit:first-contentful-paint:score');
      // AC8: JSON 列がパースできる
      const oppIdx = header.indexOf('opportunities_json');
      for (const row of dataRows) expect(() => JSON.parse(row[oppIdx]!)).not.toThrow();

      // F6: raw
      const rawDir = join(runDir, 'raw', 'mobile');
      const files = readdirSync(rawDir);
      expect(files.filter((f) => f.endsWith('.json.gz'))).toHaveLength(6); // 3 URL × 2 run
      const indexCsv = readFileSync(join(runDir, 'raw', 'index.csv'), 'utf8');
      expect(indexCsv.split('\n').filter((l) => l !== '')).toHaveLength(7); // header + 6
      // raw_path から代表 run を辿れる (AC9)
      const repPath = dataRows[0]![rawPathIdx]!;
      expect(existsSync(repPath)).toBe(true);
      const lhr = JSON.parse(gunzipSync(readFileSync(repPath)).toString('utf8'));
      expect(lhr.lighthouseVersion).toBeTruthy();
      expect(lhr.configSettings.extraHeaders).toEqual({});

      // columns.json
      const columns = JSON.parse(readFileSync(join(runDir, 'columns.json'), 'utf8'));
      expect(columns.columns[0]).toBe('schema_version');
      expect(columns.columns).toEqual(header);

      // F2-8: state.jsonl
      const state = readFileSync(join(runDir, 'state.jsonl'), 'utf8').trim().split('\n');
      expect(state).toHaveLength(3);

      // ---- config.json (機密情報を含まない設定の書き戻し) ----
      const echo = JSON.parse(readFileSync(join(runDir, 'config.json'), 'utf8'));
      expect(echo.site).toBe(origin);
      expect(echo.sitemap).toBe(`${origin}/sitemap.xml`);
      expect(echo.runs).toBe(2);
      expect(JSON.stringify(echo)).not.toContain('Authorization');
    } finally {
      rmSync(outRoot, { recursive: true, force: true });
    }
  }, 600_000);

  it('urls / resume / list / show サブコマンドが動作する (AC5)', async () => {
    const outRoot = mkdtempSync(join(tmpdir(), 'lhe-cli-'));
    try {
      const logs: string[] = [];
      const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(' '));
      });
      try {
        // urls: 収集のみ (計測しない)
        await main(['node', 'cli', 'urls', '--site', `${origin}/sitemap.xml`, '--limit', '2']);
        const printed = logs.filter((l) => l.startsWith(origin));
        expect(printed).toHaveLength(2);

        // run: 2 URL × mobile × 1 run を実行
        await main([
          'node',
          'cli',
          'run',
          '--site',
          `${origin}/sitemap.xml`,
          '--strategy',
          'mobile',
          '--runs',
          '1',
          '--limit',
          '2',
          '--output-dir',
          outRoot,
        ]);
        const runId = readdirSync(outRoot).filter((n) => /^\d{8}-\d{6}$/.test(n))[0]!;
        const runDir = join(outRoot, runId);
        const statePath = join(runDir, 'state.jsonl');
        const resultsPath = join(runDir, 'results.csv');
        expect(readFileSync(statePath, 'utf8').trim().split('\n')).toHaveLength(2);

        // 1 件を未完了に戻す (中断をシミュレート)
        const stateLines = readFileSync(statePath, 'utf8').trim().split('\n');
        writeFileSync(statePath, stateLines[0]! + '\n', 'utf8');
        const resultLines = readFileSync(resultsPath, 'utf8').trim().split('\n');
        writeFileSync(resultsPath, resultLines.slice(0, 2).join('\n') + '\n', 'utf8');

        // resume: 残り 1 件だけが実行される
        const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        try {
          await main(['node', 'cli', 'resume', runId, '--output-dir', outRoot]);
        } finally {
          errSpy.mockRestore();
        }
        expect(readFileSync(statePath, 'utf8').trim().split('\n')).toHaveLength(2);
        expect(readFileSync(resultsPath, 'utf8').trim().split('\n')).toHaveLength(3); // header + 2

        // list / show
        logs.length = 0;
        await main(['node', 'cli', 'list', '--output-dir', outRoot]);
        expect(logs.some((l) => l.includes(runId))).toBe(true);
        logs.length = 0;
        await main(['node', 'cli', 'show', runId, '--output-dir', outRoot]);
        expect(logs.some((l) => l.includes('--- 設定 ---'))).toBe(true);
        expect(logs.some((l) => l.includes('ok: 2'))).toBe(true);
      } finally {
        logSpy.mockRestore();
      }
    } finally {
      rmSync(outRoot, { recursive: true, force: true });
    }
  }, 600_000);
});
