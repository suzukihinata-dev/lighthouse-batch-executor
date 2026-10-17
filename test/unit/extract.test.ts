import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractRun, MAX_DETAIL_ITEMS } from '../../src/aggregate/extract.js';
import type { Lhr } from '../../src/lighthouse/types.js';

const sampleLhr = JSON.parse(
  readFileSync(join(import.meta.dirname, '../fixtures/lhr-sample.json'), 'utf8'),
) as Lhr;

describe('extractRun', () => {
  const run = extractRun(sampleLhr);

  it('カテゴリスコアを 0〜100 に変換する', () => {
    expect(run.scores['performance']).toBeCloseTo(85);
    expect(run.scores['accessibility']).toBeCloseTo(92);
    expect(run.scores['best-practices']).toBeCloseTo(100);
    expect(run.scores['seo']).toBeCloseTo(90);
  });

  it('主要メトリクスを numericValue から取り出す', () => {
    expect(run.metrics['fcp_ms']).toBe(1800);
    expect(run.metrics['lcp_ms']).toBe(2900);
    expect(run.metrics['ttfb_ms']).toBe(320);
    expect(run.metrics['cls']).toBe(0.05);
    expect(run.metrics['speed_index_ms']).toBeNull();
  });

  it('全 audit の score と numericValue を保持する', () => {
    expect(run.audits['first-contentful-paint']).toEqual({ score: 0.78, numericValue: 1800 });
    expect(run.audits['network-requests']).toEqual({ score: 1, numericValue: undefined });
  });

  it('score < 1 の audit の ID を failed_audits に格納する', () => {
    expect(run.failedAudits).toContain('largest-contentful-paint');
    expect(run.failedAudits).toContain('render-blocking-resources');
    expect(run.failedAudits).not.toContain('network-requests');
  });

  it('details.type === "opportunity" の audit を opportunities に格納する', () => {
    expect(run.opportunities.map((o) => o.id).sort()).toEqual([
      'render-blocking-resources',
      'unused-javascript',
      'uses-long-cache-ttl',
    ]);
    const rbr = run.opportunities.find((o) => o.id === 'render-blocking-resources')!;
    expect(rbr.overallSavingsMs).toBe(800);
    expect(rbr.items).toHaveLength(2);
    expect(rbr.displayValue).toBe('Potential savings of 800 ms');
  });

  it('group === "diagnostics" の audit を diagnostics に格納する', () => {
    expect(run.diagnostics.map((d) => d.id).sort()).toEqual([
      'mainthread-work-breakdown',
      'network-requests',
    ]);
  });

  it('メタ情報を取り出す', () => {
    expect(run.finalUrl).toBe('https://example.com/page-a');
    expect(run.lighthouseVersion).toBe('12.8.2');
    expect(run.fetchedAt).toBe('2026-10-17T09:00:00.000Z');
  });

  it('items が上限を超える場合は切り詰めて truncated を付ける', () => {
    const manyItems = Array.from({ length: MAX_DETAIL_ITEMS + 10 }, (_, i) => ({ url: `u${i}` }));
    const lhr: Lhr = {
      ...sampleLhr,
      audits: {
        'render-blocking-resources': {
          ...sampleLhr.audits['render-blocking-resources']!,
          details: { type: 'opportunity', items: manyItems },
        },
      },
    };
    const run2 = extractRun(lhr);
    const opp = run2.opportunities[0]!;
    expect(opp.items).toHaveLength(MAX_DETAIL_ITEMS);
    expect(opp.truncated).toBe(true);
  });
});
