import { describe, expect, it } from 'vitest';
import { escapeField, toCsvLine } from '../../src/output/csv.js';
import {
  buildColumnDefinition,
  buildRowValues,
  fixedOnlyColumnDefinition,
} from '../../src/output/columns.js';
import { aggregateRuns } from '../../src/aggregate/median.js';
import type { RunData } from '../../src/aggregate/extract.js';
import { maskSecrets } from '../../src/logger.js';
import { sanitizeLhr } from '../../src/output/raw.js';

describe('CSV エスケープ (RFC 4180)', () => {
  it('通常の文字はそのまま', () => {
    expect(escapeField('abc')).toBe('abc');
  });

  it('カンマを含む場合は引用符で囲む', () => {
    expect(escapeField('a,b')).toBe('"a,b"');
  });

  it('改行を含む場合は引用符で囲む', () => {
    expect(escapeField('a\nb')).toBe('"a\nb"');
    expect(escapeField('a\rb')).toBe('"a\rb"');
  });

  it('引用符は 2 個にエスケープする', () => {
    expect(escapeField('say "hello"')).toBe('"say ""hello"""');
  });

  it('JSON 文字列列を含む行', () => {
    const line = toCsvLine(['a', JSON.stringify([{ id: 'x', displayValue: '1,000 ms' }])]);
    expect(line).toBe('a,"[{""id"":""x"",""displayValue"":""1,000 ms""}]"\n');
  });
});

describe('列の確定 (columns)', () => {
  const run: RunData = {
    fetchedAt: '2026-10-17T09:00:00.000Z',
    finalUrl: 'https://example.com/',
    lighthouseVersion: '12.8.2',
    scores: { performance: 80, accessibility: 90, 'best-practices': 100, seo: 95 },
    metrics: { fcp_ms: 1200, lcp_ms: 2500 },
    audits: {
      'bbb-audit': { score: 0.5, numericValue: 100 },
      'aaa-audit': { score: 1 },
      'ccc-audit': { score: null },
    },
    failedAudits: ['bbb-audit'],
    opportunities: [],
    diagnostics: [],
  };

  it('audit 列は ID の辞書順に並ぶ', () => {
    const def = buildColumnDefinition(aggregateRuns([run], 1));
    const auditCols = def.columns.filter((c) => c.startsWith('audit:'));
    expect(auditCols).toEqual([
      'audit:aaa-audit:score',
      'audit:aaa-audit:value',
      'audit:bbb-audit:score',
      'audit:bbb-audit:value',
      'audit:ccc-audit:score',
      'audit:ccc-audit:value',
    ]);
    // 固定列が先頭に来る
    expect(def.columns[0]).toBe('schema_version');
    expect(def.columns).toContain('opportunities_json');
    expect(def.schema_version).toBe(1);
  });

  it('行の値を組み立てる', () => {
    const result = aggregateRuns([run], 1);
    const def = buildColumnDefinition(result);
    const row = buildRowValues(
      def,
      'https://example.com/',
      'mobile',
      result,
      'raw/mobile/x.json.gz',
    );
    expect(row['url']).toBe('https://example.com/');
    expect(row['strategy']).toBe('mobile');
    expect(row['status']).toBe('ok');
    expect(row['score_performance']).toBe('80');
    expect(row['fcp_ms']).toBe('1200');
    expect(row['failed_audits']).toBe('bbb-audit');
    expect(row['audit:bbb-audit:score']).toBe('0.5');
    expect(row['audit:bbb-audit:value']).toBe('100');
    expect(row['audit:aaa-audit:value']).toBe('');
    expect(row['audit:ccc-audit:score']).toBe('');
    expect(JSON.parse(row['opportunities_json']!)).toEqual([]);
  });

  it('columns.json に無い audit は無視して unknownAuditIds に記録する', () => {
    const def = fixedOnlyColumnDefinition();
    const result = aggregateRuns([run], 1);
    const unknown: string[] = [];
    const row = buildRowValues(def, 'https://example.com/', 'mobile', result, '', unknown);
    expect(row['audit:bbb-audit:score']).toBeUndefined();
    expect(unknown.sort()).toEqual(['aaa-audit', 'bbb-audit', 'ccc-audit']);
  });
});

describe('機密値のマスク (AC10)', () => {
  it('機密値を *** へ置換する', () => {
    expect(maskSecrets('user=suzuki password=himitsu', ['himitsu'])).toBe(
      'user=suzuki password=***',
    );
  });

  it('複数の機密値を置換する', () => {
    expect(maskSecrets('Authorization: Basic abc123 X-Token: tok999', ['abc123', 'tok999'])).toBe(
      'Authorization: Basic *** X-Token: ***',
    );
  });

  it('生 JSON の extraHeaders を除去する', () => {
    const sanitized = sanitizeLhr({
      lighthouseVersion: '12.8.2',
      categories: {},
      audits: {},
      configSettings: { extraHeaders: { Authorization: 'Basic abc123', 'X-Token': 'tok999' } },
    });
    expect(JSON.stringify(sanitized)).not.toContain('abc123');
    expect(JSON.stringify(sanitized)).not.toContain('tok999');
    expect(sanitized.configSettings?.extraHeaders).toEqual({});
  });
});
