/**
 * 中央値と代表 run の選択 (純粋関数)。
 */
import type { AuditValue, RunData } from './extract.js';

/** 中央値。偶数個は中央 2 件の平均。空なら null。 */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Performance スコアが中央値に最も近い run を選ぶ。同値の場合は先の run。 */
export function pickRepresentativeRun(runs: RunData[]): RunData | null {
  if (runs.length === 0) return null;
  const perfScores = runs.map((r) => r.scores['performance']);
  const med = median(perfScores.filter((s): s is number => s !== null));
  if (med === null) return runs[0]!;
  let best = runs[0]!;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const run of runs) {
    const score = run.scores['performance'];
    if (score === null || score === undefined) continue;
    const dist = Math.abs(score - med);
    if (dist < bestDist) {
      bestDist = dist;
      best = run;
    }
  }
  return best;
}

function medianAuditValues(values: AuditValue[]): AuditValue {
  const scores = median(values.map((v) => v.score).filter((s): s is number => s !== null));
  const numeric = values.map((v) => v.numericValue).filter((n): n is number => n !== undefined);
  return {
    score: scores,
    numericValue: numeric.length > 0 ? (median(numeric) ?? undefined) : undefined,
  };
}

export interface AggregatedResult {
  status: 'ok' | 'partial' | 'error';
  runsTotal: number;
  runsSucceeded: number;
  scores: Record<string, number | null>;
  metrics: Record<string, number | null>;
  audits: Record<string, AuditValue>;
  /** 代表 run の値を使う項目 */
  failedAudits: string[];
  opportunities: RunData['opportunities'];
  diagnostics: RunData['diagnostics'];
  finalUrl: string;
  fetchedAt: string;
  lighthouseVersion: string;
  errorMessage?: string;
}

/** 成功 run が 0 の場合のエラー行用。 */
export function aggregateError(runsTotal: number, message: string): AggregatedResult {
  return {
    status: 'error',
    runsTotal,
    runsSucceeded: 0,
    scores: {},
    metrics: {},
    audits: {},
    failedAudits: [],
    opportunities: [],
    diagnostics: [],
    finalUrl: '',
    fetchedAt: new Date().toISOString(),
    lighthouseVersion: '',
    errorMessage: message,
  };
}

/** 成功した run 群から中央値を取り、代表 run の項目を選んでまとめる。 */
export function aggregateRuns(successful: RunData[], runsTotal: number): AggregatedResult {
  const rep = pickRepresentativeRun(successful)!;
  const status = successful.length === runsTotal ? 'ok' : 'partial';

  const scores: Record<string, number | null> = {};
  const keys = new Set(successful.flatMap((r) => Object.keys(r.scores)));
  for (const key of keys) {
    scores[key] = median(
      successful.map((r) => r.scores[key]).filter((s): s is number => s !== null),
    );
  }

  const metrics: Record<string, number | null> = {};
  for (const key of new Set(successful.flatMap((r) => Object.keys(r.metrics)))) {
    metrics[key] = median(
      successful.map((r) => r.metrics[key]).filter((s): s is number => s !== null),
    );
  }

  const audits: Record<string, AuditValue> = {};
  for (const id of new Set(successful.flatMap((r) => Object.keys(r.audits)))) {
    audits[id] = medianAuditValues(successful.map((r) => r.audits[id]!).filter(Boolean));
  }

  return {
    status,
    runsTotal,
    runsSucceeded: successful.length,
    scores,
    metrics,
    audits,
    failedAudits: rep.failedAudits,
    opportunities: rep.opportunities,
    diagnostics: rep.diagnostics,
    finalUrl: rep.finalUrl,
    fetchedAt: rep.fetchedAt,
    lighthouseVersion: rep.lighthouseVersion,
  };
}
