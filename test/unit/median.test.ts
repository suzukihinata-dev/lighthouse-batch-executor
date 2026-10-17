import { describe, expect, it } from 'vitest';
import {
  median,
  pickRepresentativeRun,
  aggregateRuns,
  aggregateError,
} from '../../src/aggregate/median.js';
import type { RunData } from '../../src/aggregate/extract.js';

function makeRun(overrides: Partial<RunData>): RunData {
  return {
    fetchedAt: '2026-10-17T09:00:00.000Z',
    finalUrl: 'https://example.com/',
    lighthouseVersion: '12.8.2',
    scores: { performance: 80 },
    metrics: { fcp_ms: 1000 },
    audits: { 'audit-a': { score: 0.5, numericValue: 100 } },
    failedAudits: ['audit-a'],
    opportunities: [],
    diagnostics: [],
    ...overrides,
  };
}

describe('median', () => {
  it('奇数個は中央値', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('偶数個は中央 2 件の平均', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('空は null', () => {
    expect(median([])).toBeNull();
  });
});

describe('pickRepresentativeRun', () => {
  it('Performance スコアが中央値に最も近い run を選ぶ', () => {
    const runs = [
      makeRun({ scores: { performance: 60 } }),
      makeRun({ scores: { performance: 80 } }),
      makeRun({ scores: { performance: 90 } }),
    ];
    expect(pickRepresentativeRun(runs)?.scores['performance']).toBe(80);
  });

  it('同値の場合は先に実行した run', () => {
    const runs = [
      makeRun({ scores: { performance: 90 }, finalUrl: 'https://example.com/first' }),
      makeRun({ scores: { performance: 70 }, finalUrl: 'https://example.com/second' }),
    ];
    // 中央値 80 に対して距離 10 で同値
    expect(pickRepresentativeRun(runs)?.finalUrl).toBe('https://example.com/first');
  });

  it('全 run の Performance スコアが null なら先頭', () => {
    const runs = [
      makeRun({ scores: { performance: null } }),
      makeRun({ scores: { performance: null } }),
    ];
    expect(pickRepresentativeRun(runs)).toBe(runs[0]);
  });
});

describe('aggregateRuns', () => {
  it('数値は中央値、代表 run の項目を使う', () => {
    const runs = [
      makeRun({
        scores: { performance: 60, accessibility: 90 },
        metrics: { fcp_ms: 1000, lcp_ms: 2000 },
        audits: { 'audit-a': { score: 0.4, numericValue: 100 }, 'audit-b': { score: 1 } },
        failedAudits: ['audit-a'],
        finalUrl: 'https://example.com/redirect-a',
      }),
      makeRun({
        scores: { performance: 80, accessibility: null },
        metrics: { fcp_ms: 1200, lcp_ms: null },
        audits: { 'audit-a': { score: 0.6, numericValue: 200 } },
        failedAudits: ['audit-a', 'audit-b'],
        finalUrl: 'https://example.com/redirect-b',
      }),
      makeRun({
        scores: { performance: 90, accessibility: 94 },
        metrics: { fcp_ms: 1400, lcp_ms: 3000 },
        audits: { 'audit-a': { score: 0.8, numericValue: 300 } },
        failedAudits: [],
        finalUrl: 'https://example.com/redirect-c',
      }),
    ];
    const result = aggregateRuns(runs, 3);
    expect(result.status).toBe('ok');
    expect(result.runsTotal).toBe(3);
    expect(result.runsSucceeded).toBe(3);
    // 中央値
    expect(result.scores['performance']).toBe(80);
    expect(result.scores['accessibility']).toBe(92); // 値のある run だけで中央値
    expect(result.metrics['fcp_ms']).toBe(1200);
    expect(result.metrics['lcp_ms']).toBe(2500); // 2000, 3000 の平均
    expect(result.audits['audit-a']?.score).toBeCloseTo(0.6);
    expect(result.audits['audit-a']?.numericValue).toBe(200);
    // 代表 run (perf 中央値 80 → 2 番目の run)
    expect(result.finalUrl).toBe('https://example.com/redirect-b');
    expect(result.failedAudits).toEqual(['audit-a', 'audit-b']);
  });

  it('全 run null の項目は null', () => {
    const runs = [makeRun({ metrics: { fcp_ms: null } }), makeRun({ metrics: { fcp_ms: null } })];
    expect(aggregateRuns(runs, 2).metrics['fcp_ms']).toBeNull();
  });

  it('一部成功なら partial', () => {
    const result = aggregateRuns([makeRun({})], 3);
    expect(result.status).toBe('partial');
    expect(result.runsSucceeded).toBe(1);
  });
});

describe('aggregateError', () => {
  it('エラー行になる', () => {
    const result = aggregateError(3, 'NO_FCP: page did not paint');
    expect(result.status).toBe('error');
    expect(result.runsTotal).toBe(3);
    expect(result.runsSucceeded).toBe(0);
    expect(result.errorMessage).toBe('NO_FCP: page did not paint');
  });
});
