import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildReportHtml,
  embedJson,
  escapeHtml,
  toViewRows,
  generateReport,
  type ViewRow,
} from '../../src/view/report.js';
import { parseCsvLine, toCsvLine } from '../../src/output/csv.js';

function makeRow(overrides: Partial<ViewRow>): ViewRow {
  return {
    url: 'https://example.com/page-a',
    strategy: 'mobile',
    status: 'ok',
    error: '',
    finalUrl: 'https://example.com/page-a',
    rawPath: 'output/x/raw/mobile/abc-run1.json.gz',
    fetchedAt: '2026-10-17T09:00:00.000Z',
    runsTotal: '3',
    runsSucceeded: '3',
    lighthouseVersion: '12.8.2',
    scores: { performance: 85, accessibility: 92, best_practices: 100, seo: 90 },
    metrics: {
      fcp_ms: 1800,
      lcp_ms: 2900,
      tbt_ms: 250,
      cls: 0.05,
      speed_index_ms: null,
      tti_ms: null,
      ttfb_ms: 320,
      total_byte_weight: 500_000,
      dom_size: 1200,
    },
    failedAudits: ['largest-contentful-paint'],
    opportunities: [
      {
        id: 'render-blocking-resources',
        score: 0.5,
        overallSavingsMs: 800,
        items: [{ url: 'https://example.com/style.css' }],
      },
    ],
    diagnostics: [
      { id: 'mainthread-work-breakdown', score: 0.8, displayValue: '1.5 s', items: [] },
    ],
    ...overrides,
  };
}

describe('escapeHtml / embedJson', () => {
  it('HTML の特殊文字をエスケープする', () => {
    expect(escapeHtml('<script>"a"&b</script>')).toBe(
      '&lt;script&gt;&quot;a&quot;&amp;b&lt;/script&gt;',
    );
  });

  it('埋め込み JSON 内の script 終了タグを無力化する', () => {
    const embedded = embedJson({ url: '</script><b>x</b>' });
    expect(embedded).not.toContain('</script>');
    // JSON として復元できる
    expect(JSON.parse(embedded.replace(/\\u003c/g, '<').replace(/\\u003e/g, '>'))).toEqual({
      url: '</script><b>x</b>',
    });
  });
});

describe('buildReportHtml', () => {
  const rows = [
    makeRow({}),
    makeRow({
      url: 'https://example.com/page-b',
      strategy: 'desktop',
      status: 'error',
      error: 'NO_FCP: page did not paint',
      scores: { performance: null, accessibility: null, best_practices: null, seo: null },
    }),
  ];

  it('サマリと行データを含む単体で動く HTML を生成する', () => {
    const html = buildReportHtml(rows, {
      runId: '20261017-183000',
      generatedAt: '2026-10-17T18:30:00Z',
    });
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('診断結果');
    expect(html).toContain('ok: 1');
    expect(html).toContain('error: 1');
    expect(html).toContain('https://example.com/page-a');
    expect(html).toContain('render-blocking-resources');
    expect(html).not.toContain('http://'); // 外部リソースを読み込まない
    expect(html).not.toMatch(/<link|<img|src=/);
  });

  it('URL を HTML エスケープする', () => {
    const html = buildReportHtml([makeRow({ url: 'https://example.com/<x>"&' })], {
      runId: 'r',
      generatedAt: 't',
    });
    expect(html).not.toContain('<x>');
  });
});

describe('toViewRows', () => {
  it('results.csv のヘッダーと行から ViewRow を作る', () => {
    const header = [
      'url',
      'strategy',
      'status',
      'error_message',
      'final_url',
      'raw_path',
      'fetched_at',
      'runs_total',
      'runs_succeeded',
      'lighthouse_version',
      'score_performance',
      'fcp_ms',
      'cls',
      'failed_audits',
      'opportunities_json',
      'diagnostics_json',
    ];
    const row = [
      'https://example.com/a',
      'mobile',
      'partial',
      '',
      'https://example.com/a',
      'raw/mobile/a.json.gz',
      '2026-10-17T09:00:00.000Z',
      '3',
      '1',
      '12.8.2',
      '77',
      '2100',
      '0.1',
      'audit-a;audit-b',
      JSON.stringify([{ id: 'opp-a', items: [1, 2] }]),
      '[]',
    ];
    const csv = toCsvLine(header) + toCsvLine(row);
    const lines = csv.split('\n').filter((l) => l !== '');
    const table = {
      header: parseCsvLine(lines[0]!),
      rows: [parseCsvLine(lines[1]!)],
    };
    const viewRows = toViewRows(table);
    expect(viewRows).toHaveLength(1);
    const r = viewRows[0]!;
    expect(r.url).toBe('https://example.com/a');
    expect(r.status).toBe('partial');
    expect(r.scores['performance']).toBe(77);
    expect(r.metrics['fcp_ms']).toBe(2100);
    expect(r.failedAudits).toEqual(['audit-a', 'audit-b']);
    expect(r.opportunities[0]?.id).toBe('opp-a');
    expect(r.opportunities[0]?.items).toHaveLength(2);
    expect(r.diagnostics).toEqual([]);
  });
});

describe('埋め込み関数 (ブラウザー側スクリプト)', () => {
  it('squarify / scoreColor / textOn / overallScore が自己完結していて単体で動く', () => {
    const html = buildReportHtml([makeRow({})], { runId: 'r', generatedAt: 't' });
    // 埋め込み関数だけを抜き出して、依存なしで実行できることを確認する
    const embedded = [
      'function squarify(',
      'function scoreColor(',
      'function textOn(',
      'function overallScore(',
    ].every((prefix) => html.includes(prefix));
    expect(embedded).toBe(true);
    const src = html.slice(html.indexOf('function squarify(')).split('const METRICS')[0]!;
    const fns = new Function(
      src +
        '\nreturn { squarify: squarify, scoreColor: scoreColor, textOn: textOn, overallScore: overallScore };',
    )() as {
      squarify: (typeof import('../../src/view/treemap.js'))['squarify'];
      scoreColor: (s: number | null) => string;
      textOn: (bg: string) => string;
      overallScore: (s: Record<string, number | null>) => number | null;
    };
    const rects = fns.squarify([1, 1, 2], 200, 100);
    expect(rects).toHaveLength(3);
    expect(fns.scoreColor(0)).toBe('#c0392b');
    expect(fns.scoreColor(100)).toBe('#1e8449');
    expect(fns.textOn('#d9a11d')).toBe('#1c1c1e');
    expect(
      fns.overallScore({ performance: 80, accessibility: 90, best_practices: 70, seo: 100 }),
    ).toBe(85);
  });
});

describe('generateReport', () => {
  it('results.csv から report.html を生成する', async () => {
    const outRoot = mkdtempSync(join(tmpdir(), 'lhe-view-'));
    try {
      const runId = '20261017-183000';
      const runDir = join(outRoot, runId);
      const fs = await import('node:fs');
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(
        join(runDir, 'results.csv'),
        toCsvLine(['url', 'strategy', 'status', 'score_performance']) +
          toCsvLine(['https://example.com/a', 'mobile', 'ok', '88']),
        'utf8',
      );
      const dest = await generateReport(runId, outRoot);
      expect(dest).toBe(join(runDir, 'report.html'));
      expect(existsSync(dest)).toBe(true);
      const html = readFileSync(dest, 'utf8');
      expect(html).toContain('ok: 1');
      expect(html).toContain('https://example.com/a');
    } finally {
      rmSync(outRoot, { recursive: true, force: true });
    }
  });

  it('results.csv が無ければエラー', async () => {
    const outRoot = mkdtempSync(join(tmpdir(), 'lhe-view-'));
    try {
      await expect(generateReport('20261017-000000', outRoot)).rejects.toThrow(/results\.csv/);
    } finally {
      rmSync(outRoot, { recursive: true, force: true });
    }
  });
});
