/**
 * LHR から 1 run 分のデータを取り出す (純粋関数)。
 */
import type { Lhr, LhrAudit } from '../lighthouse/types.js';

export interface AuditValue {
  score: number | null;
  numericValue?: number;
}

export interface DetailItem {
  id: string;
  score: number | null;
  numericValue?: number;
  displayValue?: string;
  overallSavingsMs?: number;
  overallSavingsBytes?: number;
  items: unknown[];
  truncated?: boolean;
}

export interface RunData {
  fetchedAt: string;
  finalUrl: string;
  lighthouseVersion: string;
  /** カテゴリスコア (0〜100) */
  scores: Record<string, number | null>;
  /** 主要メトリクス (ミリ秒など、numericValue のまま) */
  metrics: Record<string, number | null>;
  /** 全 audit の score と numericValue */
  audits: Record<string, AuditValue>;
  /** score < 1 の audit の ID 一覧 */
  failedAudits: string[];
  opportunities: DetailItem[];
  diagnostics: DetailItem[];
}

/** CSV の主要メトリクス列と audit ID の対応。 */
export const METRIC_AUDITS: Record<string, string> = {
  fcp_ms: 'first-contentful-paint',
  lcp_ms: 'largest-contentful-paint',
  tbt_ms: 'total-blocking-time',
  cls: 'cumulative-layout-shift',
  speed_index_ms: 'speed-index',
  tti_ms: 'interactive',
  ttfb_ms: 'server-response-time',
  total_byte_weight: 'total-byte-weight',
  dom_size: 'dom-size',
};

export const CATEGORY_SCORE_COLUMNS: Record<string, string> = {
  score_performance: 'performance',
  score_accessibility: 'accessibility',
  score_best_practices: 'best-practices',
  score_seo: 'seo',
};

/** opportunities_json / diagnostics_json の items の 1 audit あたりの上限。 */
export const MAX_DETAIL_ITEMS = 50;

function extractDetail(audit: LhrAudit, maxItems: number): DetailItem {
  const allItems = audit.details?.items ?? [];
  const truncated = allItems.length > maxItems;
  return {
    id: audit.id,
    score: audit.score,
    numericValue: audit.numericValue,
    displayValue: audit.displayValue,
    overallSavingsMs: audit.details?.overallSavingsMs,
    overallSavingsBytes: audit.details?.overallSavingsBytes,
    items: truncated ? allItems.slice(0, maxItems) : allItems,
    truncated: truncated || undefined,
  };
}

/** LHR から 1 run 分の RunData を作る。 */
export function extractRun(lhr: Lhr, maxItems: number = MAX_DETAIL_ITEMS): RunData {
  const scores: Record<string, number | null> = {};
  for (const category of Object.values(lhr.categories ?? {})) {
    scores[category.id ?? 'unknown'] =
      category.score === null || category.score === undefined ? null : category.score * 100;
  }

  const metrics: Record<string, number | null> = {};
  const audits: Record<string, AuditValue> = {};
  const failedAudits: string[] = [];
  const opportunities: DetailItem[] = [];
  const diagnostics: DetailItem[] = [];

  for (const audit of Object.values(lhr.audits ?? {})) {
    if (!audit || typeof audit.id !== 'string') continue;
    audits[audit.id] = {
      score: audit.score ?? null,
      numericValue: typeof audit.numericValue === 'number' ? audit.numericValue : undefined,
    };
    if (audit.score !== null && audit.score !== undefined && audit.score < 1) {
      failedAudits.push(audit.id);
    }
    if (audit.details?.type === 'opportunity') {
      opportunities.push(extractDetail(audit, maxItems));
    } else if (audit.group === 'diagnostics') {
      diagnostics.push(extractDetail(audit, maxItems));
    }
  }

  for (const [metric, auditId] of Object.entries(METRIC_AUDITS)) {
    const audit = lhr.audits?.[auditId];
    metrics[metric] = typeof audit?.numericValue === 'number' ? audit.numericValue : null;
  }

  return {
    fetchedAt: lhr.fetchTime ?? new Date().toISOString(),
    finalUrl: lhr.finalDisplayedUrl ?? lhr.finalUrl ?? '',
    lighthouseVersion: lhr.lighthouseVersion ?? '',
    scores,
    metrics,
    audits,
    failedAudits,
    opportunities,
    diagnostics,
  };
}
